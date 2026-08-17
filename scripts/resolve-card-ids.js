// scripts/resolve-card-ids.js
//
// Looks up each card in src/data/carddata.json by NAME against
// YGOPRODECK's card database (https://ygoprodeck.com/api-guide/).
//
// Per YGOPRODECK's own docs, a name lookup returns one card record, but
// that record's `card_images` array holds one entry per artwork variant
// — their own example is "Decode Talker," which has two. This script
// walks that whole array rather than just the card's single top-level
// id: the existing carddata.json entry for a name gets its id/artwork
// corrected to the DEFAULT artwork's real id, and a brand new entry is
// created for each additional variant — a full clone of the original
// (same stats, same text, same everything) except for id/artwork, which
// point at that specific variant instead.
//
// Nothing else about any card is touched — no stats, no text, nothing
// pulled from YGOPRODECK except the ids themselves. `name` is
// deliberately left identical across all of a card's variants too
// (never suffixed like "(Alt Art)") — that's how the cards themselves
// actually look in real life, and it's also what Card.tsx will print
// on the rendered card face if we ever changed it, so keeping it
// untouched keeps everything correct. The different artwork itself is
// the only thing that tells variants apart, same as any real deck
// builder.
//
// Cards whose name doesn't resolve to an exact match are left
// completely unchanged and reported at the end, rather than guessed at
// — better to flag those for a manual look than silently assign the
// wrong id.
//
// Safe to run repeatedly: an id already matching one of a name's known
// artwork variants (whether the original entry or one added by an
// earlier run of this script) is left alone, and no variant that
// already has an entry gets a duplicate added.
//
// Run this BEFORE download-artwork.js — that script fetches images
// using whatever id is currently in carddata.json, so it needs the real
// ids (and now, the full set of variant entries) in place first.
//
// carddata.json is overwritten in place — make sure it's committed (or
// otherwise backed up) before running this, so you can diff or revert
// if anything looks off afterward.
//
// Usage:
//   node scripts/resolve-card-ids.js
// or:
//   npm run cards:resolve-ids

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CARD_DATA_PATH = path.join(__dirname, '../src/data/carddata.json');
const API_URL = 'https://db.ygoprodeck.com/api/v7/cardinfo.php';

// Pacing between requests, as a good citizen — YGOPRODECK's documented
// limit is 20 requests/second/IP, well above what this needs, but each
// request here already covers a whole batch of names, so there's no
// reason to rush it.
const DELAY_BETWEEN_REQUESTS_MS = 350;
const BATCH_SIZE = 20;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Looks up one batch of names in a single request. Returns a Map of
// name -> array of artwork-variant ids (index 0 is always the default
// artwork) for whichever names matched. Never throws just because SOME
// names in the batch didn't match, only for an actual network/HTTP
// failure, which the caller falls back to per-name lookups for.
async function fetchBatch(names) {
  const url = `${API_URL}?name=${encodeURIComponent(names.join('|'))}`;
  const response = await fetch(url);

  if (response.status === 400) {
    // YGOPRODECK returns 400 when NONE of the requested names matched
    // anything at all — not worth throwing over, just an empty batch.
    return new Map();
  }
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const body = await response.json();
  const result = new Map();
  for (const card of body.data ?? []) {
    // card_images should always have at least one entry (matching the
    // card's own top-level id) — the `?? [{ id: card.id }]` fallback is
    // just defensive in case that's ever missing from a response.
    const variantIds = (card.card_images ?? [{ id: card.id }]).map((img) => img.id);
    result.set(card.name, variantIds);
  }
  return result;
}

// Used only when a whole batch request fails outright (not just
// partially unmatched) — falls back to one request per name, so a
// single bad entry can't cause the rest of a batch to be skipped.
async function fetchIndividually(names) {
  const result = new Map();
  for (const name of names) {
    try {
      const single = await fetchBatch([name]);
      if (single.has(name)) {
        result.set(name, single.get(name));
      }
    } catch (err) {
      console.warn(`  Lookup failed for "${name}": ${err.message}`);
    }
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }
  return result;
}

async function main() {
  const raw = await readFile(CARD_DATA_PATH, 'utf-8');
  const cards = JSON.parse(raw);

  const uniqueNames = [...new Set(cards.map((c) => c.name))];
  const nameToVariantIds = new Map();
  const batches = chunk(uniqueNames, BATCH_SIZE);

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    console.log(`Batch ${i + 1}/${batches.length} (${batch.length} names)...`);
    try {
      const matches = await fetchBatch(batch);
      for (const [name, variantIds] of matches) {
        nameToVariantIds.set(name, variantIds);
      }
      // A batch coming back with fewer matches than names sent is
      // expected and fine — that just means some names in it genuinely
      // didn't match, not that anything failed.
    } catch (err) {
      console.warn(`  Batch request failed (${err.message}), retrying names individually...`);
      const individual = await fetchIndividually(batch);
      for (const [name, variantIds] of individual) {
        nameToVariantIds.set(name, variantIds);
      }
    }
    await sleep(DELAY_BETWEEN_REQUESTS_MS);
  }

  let updated = 0;
  let alreadyCorrect = 0;
  const unresolved = [];
  // Tracks, per name, which variant ids already have SOME entry in
  // carddata.json — whether the original entry (corrected below) or one
  // left over from an earlier run of this script. Makes the second pass
  // (adding entries for missing variants) safe to run repeatedly
  // without ever piling up duplicates.
  const coveredVariantIdsByName = new Map();

  for (const card of cards) {
    const variantIds = nameToVariantIds.get(card.name);
    if (!variantIds || variantIds.length === 0) {
      unresolved.push(card.name);
      continue;
    }

    if (!coveredVariantIdsByName.has(card.name)) {
      coveredVariantIdsByName.set(card.name, new Set());
    }
    const covered = coveredVariantIdsByName.get(card.name);

    if (variantIds.includes(card.id)) {
      // Already a real, valid id for one of this card's artwork
      // variants — whether the default or an already-added alternate —
      // leave it exactly as it is.
      alreadyCorrect++;
      covered.add(card.id);
    } else {
      // Still a placeholder id — assign the default artwork's real id
      // to this, the pre-existing entry for this name. Any OTHER
      // variants get added as new entries in the pass below.
      const defaultId = variantIds[0];
      card.id = defaultId;
      card.artwork = `${defaultId}.jpg`;
      updated++;
      covered.add(defaultId);
    }
  }

  // Second pass: for every resolved name with more than one artwork
  // variant, add a new entry — cloned from whatever entry already
  // exists for that name — for any variant not yet covered.
  const newCards = [];
  let alternateArtworksAdded = 0;

  for (const [name, variantIds] of nameToVariantIds) {
    if (variantIds.length <= 1) continue;
    const covered = coveredVariantIdsByName.get(name);
    if (!covered) continue; // no card in carddata.json actually has this name

    const templateCard = cards.find((c) => c.name === name);
    for (const variantId of variantIds) {
      if (covered.has(variantId)) continue;
      newCards.push({
        ...templateCard,
        id: variantId,
        artwork: `${variantId}.jpg`,
      });
      covered.add(variantId);
      alternateArtworksAdded++;
    }
  }

  const finalCards = [...cards, ...newCards];
  await writeFile(CARD_DATA_PATH, JSON.stringify(finalCards, null, 2) + '\n', 'utf-8');

  console.log('\n--- Summary ---');
  console.log(`Existing entries corrected to their real id: ${updated}`);
  console.log(`Already correct: ${alreadyCorrect}`);
  console.log(`New entries added for alternate artworks: ${alternateArtworksAdded}`);
  console.log(`Unresolved (left unchanged): ${unresolved.length}`);
  if (unresolved.length > 0) {
    console.log(`\nCouldn't find an exact match for: ${unresolved.join(', ')}`);
    console.log(
      "These are unchanged in carddata.json. Common causes: a typo, a name that " +
        "differs slightly from YGOPRODECK's official spelling, or a genuinely Rush " +
        "Duel-exclusive card that YGOPRODECK's TCG/OCG-focused database doesn't have.",
    );
  }
}

main().catch((err) => {
  console.error('Script failed:', err);
  process.exitCode = 1;
});