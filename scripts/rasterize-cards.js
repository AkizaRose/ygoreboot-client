// scripts/rasterize-cards.js
//
// Pre-rasterizes every card in src/data/carddata.json into a static PNG,
// saved to src/assets/card/cardimages/<id>.png — so the running app can
// just <img src=...> the finished card art instead of rendering the full
// <Card> DOM tree and capturing it with html-to-image in every visitor's
// own browser, the first time each card is seen.
//
// That in-browser approach (see the now-removed CardPrewarmGate/
// useRasterizedCard/rasterCache) had two real costs: it made initial page
// load slower as the card pool grew (every card gets a full off-screen
// DOM render + html-to-image capture the first time it's needed), and
// its cache was session-memory-only — a refresh or reconnect mid-duel
// threw the cache away, so cards visibly re-rasterized in front of the
// player instead of just appearing. Doing this once, locally, ahead of
// time removes both: the PNGs ship as ordinary bundled assets, already
// built, before the app is ever loaded by a real player.
//
// How it works: this script starts a real Vite dev server (the same one
// `npm run dev` would, just started programmatically instead) and points
// a headless Chromium (via Puppeteer) at rasterize.html, a page that
// exists only for this script — see that file and
// src/rasterize/RasterizeEntry.tsx for what it does. That page renders
// the app's own real <Card> component (so the output matches the live
// app pixel-for-pixel, fonts and all) and exposes a
// window.__rasterizeCard(id) function; this script calls that once per
// card, in a real browser, and writes the PNG data URL it returns to
// disk.
//
// Safe to re-run any time cards are added to carddata.json — already-
// rasterized cards are detected and skipped instantly (no browser work
// done for them at all), so a normal re-run only ever renders what's
// actually new. Pass --force to re-rasterize every card regardless
// (e.g. after a visual change to Card.tsx/Card.css that should be
// reflected in every existing image, not just new ones).
//
// Usage:
//   npm run cards:rasterize
//   npm run cards:rasterize -- --force
//
// Requires `npm install` to have pulled in Puppeteer's own bundled
// Chromium first (a one-time download that happens automatically as
// part of installing the puppeteer devDependency) and Vite installed
// exactly as it is for `npm run dev`, since this reuses Vite itself
// (not just its output) to serve the real app modules.

import { readFile, mkdir, access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.join(__dirname, '..');
const CARD_DATA_PATH = path.join(ROOT_DIR, 'src/data/carddata.json');
const OUTPUT_DIR = path.join(ROOT_DIR, 'src/assets/card/cardimages');

const FORCE = process.argv.includes('--force');

// Generous per-card ceiling so one genuinely stuck card (a hung font
// load, a browser hiccup) can't stall the whole run forever — matches
// the reasoning behind rasterCache.ts's own CAPTURE_TIMEOUT_MS, though
// slightly longer here since there's no concurrency to keep fed; each
// card just needs to eventually finish or be given up on.
const CAPTURE_TIMEOUT_MS = 15000;

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function withTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

async function main() {
  const startedAt = Date.now();

  const cards = JSON.parse(await readFile(CARD_DATA_PATH, 'utf-8'));
  await mkdir(OUTPUT_DIR, { recursive: true });

  let toRender = cards;
  if (!FORCE) {
    const pending = [];
    for (const card of cards) {
      const dest = path.join(OUTPUT_DIR, `${card.id}.png`);
      if (!(await fileExists(dest))) pending.push(card);
    }
    toRender = pending;
  }

  if (toRender.length === 0) {
    console.log(`All ${cards.length} cards are already rasterized. Nothing to do.`);
    console.log(`(Pass --force to re-rasterize every card anyway.)`);
    return;
  }

  console.log(
    FORCE
      ? `Rasterizing all ${toRender.length} cards (--force)...`
      : `Rasterizing ${toRender.length} of ${cards.length} cards (${cards.length - toRender.length} already up to date)...`,
  );

  console.log('Starting Vite dev server...');
  const server = await createServer({
    root: ROOT_DIR,
    // No point Vite also watching the filesystem for HMR here — this
    // process runs once and exits, it never needs to react to a file
    // changing mid-run.
    server: { hmr: false },
    logLevel: 'warn',
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  if (!port) {
    throw new Error('Vite dev server did not report a port to connect to.');
  }
  const rasterizeUrl = `http://localhost:${port}/rasterize.html`;

  console.log('Launching headless browser...');
  const browser = await puppeteer.launch();

  const failures = [];
  let succeeded = 0;

  try {
    const page = await browser.newPage();
    // Surfaces errors/logs from inside the page (e.g. a card whose
    // artwork 404s, a genuine crash in Card.tsx, or RasterizeEntry.tsx's
    // own "all card fonts preloaded" log) in this terminal, rather than
    // them only existing inside a headless browser no one is looking at.
    page.on('pageerror', (err) => console.error('[page error]', err));
    page.on('console', (msg) => console.log(`[page] ${msg.text()}`));

    await page.goto(rasterizeUrl, { waitUntil: 'networkidle0' });
    await page.waitForFunction('window.__rasterizerReady === true', { timeout: 20000 });

    for (let i = 0; i < toRender.length; i++) {
      const card = toRender[i];
      const label = `[${i + 1}/${toRender.length}] "${card.name}" (${card.id})`;
      try {
        const dataUrl = await withTimeout(
          page.evaluate((id) => window.__rasterizeCard(id), card.id),
          CAPTURE_TIMEOUT_MS,
          label,
        );
        const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
        const dest = path.join(OUTPUT_DIR, `${card.id}.png`);
        await writeFile(dest, Buffer.from(base64, 'base64'));
        succeeded++;
        console.log(`${label} done`);
      } catch (err) {
        failures.push({ card, err });
        console.error(`${label} FAILED:`, err instanceof Error ? err.message : err);
      }
    }
  } finally {
    await browser.close();
    await server.close();
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('');
  console.log(`Rasterized ${succeeded}/${toRender.length} card(s) in ${elapsedSec}s.`);
  if (failures.length > 0) {
    console.log(`${failures.length} card(s) failed — re-run this script to retry just those:`);
    for (const { card, err } of failures) {
      console.log(`  - ${card.name} (${card.id}): ${err instanceof Error ? err.message : err}`);
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('Rasterization run failed:', err);
  process.exitCode = 1;
});
