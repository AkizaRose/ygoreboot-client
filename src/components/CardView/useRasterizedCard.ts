import { useEffect, useRef, useState } from 'react';
import { toPng } from 'html-to-image';
import type { CardData } from '../../types/Card';
import {
  getCachedCardImage,
  setCachedCardImage,
  getInFlightCapture,
  setInFlightCapture,
  clearInFlightCapture,
  enqueueCapture,
} from './rasterCache';

// Card's own native size (see Card.css .Card) — capturing at this exact
// size means the rasterized PNG can be scaled down later using the same
// approach as the live component (a wrapping transform: scale()), with no
// separate scale-math needed here.
const CARD_WIDTH = 813;
const CARD_HEIGHT = 1185;

export function useRasterizedCard(card: CardData) {
  const id = String(card.id);
  const [imageUrl, setImageUrl] = useState<string | undefined>(() => getCachedCardImage(id));
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Always re-check the cache when `id` changes, rather than only on
    // first mount. Component instances can be reused for a *different*
    // card at the same tree position — e.g. a deck slot keyed by index,
    // where removing a card shifts everything after it down by one — and
    // relying solely on the initial useState lazy initializer above would
    // leave this showing the previous card's (now stale) image forever,
    // since that initializer only ever runs once per component instance.
    const cached = getCachedCardImage(id);
    if (cached) {
      setImageUrl(cached);
      return;
    }

    // Not cached for this id: clear out whatever image (possibly a
    // different card's, if this instance is being reused) was showing
    // before, so the live fallback renders while a fresh capture runs.
    setImageUrl(undefined);

    let cancelled = false;

    const existing = getInFlightCapture(id);
    if (existing) {
      existing.then((url) => {
        if (!cancelled) setImageUrl(url);
      });
      return () => {
        cancelled = true;
      };
    }

    const capture = async () => {
      const node = captureRef.current;
      if (!node) throw new Error(`Capture node not mounted for card ${id}`);

      // html-to-image does NOT wait for custom @font-face fonts on its own
      // — only for this, we wait explicitly, or a capture that happens to
      // run before the font finishes loading would bake in a fallback
      // system font permanently into the cached PNG.
      await document.fonts.ready;

      // Give the off-screen node a paint frame before snapshotting, so any
      // late layout/image-decode work (e.g. artwork <img> tags) has
      // settled. Double rAF ensures we're past the frame where fonts.ready
      // resolved, not just scheduled within it.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );

      console.log(`[CardImage] starting capture for "${card.name}" (${id})`);

      return enqueueCapture(
        () =>
          toPng(node, {
            width: CARD_WIDTH,
            height: CARD_HEIGHT,
            pixelRatio: 1,
            cacheBust: true,
          }),
        `capture for "${card.name}" (${id})`,
      );
    };

    const promise = capture();
    setInFlightCapture(id, promise);

    promise
      .then((url) => {
        console.log(`[CardImage] finished capture for "${card.name}" (${id})`);
        setCachedCardImage(id, url);
        if (!cancelled) setImageUrl(url);
      })
      .catch((err) => {
        // Left uncached on failure — CardImage keeps rendering the live
        // fallback indefinitely for this card rather than showing nothing.
        console.error(`[CardImage] failed to rasterize card "${card.name}" (${id}):`, err);
      })
      .finally(() => {
        clearInFlightCapture(id);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { imageUrl, captureRef, needsCapture: !imageUrl };
}

export { CARD_WIDTH, CARD_HEIGHT };
