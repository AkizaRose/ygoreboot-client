// Loads every pre-rasterized card PNG (see scripts/rasterize-cards.js) at
// build time via Vite's import.meta.glob, keyed by card id — the same
// toNameMap-style pattern cardAssets.ts already uses for the other
// per-card image folders, for the same reason: resolve every file once,
// up front, into a plain id -> URL map, rather than constructing a path
// string at render time.
const cardImageModules = import.meta.glob('../../assets/card/cardimages/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const cardImagesById: Record<string, string> = {};
for (const modulePath in cardImageModules) {
  const id = modulePath.split('/').pop()!.replace(/\.png$/, '');
  cardImagesById[id] = cardImageModules[modulePath];
}

// undefined for any card that hasn't been rasterized yet — e.g. just
// added to carddata.json, with `npm run cards:rasterize` not re-run
// since. CardImage.tsx falls back to the live <Card> component for
// those, rather than this needing to throw or return a placeholder.
export function getCardImageUrl(id: number | string): string | undefined {
  return cardImagesById[String(id)];
}
