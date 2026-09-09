// Vite statically discovers every matching file at build time — new
// avatar images just need to be dropped into src/assets/avatars/, no
// filename needs to be hardcoded or registered anywhere else.
const avatarModules = import.meta.glob('../../assets/avatars/*.{png,jpg,jpeg,webp}', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

export interface AvatarOption {
  id: string;
  url: string;
}

// The filename (e.g. "default.png") is what gets stored as a user's
// avatar selection in Firestore — NOT the resolved url, which changes on
// every rebuild (Vite hashes asset filenames for cache-busting). The
// filename stays stable across rebuilds/redeploys, so it's re-resolved
// to whatever the CURRENT build's actual asset url is at render time via
// getAvatarUrl below, rather than a stored url ever going stale.
export const DEFAULT_AVATAR_ID = 'default.png';

// Sorted with the default avatar pinned first (easy to find/return to),
// then alphabetically — import.meta.glob's own key order isn't
// guaranteed to match any particular sequence.
export const AVATAR_OPTIONS: AvatarOption[] = Object.entries(avatarModules)
  .map(([path, url]) => ({ id: path.split('/').pop() ?? path, url }))
  .sort((a, b) => {
    if (a.id === DEFAULT_AVATAR_ID) return -1;
    if (b.id === DEFAULT_AVATAR_ID) return 1;
    return a.id.localeCompare(b.id);
  });

export function getAvatarUrl(avatarId: string | undefined | null): string {
  const id = avatarId ?? DEFAULT_AVATAR_ID;
  const match = AVATAR_OPTIONS.find((avatar) => avatar.id === id);
  if (match) return match.url;
  // Falls back gracefully if the stored id no longer matches anything in
  // src/assets/avatars (e.g. that file was renamed or removed since the
  // user picked it) — the default avatar first, or simply whatever's
  // first in the list if even that's somehow missing, rather than
  // rendering a broken image.
  return (
    AVATAR_OPTIONS.find((avatar) => avatar.id === DEFAULT_AVATAR_ID)?.url ??
    AVATAR_OPTIONS[0]?.url ??
    ''
  );
}
