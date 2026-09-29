import { useCallback, useEffect, useRef, useState } from 'react';
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
import { BOARD_WIDTH, getOpponentHandSlot, getRevealZoneSlot } from '../duel/cardGeometry';
import { DieRollDisplay, ROLL_DURATION_MS } from '../components/DuelField/DieRoller';
import { CoinFlipDisplay, FLIP_DURATION_MS } from '../components/DuelField/CoinFlipper';
// Reused straight from the live duel field rather than re-implemented here
// — same avatar/bubble markup and CSS classes, kept in sync automatically
// (see renderChatMessage's own comment on why it's exported).
import {
  renderChatMessage,
  renderDuelLogOverlay,
  renderExpressionOverlay,
  renderViewingLocationOverlay,
} from './MultiplayerDuelFieldPage';
import type {
  CoinFlipData,
  DieRollData,
  MyDuelState,
  OpponentDuelState,
  PlayerRole,
} from '../components/Matchmaking/useMultiplayerDuel';
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

// Same Card Display hover delay/persistence as DeckBuilderPage and
// MultiplayerDuelFieldPage's own — see DeckBuilderPage's own comment on
// HOVER_DELAY_MS for the full reasoning (briefly passing over other cards
// shouldn't change what's shown, but intentionally checking one should
// still feel responsive).
const HOVER_DELAY_MS = 100;

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

// `prefix` keeps Main Deck and Extra Deck placeholders from ever sharing an
// instanceId — CardLayer/framer-motion track cards across renders BY
// instanceId, so two different piles both generating "placeholder-0",
// "placeholder-1", etc. independently made it look like a single card was
// moving between them (a fly-across animation) every time either pile's
// count changed, since the id "left" one pile's array and "arrived" in the
// other's on the very same render.
//
// `pendingId`, when set, replaces the LAST placeholder slot's id with a
// REAL card instanceId for exactly one frame — see useReplayPlayback's own
// back-patching pass for why: it's the one frame immediately before that
// real card leaves this pile (or immediately after it joins), so it briefly
// shares an id with wherever that card renders on the adjacent frame,
// giving CardLayer's ordinary same-instanceId animation tracking something
// to key off, the same way it always has for a live game's own deck. It's
// still rendered as a plain, identical card back either way — no content or
// order is exposed by this.
function placeholderDeck(count: number, prefix: string, pendingId?: string | null): CardInstance[] {
  const deck = Array.from({ length: Math.max(0, count) }, (_, i) => ({
    instanceId: `${prefix}-placeholder-${i}`,
    card: PLACEHOLDER_CARD,
  }));
  if (pendingId && deck.length > 0) {
    deck[deck.length - 1] = { instanceId: pendingId, card: PLACEHOLDER_CARD };
  }
  return deck;
}

// Reconstructs a full MyDuelState from one player's recorded replay state —
// real hand (this is the "reveal both hands" design choice), real
// board/grave/banished (always-public data even live), placeholder decks
// (never public, never needed for a Main/Extra-Deck-less replay), and the
// player's own recorded activeAttack (see MultiplayerDuelFieldPage's own
// recordReplayFrame calls in handleAttackTargetClick/handleFieldAction, and
// ReplayPlayerState's own comment on why no restamping is needed for this
// one, unlike dieRoll/coinFlip) — CardLayer picks this straight up and plays
// the same attack-resolution animation the live field does.
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
    mainDeck: placeholderDeck(p.mainDeckCount, 'main', player.pendingMainDeckId),
    extraDeck: placeholderDeck(p.extraDeckCount, 'extra', player.pendingExtraDeckId),
    lastHandDepartureIndex: p.lastHandDepartureIndex,
    handShuffleVersion: p.handShuffleVersion,
    mainDeckShuffleVersion: p.mainDeckShuffleVersion,
    openingHandDealt: p.openingHandDealt,
    lastAutoDrawnTurn: p.lastAutoDrawnTurn,
    revealedCard: p.revealedCard,
    lastMainDeckReturnSide: p.lastMainDeckReturnSide,
    activeAttack: player.activeAttack ?? null,
  };
}

function toOpponentDuelState(
  player: ReplayPlayerState,
  uid: string,
  username: string,
  avatarId: string,
): OpponentDuelState {
  // player.activeAttack isn't part of publicState (PublicPlayerState's own
  // activeAttack was never part of buildPublicState's actual output — see
  // recordReplayFrame's own comment on scope), so it's read off the
  // ReplayPlayerState directly here, same as MyDuelState's own copy of this
  // in toMyDuelState.
  return {
    ...player.publicState,
    uid,
    username,
    avatarId,
    activeAttack: player.activeAttack ?? null,
  };
}

function ReplayFieldPage() {
  const { duelId } = useParams<{ duelId: string }>();
  const navigate = useNavigate();
  const { currentUser } = useAuth();
  const { loading, error, meta, current, index, total, isPlaying, play, pause, seek } = useReplayPlayback(
    duelId,
    currentUser?.uid,
  );
  const [hoveredCard, setHoveredCard] = useState<CardData | null>(null);
  // "Card Visibility" — lets a replay viewer choose to see more (or less)
  // hidden information than they'd actually have had live, for reviewing
  // a match afterward. Defaults to 'hideOpponent', which reproduces
  // exactly what a replay showed before this control existed: the
  // viewer's own hand and face-down cards always visible, the opponent's
  // never. ownVisible/opponentVisible below are what everything else
  // actually reads — see their own comment for how the three options map
  // onto those two independent flags.
  const [cardVisibility, setCardVisibility] = useState<'showBoth' | 'hideBoth' | 'hideOpponent'>(
    'hideOpponent',
  );
  const [viewingPile, setViewingPile] = useState<'grave' | 'banished' | null>(null);
  const [viewingOpponentPile, setViewingOpponentPile] = useState<'grave' | 'banished' | null>(null);
  const hoverTimeoutRef = useRef<number | undefined>(undefined);
  // Same auto-scroll-to-bottom behavior as the live duel field's own
  // chatHistoryRef — kept in view of the newest message as playback
  // advances and more of the match's chat history comes into scope,
  // exactly as it would as messages actually arrived live.
  const chatHistoryRef = useRef<HTMLDivElement>(null);
  const chatMessages = current?.chatMessages ?? [];
  useEffect(() => {
    const el = chatHistoryRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages.length]);
  // Same "purely local, both-players-independent" overlay state and
  // auto-scroll behavior as the live duel field's own showDuelLog/
  // duelLogHistoryRef — see MultiplayerDuelFieldPage's own comments on
  // both.
  const [showDuelLog, setShowDuelLog] = useState(false);
  const duelLogHistoryRef = useRef<HTMLDivElement>(null);
  const duelLog = current?.duelLog ?? [];
  useEffect(() => {
    if (!showDuelLog) return;
    const el = duelLogHistoryRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [duelLog.length, showDuelLog]);

  // Same "[Player] will go first" transition screen the live duel field
  // shows at the start of a match and again at the start of duel 2/3 — see
  // MultiplayerDuelFieldPage's own showFirstPlayerBanner comment for the
  // original. Nothing about this screen was ever recorded as its own
  // replay frame (it's not itself duel state, just a local announcement),
  // so it's reconstructed here purely from current.duelNumber/turnPlayer —
  // the same two fields the live version keys off of — rather than gating
  // on openingHandDealt like the live page does: the opening hand is only
  // ever recorded ALREADY fully dealt (see recordedOpeningHandForDuelRef's
  // own comment — there's no card-by-card replay frame for it), so that
  // flag is already true on the very first frame of every duel and would
  // never gate anything here. Keyed on duelNumber actually changing (via
  // seenBannerDuelRef) rather than every render, and fires again on
  // mount for duel 1 same as the live page's own initial `true` state.
  const FIRST_PLAYER_BANNER_MS = 2500;
  const [bannerDuelNumber, setBannerDuelNumber] = useState<number | null>(null);
  const seenBannerDuelRef = useRef<number | null>(null);
  useEffect(() => {
    if (!current || current.turnPlayer === null) return;
    if (seenBannerDuelRef.current === current.duelNumber) return;
    seenBannerDuelRef.current = current.duelNumber;
    setBannerDuelNumber(current.duelNumber);
    const timeoutId = window.setTimeout(() => setBannerDuelNumber(null), FIRST_PLAYER_BANNER_MS);
    return () => window.clearTimeout(timeoutId);
  }, [current?.duelNumber, current?.turnPlayer]);

  // Die roll / coin flip playback — mirrors the live duel field's own
  // myDieRoll/opponentDieRoll/myCoinFlip/opponentCoinFlip -> activeRandomEvent
  // pipeline (see MultiplayerDuelFieldPage's own comment on
  // activeRandomEvent), but DieRollDisplay/CoinFlipDisplay both derive their
  // whole tumble/spin animation from Date.now() - data.startedAt, and the
  // startedAt recorded live is a real wall-clock moment that's almost always
  // long past by the time a replay actually reaches it — left as-is, the
  // roll/flip would already read as fully settled the instant it appeared,
  // with no animation ever visible. So each recorded roll/flip is restamped
  // to right now the first time THIS replay shows its rollId/flipId, letting
  // the same tumble/spin play out fresh, timed to this viewing rather than
  // the original one — and then auto-clears on the same ROLL_DURATION_MS/
  // FLIP_DURATION_MS + 3000 schedule the live page itself uses, rather than
  // depending on the replay happening to land on the recorded 'clear' frame
  // at the right moment.
  const [activeRoll, setActiveRoll] = useState<{ role: PlayerRole; data: DieRollData } | null>(null);
  const [activeFlip, setActiveFlip] = useState<{ role: PlayerRole; data: CoinFlipData } | null>(null);
  const rollClearTimeoutRef = useRef<number | undefined>(undefined);
  const flipClearTimeoutRef = useRef<number | undefined>(undefined);
  const lastRollIdRef = useRef<{ player1: string | null; player2: string | null }>({
    player1: null,
    player2: null,
  });
  const lastFlipIdRef = useRef<{ player1: string | null; player2: string | null }>({
    player1: null,
    player2: null,
  });
  useEffect(() => {
    for (const role of ['player1', 'player2'] as PlayerRole[]) {
      const roll = current?.[role]?.dieRoll ?? null;
      if (roll && lastRollIdRef.current[role] !== roll.rollId) {
        lastRollIdRef.current[role] = roll.rollId;
        if (rollClearTimeoutRef.current !== undefined) {
          window.clearTimeout(rollClearTimeoutRef.current);
        }
        const restamped: DieRollData = { ...roll, startedAt: Date.now() };
        setActiveRoll({ role, data: restamped });
        rollClearTimeoutRef.current = window.setTimeout(() => {
          setActiveRoll((prev) => (prev?.data.rollId === roll.rollId ? null : prev));
          rollClearTimeoutRef.current = undefined;
        }, ROLL_DURATION_MS + 3000);
      } else if (!roll) {
        lastRollIdRef.current[role] = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.player1?.dieRoll?.rollId, current?.player2?.dieRoll?.rollId]);
  useEffect(() => {
    for (const role of ['player1', 'player2'] as PlayerRole[]) {
      const flip = current?.[role]?.coinFlip ?? null;
      if (flip && lastFlipIdRef.current[role] !== flip.flipId) {
        lastFlipIdRef.current[role] = flip.flipId;
        if (flipClearTimeoutRef.current !== undefined) {
          window.clearTimeout(flipClearTimeoutRef.current);
        }
        const restamped: CoinFlipData = { ...flip, startedAt: Date.now() };
        setActiveFlip({ role, data: restamped });
        flipClearTimeoutRef.current = window.setTimeout(() => {
          setActiveFlip((prev) => (prev?.data.flipId === flip.flipId ? null : prev));
          flipClearTimeoutRef.current = undefined;
        }, FLIP_DURATION_MS + 3000);
      } else if (!flip) {
        lastFlipIdRef.current[role] = null;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.player1?.coinFlip?.flipId, current?.player2?.coinFlip?.flipId]);
  // Same "at most one of the two kinds shown at once, more recently
  // started wins" reduction as the live page's own activeRandomEvent —
  // both restamped startedAt values above are directly comparable since
  // they're both "now" at the moment each was triggered.
  const activeRandomEvent: { kind: 'die'; data: DieRollData } | { kind: 'coin'; data: CoinFlipData } | null =
    activeRoll && (!activeFlip || activeRoll.data.startedAt >= activeFlip.data.startedAt)
      ? { kind: 'die', data: activeRoll.data }
      : activeFlip
        ? { kind: 'coin', data: activeFlip.data }
        : null;

  const handleCardHover = useCallback((card: CardData) => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredCard(card);
    }, HOVER_DELAY_MS);
  }, []);

  // Mouse left a card before the delay finished — cancel the pending timer
  // so it never fires. Deliberately does NOT touch hoveredCard itself, so
  // the currently-displayed card stays put until a different card is
  // hovered for the full delay, rather than clearing the moment the
  // cursor leaves.
  const handleCardHoverEnd = useCallback(() => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
  }, []);

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

  // Shown in place of the whole field, same as the live duel field's own
  // showFirstPlayerBanner branch — see the effect above for why this reads
  // off duelNumber/turnPlayer rather than openingHandDealt.
  if (bannerDuelNumber !== null && current.duelNumber === bannerDuelNumber && current.turnPlayer) {
    const firstPlayerName = current.turnPlayer === myRole ? myUsername : opponentUsername;
    return (
      <div className="MultiplayerDuelFieldPage-status">
        <p className="MultiplayerDuelFieldPage-firstPlayerAnnouncement">{firstPlayerName} will go first</p>
        <p className="MultiplayerDuelFieldPage-duelAnnouncementSubtext">Duel {current.duelNumber} of 3</p>
      </div>
    );
  }

  const me = toMyDuelState(myFrame);
  const opponent = toOpponentDuelState(opponentFrame, '', opponentUsername, opponentAvatarId);
  // The two independent flags cardVisibility actually maps onto —
  // ownVisible covers the viewer's own hand and face-down cards,
  // opponentVisible the opponent's. 'showBoth' sets both, 'hideBoth'
  // clears both, and 'hideOpponent' (the default) is the only option
  // where they differ — own visible, opponent's not — which is also
  // exactly what a replay showed before this control existed.
  const ownVisible = cardVisibility !== 'hideBoth';
  const opponentVisible = cardVisibility === 'showBoth';
  const cardPositionEntries = computeCardPositions(me, opponent, {
    hideMyHand: !ownVisible,
    revealedOpponentHand: opponentVisible ? opponentFrame.hand : undefined,
  });
  const isMyTurn = current.turnPlayer === myRole;
  const randomEventSlot = activeRandomEvent ? getRevealZoneSlot() : null;

  return (
    <div className="MultiplayerDuelFieldPage ReplayFieldPage">
      <div
        className="MultiplayerDuelFieldPage-sidePanel"
        style={{ right: `calc(50% + ${BOARD_WIDTH / 2 + 16}px)` }}
      >
        <CardDisplay card={hoveredCard} />

        {/* Same sidePanelActions/topActions grouping and class names as
            the live duel field's own Exit/Duel Log row — see
            MultiplayerDuelFieldPage's own comment on that layout. */}
        <div className="MultiplayerDuelFieldPage-sidePanelActions">
          <div className="MultiplayerDuelFieldPage-topActions">
            <button
              type="button"
              className="MultiplayerDuelFieldPage-exitButton"
              onClick={() => navigate('/replays')}
            >
              Exit Replay
            </button>
            <button
              type="button"
              className="MultiplayerDuelFieldPage-duelLogButton"
              onClick={() => setShowDuelLog(true)}
            >
              Duel Log
            </button>
          </div>
        </div>
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
          {/* Steps forward exactly one recorded frame at a time — for
              stepping through a play-by-play at the viewer's own pace
              rather than only ever at the fixed auto-advance cadence
              Play uses. Only meaningful while paused (advancing a single
              step mid-autoplay would just get immediately overtaken by
              the next auto-advance a moment later), and disabled at the
              very last frame the same way Play/Pause naturally stop
              mattering there too. */}
          <button
            type="button"
            onClick={() => seek(index + 1)}
            disabled={isPlaying || index >= total - 1}
          >
            Next Play
          </button>
          <span className="ReplayFieldPage-progress">
            {index + 1} / {total}
          </span>
        </div>
        {/* Lets the viewer choose to see more (or less) than they'd
            actually have had live — see cardVisibility's own comment for
            what each option maps onto and why 'hideOpponent' is the
            default. Affects both hands (rendered through CardLayer's own
            entries — see computeCardPositions' own new options) and Card
            Display when hovering a face-down card (see DuelField's own
            hideOwnFaceDown/revealOpponentFaceDown props, and the <Hand>
            below's own onCardHover for the hand's own copy of that same
            gating). */}
        <div className="ReplayFieldPage-visibilityRow">
          <label htmlFor="ReplayFieldPage-cardVisibility">Card Visibility</label>
          <select
            id="ReplayFieldPage-cardVisibility"
            value={cardVisibility}
            onChange={(event) =>
              setCardVisibility(event.target.value as 'showBoth' | 'hideBoth' | 'hideOpponent')
            }
          >
            <option value="showBoth">Show Both</option>
            <option value="hideBoth">Hide Both</option>
            <option value="hideOpponent">Hide Opponent</option>
          </select>
        </div>
        {/* Same class/markup as the live duel field's own matchStatus —
            "Duel N of 3" plus the best-of-3 win tally — rather than the
            page's own simplified copy, so styling and positioning stay
            identical rather than just similar. */}
        <div className="MultiplayerDuelFieldPage-matchStatus">
          <div>Duel {current.duelNumber} of 3</div>
          Wins: You{' '}
          {myRole === 'player1' ? current.matchWins.player1 : current.matchWins.player2} ·
          Opponent{' '}
          {myRole === 'player1' ? current.matchWins.player2 : current.matchWins.player1}
        </div>
      </div>

      <div className="MultiplayerDuelFieldPage-content" style={{ marginLeft: -(BOARD_WIDTH / 2) }}>
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
              menusDisabled
              hideOwnFaceDown={!ownVisible}
              revealOpponentFaceDown={opponentVisible}
            />
            <Hand
              cards={me.hand}
              onCardHover={ownVisible ? handleCardHover : undefined}
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
              menusDisabled
            />
            {/* Only rendered when the viewer has actually chosen to reveal
                the opponent's hand ("Show Both") — cardPositionEntries
                above already carries their real card identities for
                CardLayer in that case (see computeCardPositions' own
                revealedOpponentHand option), but CardLayer itself is purely
                visual (pointer-events: none), so without this second Hand
                instance — laid out at the opponent's own hand position via
                getOpponentHandSlot — there would be no hover target there
                at all and Card Display could never show those cards. */}
            {opponentVisible && (
              <Hand
                cards={opponentFrame.hand}
                slotForIndex={getOpponentHandSlot}
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
                menusDisabled
              />
            )}
            <CardLayer
              entries={cardPositionEntries}
              me={me}
              opponent={opponent}
              myRole={myRole}
              onCardHover={handleCardHover}
              onCardHoverEnd={handleCardHoverEnd}
              duelNumber={current.duelNumber}
            />

            {/* Same shared reveal-zone die roll / coin flip display as the
                live duel field's own boardStage — see this page's own
                activeRandomEvent effects above for how it's restamped and
                cleared. Purely a display, same as live (pointerEvents:
                'none', no button — the buttons that start a roll/flip only
                ever exist on the live field). */}
            {activeRandomEvent && randomEventSlot && (
              <div
                className="MultiplayerDuelFieldPage-dieRollZone"
                style={{
                  position: 'absolute',
                  left: randomEventSlot.x,
                  top: randomEventSlot.y,
                  width: randomEventSlot.width,
                  height: randomEventSlot.height,
                  pointerEvents: 'none',
                }}
              >
                {activeRandomEvent.kind === 'die' ? (
                  <DieRollDisplay roll={activeRandomEvent.data} />
                ) : (
                  <CoinFlipDisplay flip={activeRandomEvent.data} />
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Siblings of .MultiplayerDuelFieldPage-content, NOT nested inside
          it — matching the live duel field's own structure exactly (see
          that page's own comment on why: .content is itself
          position: absolute and sized only to fit the board, so a HUD
          nested inside it would position: absolute against ITS box
          instead of the whole page, landing bottom/top against the
          board's own edge rather than the page's — which is exactly what
          made this HUD sit noticeably higher up than on the live field). */}
      <div
        className="MultiplayerDuelFieldPage-opponentHud"
        style={{ left: `calc(50% + ${BOARD_WIDTH / 2 + 16}px)`, right: 'auto' }}
      >
        {/* Same hudRow/hudInfo structure and class names as the live
            duel field's own opponentHud (username first/top, LP
            counter second/bottom, avatar spanning the full height to
            the right) — see MultiplayerDuelFieldPage's own comment on
            that ordering. */}
        <div className="MultiplayerDuelFieldPage-hudRow MultiplayerDuelFieldPage-hudRow--opponent">
          <div className="MultiplayerDuelFieldPage-hudInfo">
            <div className="MultiplayerDuelFieldPage-hudUsernameRow">
              <span className="MultiplayerDuelFieldPage-hudUsername">{opponentUsername}</span>
            </div>
            <div className="LifePointCounter-display MultiplayerDuelFieldPage-opponentLpDisplay">
              {opponent.lifePoints}
            </div>
          </div>
          <div className="PlayerAvatarBox PlayerAvatarBox--opponentTurn">
            <img src={getAvatarUrl(opponentAvatarId)} alt="" className="PlayerAvatarBox-image" />
            {renderExpressionOverlay(opponentFrame.expression ?? null)}
            {renderViewingLocationOverlay(opponentFrame.viewingLocation ?? null)}
          </div>
        </div>
      </div>

      <div
        className="MultiplayerDuelFieldPage-playerHud"
        style={{ left: `calc(50% + ${BOARD_WIDTH / 2 + 16}px)`, right: 'auto' }}
      >
        {/* Player Chat — read-only here (no input row, no Thumbs-up/
            Thinking buttons, per the replay feature's own spec), but
            same message history box, same position in this column
            (directly above the username), and same renderChatMessage
            markup/styling as the live duel field. */}
        <div className="MultiplayerDuelFieldPage-chatHistory" ref={chatHistoryRef}>
          {[...chatMessages]
            .sort((a, b) => a.sentAt - b.sentAt)
            .map((message) => renderChatMessage(message, myRole, myAvatarId, opponentAvatarId))}
        </div>
        <div className="MultiplayerDuelFieldPage-hudRow MultiplayerDuelFieldPage-hudRow--player">
          <div className="MultiplayerDuelFieldPage-hudInfo">
            <div className="MultiplayerDuelFieldPage-hudUsernameRow">
              <span className="MultiplayerDuelFieldPage-hudUsername">{myUsername}</span>
            </div>
            <div className="LifePointCounter-display">{me.lifePoints}</div>
          </div>
          <div className="PlayerAvatarBox PlayerAvatarBox--myTurn">
            <img src={getAvatarUrl(myAvatarId)} alt="" className="PlayerAvatarBox-image" />
            {renderExpressionOverlay(myFrame.expression ?? null)}
            {renderViewingLocationOverlay(myFrame.viewingLocation ?? null)}
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
      {showDuelLog &&
        renderDuelLogOverlay(duelLog, myRole, () => setShowDuelLog(false), duelLogHistoryRef)}
    </div>
  );
}

export default ReplayFieldPage;
