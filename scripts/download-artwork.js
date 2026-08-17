// scripts/download-artwork.js
//
// Downloads and locally caches card artwork from YGOPRODECK
// (https://ygoprodeck.com/api-guide/). Per their API guide: images must
// be downloaded and re-hosted locally rather than hotlinked directly
// from their servers — this script exists specifically so that rule is
// followed automatically, rather than by hand, one card at a time.
//
// Reads every card in src/data/carddata.json, and for each one whose
// artwork isn't already sitting in public/artwork/, downloads it from
// YGOPRODECK's cards_cropped endpoint and saves it there under the same
// filename Card.tsx already expects (card.artwork, which is already
// `${id}.jpg` for every existing entry).
//
// Safe to re-run at any time, including after adding new cards to
// carddata.json — already-downloaded images are detected and skipped
// instantly, with no network request made for them at all, so this
// only ever fetches what's actually missing. That also makes it safe to
// interrupt (Ctrl+C, a dropped connection) — just run it again and it
// picks up wherever it left off.
//
// Usage:
//   node scripts/download-artwork.js
// or, once wired up in package.json:
//   npm run artwork:download

import { readFile, mkdir, access, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARD_DATA_PATH = path.join(__dirname, '../src/data/carddata.json');
const ARTWORK_DIR = path.join(__dirname, '../public/artwork');
const IMAGE_BASE_URL = 'https://images.ygoprodeck.com/images/cards_cropped';

// Conservative pacing between requests, out of respect for YGOPRODECK's
// servers — see the "do not hotlink, please re-host yourself" note in
// their API guide, which also warns of an IP blacklist for not doing
// so. Only applies to cards actually being fetched; anything already
// cached locally is skipped with no request made at all.
const DELAY_BETWEEN_DOWNLOADS_MS = 300;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function downloadImage(url, destPath) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await writeFile(destPath, Buffer.from(arrayBuffer));
}

async function main() {
  const raw = await readFile(CARD_DATA_PATH, 'utf-8');
  const cards = JSON.parse(raw);

  await mkdir(ARTWORK_DIR, { recursive: true });

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  const failedCards = [];

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    // Falls back to `${id}.jpg` if a card is somehow missing its own
    // artwork field — shouldn't normally happen, since CardData requires
    // it, but costs nothing to handle gracefully rather than crash.
    const filename = card.artwork || `${card.id}.jpg`;
    const destPath = path.join(ARTWORK_DIR, filename);
    const progress = `[${i + 1}/${cards.length}]`;

    if (await fileExists(destPath)) {
      skipped++;
      continue;
    }

    const url = `${IMAGE_BASE_URL}/${card.id}.jpg`;
    try {
      await downloadImage(url, destPath);
      downloaded++;
      console.log(`${progress} Downloaded ${filename} (${card.name})`);
      await sleep(DELAY_BETWEEN_DOWNLOADS_MS);
    } catch (err) {
      failed++;
      failedCards.push(card.name);
      console.warn(`${progress} FAILED ${filename} (${card.name}): ${err.message}`);
    }
  }

  console.log('\n--- Summary ---');
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Already cached (skipped): ${skipped}`);
  console.log(`Failed: ${failed}`);

  if (failed > 0) {
    console.log(`\nFailed cards: ${failedCards.join(', ')}`);
    console.log(
      "This usually means YGOPRODECK's database doesn't have that exact card ID — " +
        'worth double-checking those specific IDs by hand. Re-running this script ' +
        'later will only retry these failed ones, not anything already downloaded.',
    );
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exitCode = 1;
});
