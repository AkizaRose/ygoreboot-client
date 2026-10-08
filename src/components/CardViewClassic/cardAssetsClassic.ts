// Classic-layout counterpart to CardView/cardAssets.ts — same
// import.meta.glob + filename -> URL map pattern, pointed at
// src/assets/cardclassic/ instead. Frame/attribute/spell-trap-icon
// filenames there are looked up by the same card data fields as the
// modern set (frameImages["Effect"], attributeImages["Wind"], ...); see
// cardAssets.ts for the full reasoning behind the pattern.

function toNameMap(modules: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const path in modules) {
    const filename = path.split('/').pop()!.replace(/\.png$/, '');
    map[filename] = modules[path];
  }
  return map;
}

const attributeModules = import.meta.glob('../../assets/cardclassic/attribute/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const frameModules = import.meta.glob('../../assets/cardclassic/frame/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const spellTrapIconModules = import.meta.glob('../../assets/cardclassic/spelltrapicon/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

export const attributeImages = toNameMap(attributeModules);
export const frameImages = toNameMap(frameModules);
export const spellTrapIconImages = toNameMap(spellTrapIconModules);

// Unlike the modern layout (one pre-composited image per level value),
// the classic layout has a single star image that CardClassic repeats once
// per level.
export { default as levelImg } from '../../assets/cardclassic/level/Level.png';
export { default as legendImg } from '../../assets/cardclassic/Legend.png';

export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
