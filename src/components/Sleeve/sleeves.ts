// Vite statically discovers every matching file at build time — new
// sleeve images just need to be dropped into src/assets/card/sleeves/,
// no filename needs to be hardcoded or registered anywhere else. Mirrors
// Avatar/avatars.ts exactly — see that file's own comments for the full
// reasoning behind every choice here.
const sleeveModules = import.meta.glob('../../assets/card/sleeves/*.png', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

export interface SleeveOption {
  id: string;
  url: string;
}

// The filename (e.g. "1_Default.png") is what gets stored as a user's
// card back selection in Firestore — NOT the resolved url, which changes
// on every rebuild (Vite hashes asset filenames for cache-busting). The
// filename stays stable across rebuilds/redeploys, so it's re-resolved
// to whatever the CURRENT build's actual asset url is at render time via
// getSleeveUrl below, rather than a stored url ever going stale.
export const DEFAULT_SLEEVE_ID = '1_Default.png';

// Sorted with the default sleeve pinned first (easy to find/return to),
// then alphabetically — import.meta.glob's own key order isn't
// guaranteed to match any particular sequence.
export const SLEEVE_OPTIONS: SleeveOption[] = Object.entries(sleeveModules)
  .map(([path, url]) => ({ id: path.split('/').pop() ?? path, url }))
  .sort((a, b) => {
    if (a.id === DEFAULT_SLEEVE_ID) return -1;
    if (b.id === DEFAULT_SLEEVE_ID) return 1;
    return a.id.localeCompare(b.id);
  });

export function getSleeveUrl(sleeveId: string | undefined | null): string {
  const id = sleeveId ?? DEFAULT_SLEEVE_ID;
  const match = SLEEVE_OPTIONS.find((sleeve) => sleeve.id === id);
  if (match) return match.url;
  // Falls back gracefully if the stored id no longer matches anything in
  // src/assets/card/sleeves (e.g. that file was renamed or removed since
  // the user picked it) — the default sleeve first, or simply whatever's
  // first in the list if even that's somehow missing, rather than
  // rendering a broken image.
  return (
    SLEEVE_OPTIONS.find((sleeve) => sleeve.id === DEFAULT_SLEEVE_ID)?.url ??
    SLEEVE_OPTIONS[0]?.url ??
    ''
  );
}
