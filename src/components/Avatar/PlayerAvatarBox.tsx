import { useUserAvatar } from './useUserAvatar';
import { getAvatarUrl } from './avatars';
import './PlayerAvatarBox.css';

// A read-only display of the player's own chosen avatar for the duel
// field — unlike AvatarSelector (Account page), this doesn't open a
// picker; changing avatars only ever happens from the Account page.
interface PlayerAvatarBoxProps {
  // Only ever meaningful on the duel field — omitted (defaulting to no
  // border) anywhere else this gets used. Only a single boolean, not a
  // 'mine'/'opponent' variant the way PhaseTracker's own coloring is —
  // this component only ever renders the PLAYER's own avatar, so
  // there's only one side's color to apply here at all; the opponent's
  // avatar (rendered inline in MultiplayerDuelFieldPage instead) has
  // its own separate opponent-colored class for the same reason.
  isMyTurn?: boolean;
}

function PlayerAvatarBox({ isMyTurn = false }: PlayerAvatarBoxProps) {
  const { avatarId } = useUserAvatar();

  return (
    <div className={['PlayerAvatarBox', isMyTurn && 'PlayerAvatarBox--myTurn'].filter(Boolean).join(' ')}>
      <img src={getAvatarUrl(avatarId)} alt="Your avatar" className="PlayerAvatarBox-image" />
    </div>
  );
}

export default PlayerAvatarBox;