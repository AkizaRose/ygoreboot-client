import { createRoot } from 'react-dom/client';
import { toPng, getFontEmbedCSS } from 'html-to-image';
import cardDataJson from '../data/carddata.json';
import type { CardData } from '../types/Card';
import Card from '../components/CardView/Card';

// Card's own native size (see Card.css .Card) — same constants
// useRasterizedCard.ts used to capture at, kept in sync with it there too.
const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;

const cardsById = new Map<number, CardData>(
  (cardDataJson as CardData[]).map((card) => [card.id, card]),
);

// A single persistent off-screen container, reused for every card in
// turn, rather than a fresh mount/unmount per card — scripts/
// rasterize-cards.js drives this strictly one card at a time (see that
// script's own comment on why), so there's never more than one capture
// in flight, and reusing the same root avoids needing any of the
// in-flight/queueing machinery the old in-browser pipeline
// (rasterCache.ts) needed to handle many cards' worth of concurrent
// captures safely.
const container = document.createElement('div');
container.style.position = 'fixed';
container.style.top = '0';
container.style.left = '0';
// Doesn't need pointer-events/visibility hiding the way the old in-app
// capture stage did — this page is never actually looked at by a person,
// only screenshotted programmatically via toPng().
document.body.appendChild(container);
const root = createRoot(container);

// Every custom font Card.tsx actually renders text in, as the exact
// weight/style/family shorthand needed to match each one's own
// @font-face declaration in index.css (see that file — every one of
// these is declared with font-display: swap). Sizes below are whatever
// Card.css itself uses; a font only needs to be fetched/parsed once per
// family to render correctly at any size after that, so the effect-text
// fonts (rendered anywhere from 16-28px by useAutoFitText) only need
// preloading once, at their max size.
const CARD_FONTS = [
  '92px "MatrixRegularSmallCaps"', // .name
  '32px "Yu-Gi-Oh!ITCStoneSerifSmallCaps"', // .types / .spellTrapType
  '28px "Yu-Gi-Oh! Matrix Book"', // .monsterEffect / .spellTrapEffect
  'italic 28px "Yu-Gi-Oh! StoneSerif LT"', // .flavourText
  // index.css declares this face at font-weight: 800 (Ultra Bold) —
  // .atkValue/.defValue don't set font-weight themselves (so render at
  // the default 400), but browsers still substitute the one registered
  // 800 face for any weight query when it's the only face in that
  // family — a live page ends up using it correctly either way. For
  // *loading* it explicitly, though, matching the family's actual
  // registered weight (800) here rather than Card.css's implied 400 is
  // what reliably matches it against the @font-face rule.
  '800 36px "RoGSanSrfStd-UB"', // .atkValue / .defValue
];

// This is the actual fix for cards coming out with the wrong font
// (wrong glyph shapes for names/types/ATK-DEF, wrong text-stroke
// thickness, name/type text overflowing or under-filling its box) —
// every card font above uses font-display: swap (see index.css), which
// means Chromium's *default* behavior for newly-appearing text is to
// paint it immediately in a fallback font and only swap to the real one
// once it finishes downloading, whenever that happens to be. Card.tsx's
// own name-squash-to-fit logic has a comment explaining that awaiting
// document.fonts.ready (or a single .load() promise) around a single
// render was already tried and found unreliable for exactly this reason
// — it doesn't guarantee the swap has actually happened by the time
// something checks it, just that whichever fonts the browser happened
// to have already started fetching by that moment are done.
//
// document.fonts.load(), called explicitly for a specific font string
// BEFORE anything ever tries to render text in it, sidesteps all of
// that: it kicks off the real fetch itself and its own returned promise
// resolves only once that exact face is fully loaded and usable,
// regardless of font-display. Doing this once, for every card font, and
// waiting for all of them before rasterizing a single card, means the
// very first paint of the very first card already has every real font
// available — no swap ever needs to happen mid-capture, for any card.
const fontsPreloaded = Promise.all(CARD_FONTS.map((font) => document.fonts.load(font))).then(
  () => {
    console.log('[rasterize] all card fonts preloaded');
  },
);

async function waitForSettledPaint(): Promise<void> {
  // Cheap once fontsPreloaded has already resolved (nothing left
  // loading) — kept as a second safety net, not the primary fix above.
  await document.fonts.ready;
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}

function renderCard(card: CardData): Promise<void> {
  return new Promise((resolve) => {
    root.render(<Card card={card} />);
    // One rAF for React to actually commit/paint the new render() call
    // before waitForSettledPaint's own frames run on top of it.
    requestAnimationFrame(() => resolve());
  });
}

async function rasterizeCard(id: number): Promise<string> {
  const card = cardsById.get(id);
  if (!card) {
    throw new Error(`Unknown card id ${id} — not present in src/data/carddata.json`);
  }

  // Only ever awaited to completion once in practice (every call after
  // the first hits an already-resolved promise) — but every call still
  // awaits it, so it's impossible to render even the very first card
  // before every font it needs is genuinely ready.
  await fontsPreloaded;

  await renderCard(card);
  await waitForSettledPaint();

  // The font preload above guarantees the browser is already PAINTING
  // this card with the real fonts by now — but that turned out not to
  // be the actual bug. toPng() does its own, completely separate font
  // step on top of that: to produce a static image, it serializes the
  // node into a self-contained SVG, and for that SVG to render text in
  // the right font wherever it's later drawn (including here, into an
  // in-memory <canvas> to produce the PNG), it re-fetches every font
  // file referenced by an applicable @font-face rule and inlines it as
  // base64 directly into that SVG's own <style> block — a separate
  // fetch-and-embed pass from whatever's already loaded and correctly
  // showing on screen. html-to-image's own automatic version of this
  // step (the default, when fontEmbedCSS below isn't passed) scans
  // every stylesheet in the whole document — including totally
  // unrelated ones, e.g. every page/component's own CSS this dev
  // server happens to have loaded — and has a well-documented tendency
  // to silently fail to embed one or more fonts rather than throwing,
  // which bakes a fallback font permanently into the output PNG even
  // though the live DOM element being captured looked completely
  // correct right up until the moment of capture. That matches this
  // bug exactly: preloading the fonts (so the on-screen element is
  // definitely correct) made no difference, because the broken step
  // was never about what's on screen.
  //
  // getFontEmbedCSS(container), called explicitly first, does that
  // same fetch-and-embed work up front, scoped to just the fonts this
  // card's own node actually uses, and hands toPng() the result
  // directly via the fontEmbedCSS option — skipping toPng()'s own
  // automatic (flakier, whole-document) version of this step entirely.
  const fontEmbedCSS = await getFontEmbedCSS(container);

  return toPng(container, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    pixelRatio: 1,
    cacheBust: true,
    fontEmbedCSS,
  });
}

declare global {
  interface Window {
    // Resolves with a PNG data URL for the given card id. Exposed on
    // window rather than returned from a module export, since
    // scripts/rasterize-cards.js calls this from Node via Puppeteer's
    // page.evaluate(), which can only invoke globals it can see in the
    // page's own JS context.
    __rasterizeCard: (id: number) => Promise<string>;
    // Flips true once this module has finished its (synchronous) setup —
    // the script waits on this before calling __rasterizeCard for the
    // first time, so it never races a page that hasn't finished loading
    // this bundle yet.
    __rasterizerReady?: boolean;
  }
}

window.__rasterizeCard = rasterizeCard;
window.__rasterizerReady = true;
