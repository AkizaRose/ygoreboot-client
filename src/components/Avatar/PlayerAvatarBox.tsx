import { useUserAvatar } from './useUserAvatar';
import { getAvatarUrl } from './avatars';
import './PlayerAvatarBox.css';

// A read-only display of the player's own chosen avatar for the duel
// field — unlike AvatarSelector (Account page), this doesn't open a
// picker; changing avatars only ever happens from the Account page.
function PlayerAvatarBox() {
  const { avatarId } = useUserAvatar();

  return (
    <div className="PlayerAvatarBox">
      <img src={getAvatarUrl(avatarId)} alt="Your avatar" className="PlayerAvatarBox-image" />
    </div>
  );
}

export default PlayerAvatarBox;
