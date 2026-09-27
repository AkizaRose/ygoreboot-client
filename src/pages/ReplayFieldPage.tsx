import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useReplayPlayback, type ReplayPlayerState } from '../components/Replay/useReplayPlayback';
import { getAvatarUrl } from '../components/Avatar/avatars';
import DuelField from '../components/DuelField/DuelField';
import Hand from '../components/DuelField/Hand';
import CardLayer from '../duel/CardLayer';
import DeckViewer from '../components/DuelField/DeckViewer';
import CardDisplay from '../components/CardDisplay/CardDisplay';
import { computeCardPositions } from '../duel/cardPositions';
import type { MyDuelState, OpponentDuelState, PlayerRole } from '../components/Matchmaking/useMultiplayerDuel';
import type { CardData } from '../types/Card';
import type { CardInstance } from '../types/CardInstance';
import '../components/Avatar/PlayerAvatarBox.css';
import '../components/DuelField/LifePointCounter.css';
import './MultiplayerDuelFieldPage.css';
import './ReplayFieldPage.css';

// The 8 hand-action callbacks are required props on <Hand> (they're only
// ever invoked from ITS OWN hover context menu, which a real user would
// have to click to trigger) — a replay never wires up that menu at all, so
// these are truly unreachable no-ops, not a workaround for anything.
const NOOP = () => {};

// Deck PILE counts are all this page ever has for Main/Extra Deck (their
// actual contents were never public even live, and the feature request
// keeps them unviewable in replay too) — these placeholders exist purely
// so DuelField has an array of the right LENGTH to render a face-down pile
// with the correct count; nothing about their identity is ever shown.
const PLACEHOLDER_CARD: CardData = {
  id: 0,
  name: '',
  cardClass: 'Monster',
  attribute: '',
  artwork: '',
  frame: '',
  legend: '',
  effectText: '',
};

function placeholderDeck(count: number): CardInstance[] {
  return Array.from({ length: Math.max(0, count) }, (_, i) => ({
    instanceId: `placeholder-${i}`,
    card: PLACEHOLDER_CARD,
  }));
}

// Reconstructs a full MyDuelState from one player's recorded replay state —
// real hand (this is the "reveal both hands" design choice), real
// board/grave/banished (always-public data even live), placeholder decks
// (never public, never needed for a Main/Extra-Deck-less replay), and no
// activeAttack (attack animation timing isn't part of what got recorded —
// see recordReplayFrame's own comment on scope).
function toMyDuelState(player: ReplayPlayerState): MyDuelState {
  const p = player.publicState;
  return {
    lifePoints: p.lifePoints,
    phase: p.phase,
    monsterZones: p.monsterZones,
    spellTrapZones: p.spellTrapZones,
    grave: p.grave,
    banished: p.banished,
    fieldZone: p.fieldZone,
    hand: player.hand,
    mainDeck: placeholderDeck(p.mainDeckCount),
    extraDeck: placeholderDeck(p.extraDeckCount),
    lastHandDepartureIndex: p.lastHandDepartureIndex,
    handShuffleVersion: p.handShuffleVersion,
    mainDeckShuffleVersion: p.mainDeckShuffleVersion,
    openingHandDealt: p.openingHandDealt,
    lastAutoDrawnTurn: p.lastAutoDrawnTurn,
    revealedCard: p.revealedCard,
    lastMainDeckReturnSide: p.lastMainDeckReturnSide,
    activeAttack: null,
  };
}

function toOpponentDuelState(
  player: ReplayPlayerState,
  uid: string,
  username: string,
  avatarId: string,
): OpponentDuelState {
  // PublicPlayerState's own activeAttack was never part of buildPublicState's
  // actual recorded output (see recordReplayFrame's own comment on scope —
  // attack-resolution timing isn't part of what's replayed), so it's always
  // null here, same as MyDuelState's own copy of this in toMyDuelState.
  return { ...player.publicState, uid, username, avatarId, activeAttack: null };
}

function ReplayFieldPage() {
  const { duelId } = useParams<{ duelId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { loading, error, meta, current, index, total, isPlaying, play, pause } = useReplayPlayback(
    duelId,
    currentUser?.uid,
  );
  const [hoveredCard, setHoveredCard] = useState<CardData | null>(null);
  const [viewingPile, setViewingPile] = useState<'grave' | 'banished' | null>(null);
  const [viewingOpponentPile, setViewingOpponentPile] = useState<'grave' | 'banished' | null>(null);

  const handleCardHover = (card: CardData) => setHoveredCard(card);
  const handleCardHoverEnd = () => setHoveredCard(null);

  if (loading) {
    return (
      <div className="MultiplayerDuelFieldPage ReplayFieldPage-status">
        <p>Loading replay…</p>
      </div>
    );
  }
  if (error || !meta || !current) {
    return (
      <div className="MultiplayerDuelFieldPage ReplayFieldPage-status">
        <p>{error ?? 'This replay is not available.'}</p>
        <button type="button" onClick={() => navigate('/replays')}>
          Back to Replays
        </button>
      </div>
    );
  }

  const myRole: PlayerRole = meta.myRole;
  const opponentRole: PlayerRole = myRole === 'player1' ? 'player2' : 'player1';
  const myFrame = current[myRole];
  const opponentFrame = current[opponentRole];

  if (!myFrame || !opponentFrame) {
    // Before either side's very first frame has landed — shouldn't happen
    // in practice (index 0 is already the opening-hand frame for both
    // sides), but guards a genuinely empty/corrupt replay from crashing
    // below instead of showing a plain message.
    return (
      <div className="MultiplayerDuelFieldPage ReplayFieldPage-status">
        <p>This replay has no recorded moments to show.</p>
        <button type="button" onClick={() => navigate('/replays')}>
          Back to Replays
        </button>
      </div>
    );
  }

  const myUsername = myRole === 'player1' ? meta.player1Username : meta.player2Username;
  const myAvatarId = myRole === 'player1' ? meta.player1AvatarId : meta.player2AvatarId;
  const opponentUsername = opponentRole === 'player1' ? meta.player1Username : meta.player2Username;
  const opponentAvatarId = opponentRole === 'player1' ? meta.player1AvatarId : meta.player2AvatarId;

  const me = toMyDuelState(myFrame);
  const opponent = toOpponentDuelState(opponentFrame, '', opponentUsername, opponentAvatarId);
  const cardPositionEntries = computeCardPositions(me, opponent);
  const isMyTurn = current.turnPlayer === myRole;

  return (
    <div className="MultiplayerDuelFieldPage ReplayFieldPage">
      <div className="MultiplayerDuelFieldPage-sidePanel">
        <CardDisplay card={hoveredCard} />
        <button type="button" onClick={() => navigate('/replays')}>
          Exit Replay
        </button>
        <div className="ReplayFieldPage-controls">
          {isPlaying ? (
            <button type="button" onClick={pause}>
              Pause
            </button>
          ) : (
            <button type="button" onClick={play}>
              Play
            </button>
          )}
          <span className="ReplayFieldPage-progress">
            {index + 1} / {total}
          </span>
        </div>
        <div className="ReplayFieldPage-matchStatus">Duel {current.duelNumber} of 3</div>
      </div>

      <div className="MultiplayerDuelFieldPage-content">
        <div className="MultiplayerDuelFieldPage-fieldArea">
          <div className="MultiplayerDuelFieldPage-boardStage">
            <DuelField
              playerMainDeck={me.mainDeck.map((c) => c.card)}
              playerExtraDeck={me.extraDeck.map((c) => c.card)}
              playerMonsterZones={me.monsterZones}
              playerSpellTrapZones={me.spellTrapZones}
              playerGrave={me.grave}
              playerBanished={me.banished}
              playerFieldZone={me.fieldZone}
              onCardHover={handleCardHover}
              onCardHoverEnd={handleCardHoverEnd}
              onViewGrave={() => setViewingPile('grave')}
              onViewBanished={() => setViewingPile('banished')}
              opponentMainDeckCount={opponentFrame.publicState.mainDeckCount}
              opponentExtraDeckCount={opponentFrame.publicState.extraDeckCount}
              opponentMonsterZones={opponent.monsterZones}
              opponentSpellTrapZones={opponent.spellTrapZones}
              opponentGrave={opponent.grave}
              opponentBanished={opponent.banished}
              opponentFieldZone={opponent.fieldZone}
              onViewOpponentGrave={() => setViewingOpponentPile('grave')}
              onViewOpponentBanished={() => setViewingOpponentPile('banished')}
              currentPhase={current.currentPhase}
              turnEnding={current.turnEnding}
              isMyTurn={isMyTurn}
              turnNumber={current.turnNumber}
            />
            <Hand
              cards={me.hand}
              onCardHover={handleCardHover}
              onCardHoverEnd={handleCardHoverEnd}
              onNormalSummon={NOOP}
              onActivateSpell={NOOP}
              onSetSpellOrTrap={NOOP}
              onToGrave={NOOP}
              onBanish={NOOP}
              onStackTop={NOOP}
              onStackBottom={NOOP}
              onReveal={NOOP}
              onDeclare={NOOP}
            />
            <CardLayer
              entries={cardPositionEntries}
              me={me}
              opponent={opponent}
              myRole={myRole}
              onCardHover={handleCardHover}
              onCardHoverEnd={handleCardHoverEnd}
              duelNumber={current.duelNumber}
            />
          </div>
        </div>

        <div className="MultiplayerDuelFieldPage-opponentHud">
          <div className="PlayerAvatarBox">
            <img src={getAvatarUrl(opponentAvatarId)} alt="" className="PlayerAvatarBox-image" />
          </div>
          <div className="MultiplayerDuelFieldPage-hudInfo">
            <div className="MultiplayerDuelFieldPage-hudUsernameRow">{opponentUsername}</div>
            <div className="LifePointCounter-display">{opponent.lifePoints}</div>
          </div>
        </div>

        <div className="MultiplayerDuelFieldPage-playerHud">
          <div className="MultiplayerDuelFieldPage-hudInfo">
            <div className="MultiplayerDuelFieldPage-hudUsernameRow">{myUsername}</div>
            <div className="LifePointCounter-display">{me.lifePoints}</div>
          </div>
          <div className="PlayerAvatarBox">
            <img src={getAvatarUrl(myAvatarId)} alt="" className="PlayerAvatarBox-image" />
          </div>
        </div>
      </div>

      {viewingPile && (
        <DeckViewer
          cards={viewingPile === 'grave' ? [...me.grave].reverse() : [...me.banished].reverse()}
          onClose={() => setViewingPile(null)}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
        />
      )}
      {viewingOpponentPile && (
        <DeckViewer
          cards={
            viewingOpponentPile === 'grave'
              ? [...opponent.grave].reverse()
              : [...opponent.banished].reverse()
          }
          onClose={() => setViewingOpponentPile(null)}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
        />
      )}
    </div>
  );
}

export default ReplayFieldPage;
