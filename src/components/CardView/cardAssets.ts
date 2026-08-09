// Loads every PNG in the given asset subfolders at build time (via Vite's
// import.meta.glob) and exposes them as filename -> URL lookup maps, so we
// can select the right image at render time based on card data fields
// (e.g. attributeImages["Wind"], frameImages["Effect"]).

function toNameMap(modules: Record<string, string>): Record<string, string> {
  const map: Record<string, string> = {};
  for (const path in modules) {
    const filename = path.split('/').pop()!.replace(/\.png$/, '');
    map[filename] = modules[path];
  }
  return map;
}

const attributeModules = import.meta.glob('../../assets/card/attribute/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const frameModules = import.meta.glob('../../assets/card/frame/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const spellTrapIconModules = import.meta.glob('../../assets/card/spelltrapicon/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

const levelModules = import.meta.glob('../../assets/card/level/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

export const attributeImages = toNameMap(attributeModules);
export const frameImages = toNameMap(frameModules);
export const spellTrapIconImages = toNameMap(spellTrapIconModules);
export const levelImages = toNameMap(levelModules);

export { default as borderImg } from '../../assets/card/Border.png';
export { default as spellTrapIconBgImg } from '../../assets/card/spelltrapicon/sticonbg.png';
export { default as atkDefLabelsImg } from '../../assets/card/AtkDefLabels.png';
export { default as legendImg } from '../../assets/card/Legend.png';

export function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}
