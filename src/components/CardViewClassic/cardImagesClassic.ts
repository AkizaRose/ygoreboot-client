// Classic-layout counterpart to CardView/cardImages.ts — every
// pre-rasterized classic card PNG (see scripts/rasterize-cards.js, which
// writes them to src/assets/cardclassic/cardimages/<id>.png), keyed by
// card id. See cardImages.ts for the full reasoning.
const cardImageModules = import.meta.glob('../../assets/cardclassic/cardimages/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const cardImagesById: Record<string, string> = {};
for (const modulePath in cardImageModules) {
  const id = modulePath.split('/').pop()!.replace(/\.png$/, '');
  cardImagesById[id] = cardImageModules[modulePath];
}

// undefined for any card not rasterized in the classic layout yet —
// CardImage.tsx falls back to the live <CardClassic> component for those.
export function getClassicCardImageUrl(id: number | string): string | undefined {
  return cardImagesById[String(id)];
}
