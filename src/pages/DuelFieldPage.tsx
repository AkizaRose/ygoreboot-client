import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import DuelField from '../components/DuelField/DuelField';
import Hand from '../components/DuelField/Hand';
import DeckViewer from '../components/DuelField/DeckViewer';
import ConfirmDialog from '../components/ConfirmDialog/ConfirmDialog';
import SummonPositionDialog from '../components/DuelField/SummonPositionDialog';
import CardDisplay from '../components/CardDisplay/CardDisplay';
import LifePointCounter from '../components/DuelField/LifePointCounter';
import { useSavedDecks } from '../components/DeckManager/useSavedDecks';
import { shuffle } from '../utils/shuffle';
import cardData from '../data/carddata.json';
import type { CardData } from '../types/Card';
import { type CardInstance, type PlacedCard, createCardInstance } from '../types/CardInstance';
import './DuelFieldPage.css';

// Same debounce behavior as the Deck Builder page's Card Display: the
// cursor has to rest on a card for this long before it updates what's
// shown, and leaving a card early cancels that pending update entirely
// rather than showing it late regardless.
const HOVER_DELAY_MS = 100;

const EMPTY_ZONES: (PlacedCard | null)[] = [null, null, null];

// Center, then right, then left — the visual priority zones fill in,
// rather than strict left-to-right index order. Applies identically to
// Monster Zone and Spell/Trap Zone, since both are the same 3-slot
// layout.
const ZONE_PRIORITY_ORDER = [1, 2, 0];
function findEmptyZoneSlot(zones: (PlacedCard | null)[]): number {
  for (const index of ZONE_PRIORITY_ORDER) {
    if (zones[index] === null) return index;
  }
  return -1;
}

const PHASES = ['draw', 'main1', 'battle', 'main2', 'end'] as const;
type Phase = (typeof PHASES)[number];
const PHASE_LABELS: Record<Phase, string> = {
  draw: 'Draw Phase',
  main1: 'Main Phase 1',
  battle: 'Battle Phase',
  main2: 'Main Phase 2',
  end: 'End Phase',
};

function DuelFieldPage() {
  const navigate = useNavigate();
  const { deckId } = useParams<{ deckId: string }>();
  const { getSavedDeck, loading: savedDecksLoading } = useSavedDecks();
  const cards = cardData as CardData[];

  const [hoveredCard, setHoveredCard] = useState<CardData | null>(null);
  const hoverTimeoutRef = useRef<number | undefined>(undefined);

  const handleCardHover = useCallback((card: CardData) => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
    }
    hoverTimeoutRef.current = window.setTimeout(() => {
      setHoveredCard(card);
    }, HOVER_DELAY_MS);
  }, []);

  const handleCardHoverEnd = useCallback(() => {
    if (hoverTimeoutRef.current !== undefined) {
      window.clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = undefined;
    }
  }, []);

  // Every card that has ever entered play carries a stable instanceId
  // (see src/types/CardInstance.ts) that persists across every move for
  // the rest of the duel — that's what all the arrays below now hold,
  // rather than plain CardData.
  const [mainDeck, setMainDeck] = useState<CardInstance[]>([]);
  // Kept in sync with mainDeck on every render (a direct assignment, not
  // an effect — this is deliberately synchronous, so it's never one
  // render "behind"). handleDrawCard reads from this instead of the
  // mainDeck closure directly, so it stays correct even if it's called
  // from a callback whose closure predates a later mainDeck update — in
  // particular, StrictMode double-invokes the mount effect that calls
  // loadDeck in dev, and the auto-draw effect's already-scheduled
  // timeout (from the first invocation) would otherwise still reference
  // the pre-reshuffle deck from before the second invocation's fresh
  // loadDeck/reshuffle, causing exactly this kind of stale read for
  // whichever draws that first (now-orphaned) timeout chain manages to
  // perform before the mismatch resolves itself.
  const mainDeckRef = useRef(mainDeck);
  mainDeckRef.current = mainDeck;
  const [extraDeck, setExtraDeck] = useState<CardInstance[]>([]);
  const [hand, setHand] = useState<CardInstance[]>([]);
  const [lifePoints, setLifePoints] = useState(8000);
  const [phase, setPhase] = useState<Phase>('draw');

  // Drives the "Shuffle Hand" animation — true for the whole duration
  // (piling, the reorder itself, and spreading back out). See Hand's
  // `piled` prop for what this changes visually.
  const [isHandPiled, setIsHandPiled] = useState(false);

  const handleShuffleHand = () => {
    if (isHandPiled || hand.length < 2 || pendingOpeningDraws > 0) return;
    setIsHandPiled(true);
  };

  const handleAddLifePoints = (amount: number) => {
    setLifePoints((prev) => prev + amount);
  };

  const handleSubtractLifePoints = (amount: number) => {
    setLifePoints((prev) => Math.max(0, prev - amount));
  };

  // Cycles rather than clamping at either end — useful for a tracker
  // meant to be clicked through continuously across many turns, so
  // reaching End Phase and clicking "next" rolls straight back to Draw
  // Phase for the next turn instead of getting stuck.
  const handlePrevPhase = () => {
    setPhase((prev) => {
      const index = PHASES.indexOf(prev);
      return PHASES[(index - 1 + PHASES.length) % PHASES.length];
    });
  };

  const handleNextPhase = () => {
    setPhase((prev) => {
      const index = PHASES.indexOf(prev);
      return PHASES[(index + 1) % PHASES.length];
    });
  };

  useEffect(() => {
    if (!isHandPiled) return;

    // Timed to land after the pile-converge animation (Hand's layout
    // transition is 0.35s) has visibly finished — the actual reorder is
    // invisible to the player regardless, since every card is stacked
    // at the same position with only the top one showing, but waiting
    // avoids reordering mid-movement.
    const reorderTimeout = window.setTimeout(() => {
      setHand((prev) => shuffle(prev));
    }, 350);
    // A brief pause once piled (showing the new top card, post-reorder)
    // before spreading back out, rather than immediately reversing —
    // reads more like a deliberate shuffle than a glitch.
    const spreadTimeout = window.setTimeout(() => {
      setIsHandPiled(false);
    }, 550);

    return () => {
      window.clearTimeout(reorderTimeout);
      window.clearTimeout(spreadTimeout);
    };
  }, [isHandPiled]);

  const [playerMonsterZones, setPlayerMonsterZones] = useState<(PlacedCard | null)[]>(EMPTY_ZONES);
  const [playerSpellTrapZones, setPlayerSpellTrapZones] =
    useState<(PlacedCard | null)[]>(EMPTY_ZONES);
  const [playerGrave, setPlayerGrave] = useState<CardInstance[]>([]);
  const [playerBanished, setPlayerBanished] = useState<CardInstance[]>([]);
  const [playerFieldZone, setPlayerFieldZone] = useState<PlacedCard | null>(null);
  const [viewingDeck, setViewingDeck] = useState<'main' | 'extra' | 'grave' | 'banished' | null>(
    null,
  );
  const [isResetConfirmOpen, setIsResetConfirmOpen] = useState(false);

  // How many of the opening hand's cards still need to be auto-drawn
  // after a new game starts or Reset is pressed — purely a UI-facing
  // count (disabling manual draw/shuffle while it's above 0). The actual
  // scheduling is handled imperatively via openingDrawTimeoutRef below
  // rather than a useEffect keyed to this value — seeloadDraws for why.
  const [pendingOpeningDraws, setPendingOpeningDraws] = useState(0);
  // Deliberately NOT part of React's effect system. A useEffect watching
  // a counter (the earlier approach here) re-runs its setup function in
  // response to a dependency change — which is exactly the mechanism
  // React StrictMode deliberately double-invokes on mount in dev, to
  // help surface exactly this kind of bug. This project has StrictMode
  // enabled (see main.tsx), and empirically, some number of the opening
  // hand's early draws were consistently losing their flip hint — this
  // ref-based approach sidesteps the whole class of issue by keeping the
  // scheduling imperative and self-cancelling, rather than declarative
  // and dependency-triggered.
  const openingDrawTimeoutRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    return () => {
      if (openingDrawTimeoutRef.current !== undefined) {
        window.clearTimeout(openingDrawTimeoutRef.current);
      }
    };
  }, []);

  // Shared by every summon action (Normal Summon, and Special Summon from
  // each of the four viewers) — rather than duplicating dialog logic at
  // each call site, a handler just calls requestSummonPosition with the
  // card and a callback describing how to actually complete the
  // placement; the callback only runs once a position is chosen.
  const [pendingSummon, setPendingSummon] = useState<{
    card: CardData;
    onSelectPosition: (position: 'attack' | 'defense') => void;
  } | null>(null);

  const requestSummonPosition = (
    card: CardData,
    onSelectPosition: (position: 'attack' | 'defense') => void,
  ) => {
    setPendingSummon({ card, onSelectPosition });
  };

  // Per-instanceId starting rotation for a card's very first frame after
  // arriving in Hand — populated only when a card leaves a Monster Zone,
  // so Hand knows whether to visually start it at -90° (if it was in
  // Defense Position) or upright (if not) and animate from there, rather
  // than the rotation just snapping the instant it appears (mirrors the
  // same "no previous frame to animate from" issue the Defense Position
  // summon animation had). Every write is explicit about both cases
  // (-90 or 0) rather than only writing the Defense case and relying on
  // a default for Attack — a card that was once in Defense Position,
  // then switched back to Attack, then later sent to hand, would
  // otherwise still read its old (now-incorrect) -90 entry.
  const [handEntryRotations, setHandEntryRotations] = useState<Record<string, number>>({});
  // Same idea as handEntryRotations, for the flip-reveal effect instead
  // — true means a card leaving a field zone was showing face-down, so
  // Hand should start it "edge-on" and unfurl into its face rather than
  // popping straight in. Always written explicitly (never only for the
  // true case) for the same reason as handEntryRotations: a card that
  // was once face-down, then flipped face-up via Activate, then later
  // sent to hand, must not read a stale "true" from its earlier stint
  // face-down.
  const [handEntryFlips, setHandEntryFlips] = useState<Record<string, boolean>>({});

  // Every card in Hand keeps a stable key for as long as it's there, so
  // in the ordinary case handEntryFlips/handEntryRotations never need
  // clearing — each card only ever mounts fresh once, on its one genuine
  // arrival, and `initial` is only ever read at that mount, which
  // happens synchronously during render/commit — well before any effect
  // (including this one) gets a chance to run. That's what makes it safe
  // to clear a hint immediately here, with no delay: by the time this
  // effect sees a given instanceId for the first time, its one legitimate
  // read has already happened. Shuffling the hand doesn't remount
  // anything either (same stable keys, just reordered), so it shouldn't
  // need this at all — but empirically, a card whose entry hint was
  // still sitting here from an earlier arrival was visibly replaying its
  // flip during the shuffle's layout animation, and also (once cards
  // could arrive in rapid succession, via the opening hand's automatic
  // draw sequence) during ordinary drawing. An earlier version of this
  // cleanup used a fixed delay instead of tracking arrivals directly,
  // which likely broke down under exactly that rapid-succession case —
  // this version, keyed to genuinely new arrivals rather than a timer,
  // avoids that regardless of how quickly cards arrive.
  const seenHandCardIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const currentIds = new Set(hand.map((c) => c.instanceId));
    const newlyArrivedIds = [...currentIds].filter((id) => !seenHandCardIdsRef.current.has(id));

    if (newlyArrivedIds.length > 0) {
      setHandEntryFlips((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of newlyArrivedIds) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      setHandEntryRotations((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id of newlyArrivedIds) {
          if (id in next) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }

    seenHandCardIdsRef.current = currentIds;
  }, [hand]);

  // Same idea again, but for the Main Deck's top-card wrapper instead of
  // Hand — true means this specific instanceId just arrived at the top
  // of the deck via a "Stack (to top)" action (from Hand, a field zone,
  // Grave, or Banished), so it should play the flip-reveal "unfurl"
  // effect and turn face-down into place, rather than the normal case
  // of a draw simply exposing whatever card was already underneath
  // (which was already face-down and shouldn't visually flip at all).
  // Only ever written true — read once via FieldZone's `initial` prop
  // on that one mount, so there's no stale-data concern the way there
  // was with handEntryRotations (nothing ever needs to explicitly clear
  // it back to false for correctness).
  const [deckEntryFlips, setDeckEntryFlips] = useState<Record<string, boolean>>({});
  // Same idea, for a Defense Position monster being Stacked (to top) —
  // needs to visually rotate back to upright while it moves, at the same
  // time as deckEntryFlips' flip-reveal. Only ever written from
  // handleFieldAction's 'stackTop' case (the only "stack to top" source
  // that can carry a `position`), always explicitly (both -90 and 0),
  // for the same stale-data reason as every other entry-rotation map.
  const [deckEntryRotations, setDeckEntryRotations] = useState<Record<string, number>>({});

  // A card currently leaving Main/Extra Deck via a viewer action (e.g.
  // "To Grave"), which can be any card in the pile — not necessarily the
  // tracked top or bottom — so there's normally no matching source
  // element for the destination to animate from at all. This gives it
  // one, purely so the move has somewhere to animate from.
  const [mainDeckDepartureCardId, setMainDeckDepartureCardId] = useState<string | undefined>(
    undefined,
  );
  const [extraDeckDepartureCardId, setExtraDeckDepartureCardId] = useState<string | undefined>(
    undefined,
  );

  // The actual move (removing the departure marker AND adding the card
  // to its destination) is deliberately deferred to a separate render
  // via this effect, rather than happening in the same batch as setting
  // the departure marker above. If both happened together, the
  // departure element (deck) and the destination element (Grave/
  // Banished) would both be FRESH mounts sharing the same layoutId in
  // the very same render — framer-motion's shared-layout matching
  // expects at most one element per layoutId at any given moment, and
  // two simultaneous claims on the same id produced a visible "moves
  // there, snaps back, then plays the real animation" glitch. Deferring
  // the destination update to the next render instead means the
  // departure element unmounts in the EXACT same render the destination
  // mounts — a clean, sequential unmount/mount pair, matching how every
  // other working transition (draw, stack-to-top) is structured.
  const [pendingDeckDeparture, setPendingDeckDeparture] = useState<{
    source: 'main' | 'extra';
    instance: CardInstance;
    destination: 'grave' | 'banish' | 'monsterZone';
    // Only used for the 'monsterZone' destination.
    monsterZoneSlot?: number;
    monsterPosition?: 'attack' | 'defense';
  } | null>(null);

  useEffect(() => {
    if (!pendingDeckDeparture) return;
    const { source, instance, destination, monsterZoneSlot, monsterPosition } =
      pendingDeckDeparture;

    if (source === 'main') {
      setMainDeckDepartureCardId(undefined);
    } else {
      setExtraDeckDepartureCardId(undefined);
    }
    setFieldZoneEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
    if (destination === 'grave') {
      setPlayerGrave((prev) => [...prev, instance]);
    } else if (destination === 'banish') {
      setPlayerBanished((prev) => [...prev, instance]);
    } else if (monsterZoneSlot !== undefined && monsterPosition) {
      // The rotation for arriving in Defense Position needs no entry-hint
      // write here, unlike the flip above — the Monster Zone's own
      // rotation wrapper (see FieldZone) already always starts at 0 and
      // animates to whatever battlePosition says on every fresh mount,
      // which already produces the right "was upright in the deck,
      // rotates to Defense while moving" effect on its own.
      setPlayerMonsterZones((prev) => {
        const next = [...prev];
        next[monsterZoneSlot] = { ...instance, faceDown: false, position: monsterPosition };
        return next;
      });
    }
    setPendingDeckDeparture(null);
  }, [pendingDeckDeparture]);

  // Unlike Hand and Grave/Banished (where each card keeps a stable React
  // key for as long as it's there, so `initial` only ever applies once,
  // on its one genuine arrival), the Main Deck's top/bottom cards and the
  // Extra Deck's top card are each tracked via a key that changes to
  // whatever instanceId currently occupies that position (see FieldZone's
  // topCardInstanceId / bottomCardInstanceId) — this is what makes the
  // draw and stack-to-bottom/top animations work, but it also means the
  // SAME card can force a fresh mount a second time, with no action of
  // its own — e.g. a card Stacked to the bottom, later passively
  // becoming the top once the deck has shrunk enough to reach it, or an
  // Extra Deck card that was under the top, passively becoming the new
  // top once whatever was on top of it gets Special Summoned or sent to
  // Grave/Banished via the viewer. Without clearing a hint once it's
  // been consumed, that second mount would incorrectly re-read the
  // original (by-then-stale) value and replay the flip/rotation again.
  // This runs right after the render where a hint was consumed, so it
  // doesn't affect the animation already in progress — `initial` is only
  // ever read at mount, not on subsequent re-renders of the same
  // instance.
  const mainDeckTopCardIdRef = useRef<string | undefined>(undefined);
  const mainDeckBottomCardIdRef = useRef<string | undefined>(undefined);
  const extraDeckTopCardIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const clearDeckEntryHint = (instanceId: string) => {
      setDeckEntryRotations((prev) => {
        if (!(instanceId in prev)) return prev;
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
      setDeckEntryFlips((prev) => {
        if (!(instanceId in prev)) return prev;
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
    };

    const currentTopId = mainDeck[0]?.instanceId;
    if (currentTopId && currentTopId !== mainDeckTopCardIdRef.current) {
      clearDeckEntryHint(currentTopId);
    }
    mainDeckTopCardIdRef.current = currentTopId;

    // Only meaningfully distinct from the top when there's more than one
    // card — matches the same guard used when computing the bottom-card
    // props passed to DuelField, so this doesn't re-process the same
    // card the top-tracking above already just handled.
    const currentBottomId =
      mainDeck.length > 1 ? mainDeck[mainDeck.length - 1]?.instanceId : undefined;
    if (currentBottomId && currentBottomId !== mainDeckBottomCardIdRef.current) {
      clearDeckEntryHint(currentBottomId);
    }
    mainDeckBottomCardIdRef.current = currentBottomId;
  }, [mainDeck]);

  useEffect(() => {
    const clearDeckEntryHint = (instanceId: string) => {
      setDeckEntryRotations((prev) => {
        if (!(instanceId in prev)) return prev;
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
      setDeckEntryFlips((prev) => {
        if (!(instanceId in prev)) return prev;
        const next = { ...prev };
        delete next[instanceId];
        return next;
      });
    };

    const currentTopId = extraDeck[0]?.instanceId;
    if (currentTopId && currentTopId !== extraDeckTopCardIdRef.current) {
      clearDeckEntryHint(currentTopId);
    }
    extraDeckTopCardIdRef.current = currentTopId;
  }, [extraDeck]);

  // Same idea as handEntryRotations, for a Defense Position monster
  // being sent to Grave/Banished instead of Hand — needs to visually
  // unwind back to upright while it moves there, rather than snapping
  // straight the instant it arrives. Shared by both zones since an
  // instanceId is only ever in one place at a time. Always written
  // explicitly (both the -90 and the 0 case) for the same stale-data
  // reason as handEntryRotations — a card that was once in Defense
  // Position, switched back to Attack, then later sent to Grave, must
  // not read a stale -90 from its earlier stint in Defense.
  const [fieldZoneEntryRotations, setFieldZoneEntryRotations] = useState<Record<string, number>>(
    {},
  );
  // Same idea, shared by Grave and Banished, for a face-down field card
  // (Set Spell/Trap/Field Spell) being sent there — needs to visually
  // unfurl into its revealed face while it moves, rather than the
  // destination just instantly showing the face while only the move
  // itself animates. Always written explicitly (both the true and false
  // case) for the same reason as the others — a card that's already
  // face-up shouldn't play this at all.
  const [fieldZoneEntryFlips, setFieldZoneEntryFlips] = useState<Record<string, boolean>>({});

  // Resolves the currently-selected saved deck into real card instances
  // (each getting a brand-new instanceId here — this is the ONLY place
  // new ones are ever created), shuffles the Main Deck, deals the
  // opening hand, and clears every other piece of game state back to a
  // fresh starting point. Extracted as its own function (rather than
  // being inline in the effect below) so the Reset action can call it
  // directly on demand, not just on initial load/deckId change.
  const loadDeck = () => {
    if (!deckId) {
      setMainDeck([]);
      setExtraDeck([]);
      setHand([]);
      setPlayerMonsterZones(EMPTY_ZONES);
      setPlayerSpellTrapZones(EMPTY_ZONES);
      setPlayerGrave([]);
      setPlayerBanished([]);
      setPlayerFieldZone(null);
      setHandEntryRotations({});
      setHandEntryFlips({});
      setDeckEntryFlips({});
      setIsHandPiled(false);
      setDeckEntryRotations({});
      setFieldZoneEntryRotations({});
      setFieldZoneEntryFlips({});
      setLifePoints(8000);
      setPhase('draw');
      scheduleOpeningDraws(0);
      seenHandCardIdsRef.current = new Set();
      return;
    }

    const saved = getSavedDeck(deckId);
    if (!saved) {
      setMainDeck([]);
      setExtraDeck([]);
      setHand([]);
      setPlayerMonsterZones(EMPTY_ZONES);
      setPlayerSpellTrapZones(EMPTY_ZONES);
      setPlayerGrave([]);
      setPlayerBanished([]);
      setPlayerFieldZone(null);
      setHandEntryRotations({});
      setHandEntryFlips({});
      setDeckEntryFlips({});
      setIsHandPiled(false);
      setDeckEntryRotations({});
      setFieldZoneEntryRotations({});
      setFieldZoneEntryFlips({});
      setLifePoints(8000);
      setPhase('draw');
      scheduleOpeningDraws(0);
      seenHandCardIdsRef.current = new Set();
      return;
    }

    const cardsById = new Map(cards.map((c) => [c.id, c]));
    const resolve = (ids: number[]): CardInstance[] =>
      ids
        .map((id) => {
          const found = cardsById.get(id);
          if (!found) console.warn(`[DuelFieldPage] Saved card id ${id} not found — skipped.`);
          return found;
        })
        .filter((c): c is CardData => !!c)
        .map((c) => createCardInstance(c));

    // Main Deck: randomized order, per real deck-building rules. The
    // opening hand is no longer dealt directly here — it starts empty
    // and gets drawn one card at a time (see scheduleOpeningDraws
    // below), so the player sees each card actually leave the deck via
    // the normal draw animation, rather than the hand just appearing
    // fully formed from nothing.
    const shuffledMain = shuffle(resolve(saved.main));

    setMainDeck(shuffledMain);
    // Extra Deck: kept in the same order as the Deck Builder — not
    // shuffled, since Extra Deck monsters are chosen deliberately during
    // a duel rather than drawn at random.
    setExtraDeck(resolve(saved.extra));
    setHand([]);
    setPlayerMonsterZones(EMPTY_ZONES);
    setPlayerSpellTrapZones(EMPTY_ZONES);
    setPlayerGrave([]);
    setPlayerBanished([]);
    setPlayerFieldZone(null);
    setHandEntryRotations({});
    setHandEntryFlips({});
    setDeckEntryFlips({});
    setIsHandPiled(false);
    setDeckEntryRotations({});
    setFieldZoneEntryRotations({});
    setFieldZoneEntryFlips({});
    setLifePoints(8000);
    setPhase('draw');
    seenHandCardIdsRef.current = new Set();
    scheduleOpeningDraws(Math.min(5, shuffledMain.length));
  };

  // (Re)loads whenever deckId changes — e.g. navigating here for a
  // different deck. Runs once per deckId, not on every render.
  // Also waits for savedDecksLoading to clear first — unlike the old
  // localStorage-backed version, useSavedDecks now reads from Firestore
  // asynchronously, so on a fresh mount getSavedDeck could easily still
  // be working from an empty list that hasn't caught up yet. Without
  // this guard, that looks identical to "this deck doesn't exist" and
  // loadDeck would wipe the field instead of waiting for the real data.
  useEffect(() => {
    if (savedDecksLoading) return;
    loadDeck();
    // Deliberately depends only on deckId and savedDecksLoading — this
    // should only reload (and re-shuffle) when navigating to a
    // genuinely different deck, or once loading finishes, not if the
    // saved-decks list happens to change for an unrelated reason while
    // this page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deckId, savedDecksLoading]);

  const handleDrawCard = () => {
    const currentDeck = mainDeckRef.current;
    if (currentDeck.length === 0) return;
    const [top, ...rest] = currentDeck;
    setMainDeck(rest);
    setHandEntryFlips((prev) => ({ ...prev, [top.instanceId]: true }));
    setHandEntryRotations((prev) => ({ ...prev, [top.instanceId]: 0 }));
    setHand((prev) => [...prev, top]);
  };

  // Mill and Banish Top both move specifically the deck's own tracked
  // top card (unlike the viewer's "To Grave"/"Banish" actions, which can
  // target any card in the pile and need the departure-tracking
  // workaround in scheduleOpeningDraws' neighbors above) — so, like
  // handleDrawCard, these need no such workaround: the deck's existing
  // top-card element simply unmounts as mainDeck[0] changes, in the same
  // render the destination's new stackCards entry mounts, exactly the
  // same clean single transition that already makes drawing work.
  const handleMillTopCard = () => {
    const currentDeck = mainDeckRef.current;
    if (currentDeck.length === 0) return;
    const [top, ...rest] = currentDeck;
    setMainDeck(rest);
    setFieldZoneEntryFlips((prev) => ({ ...prev, [top.instanceId]: true }));
    setPlayerGrave((prev) => [...prev, top]);
  };

  const handleBanishTopCard = () => {
    const currentDeck = mainDeckRef.current;
    if (currentDeck.length === 0) return;
    const [top, ...rest] = currentDeck;
    setMainDeck(rest);
    setFieldZoneEntryFlips((prev) => ({ ...prev, [top.instanceId]: true }));
    setPlayerBanished((prev) => [...prev, top]);
  };

  // Performs the opening hand's draws one at a time, each via the exact
  // same handleDrawCard used for a manual draw — so each card gets the
  // normal draw animation rather than the hand just appearing fully
  // formed. Called directly from loadDeck (not via an effect — see
  // openingDrawTimeoutRef above for why). Always cancels any timeout
  // already in flight before starting a new one, so calling this again
  // (e.g. Reset pressed) can never leave two chains running at once.
  const scheduleOpeningDraws = (remaining: number) => {
    if (openingDrawTimeoutRef.current !== undefined) {
      window.clearTimeout(openingDrawTimeoutRef.current);
      openingDrawTimeoutRef.current = undefined;
    }
    setPendingOpeningDraws(remaining);
    if (remaining <= 0) return;
    openingDrawTimeoutRef.current = window.setTimeout(() => {
      openingDrawTimeoutRef.current = undefined;
      handleDrawCard();
      scheduleOpeningDraws(remaining - 1);
    }, 400);
  };

  const handleNormalSummon = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    const emptySlot = findEmptyZoneSlot(playerMonsterZones);
    if (emptySlot === -1) return; // no available Monster Zone

    requestSummonPosition(instance.card, (position) => {
      setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
      setFieldZoneEntryFlips((prev) => ({ ...prev, [instance.instanceId]: false }));
      setPlayerMonsterZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { ...instance, faceDown: false, position };
        return next;
      });
    });
  };

  // Shared by Activate and Set — both place a card into the first
  // available Spell/Trap Zone, differing only in faceDown.
  const placeInSpellTrapZone = (instanceId: string, faceDown: boolean) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    const emptySlot = findEmptyZoneSlot(playerSpellTrapZones);
    if (emptySlot === -1) return; // no available Spell/Trap Zone

    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setPlayerSpellTrapZones((prev) => {
      const next = [...prev];
      next[emptySlot] = { ...instance, faceDown };
      return next;
    });
  };

  // Field Spells go to the single Field Zone instead of a Spell/Trap
  // Zone. Unlike those, there's only one slot — activating a new Field
  // Spell while one's already there sends the old one to the Grave first
  // (matching real Yu-Gi-Oh rules), rather than being blocked.
  const placeInFieldZone = (instanceId: string, faceDown: boolean) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    if (playerFieldZone) {
      setPlayerGrave((prev) => [...prev, playerFieldZone]);
    }
    setPlayerFieldZone({ ...instance, faceDown });
  };

  const handleActivateSpell = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    if (instance.card.cardSubclass === 'Field') {
      placeInFieldZone(instanceId, false);
    } else {
      placeInSpellTrapZone(instanceId, false);
    }
  };

  const handleSetSpellOrTrap = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    if (instance.card.cardSubclass === 'Field') {
      placeInFieldZone(instanceId, true);
    } else {
      placeInSpellTrapZone(instanceId, true);
    }
  };

  const handleToGrave = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setPlayerGrave((prev) => [...prev, instance]);
  };

  const handleBanish = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setPlayerBanished((prev) => [...prev, instance]);
  };

  const handleStackTop = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setDeckEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
    setMainDeck((prev) => [instance, ...prev]);
  };

  const handleStackBottom = (instanceId: string) => {
    const instance = hand.find((i) => i.instanceId === instanceId);
    if (!instance) return;
    setHand((prev) => prev.filter((i) => i.instanceId !== instanceId));
    setDeckEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
    setMainDeck((prev) => [...prev, instance]);
  };

  // Same 5 actions apply to a card in any of the three field zones —
  // reads whichever zone/slot the click came from (slot index — zones
  // are a fixed-size array, not a dynamic list, so this is stable and
  // doesn't need instanceId), clears it, then routes the card the same
  // way the equivalent hand actions already do.
  const handleFieldAction = (
    zoneType: 'monster' | 'spellTrap' | 'field',
    index: number,
    actionKey: string,
  ) => {
    // Activate (flip a face-down card face-up) is fundamentally different
    // from the other actions: it stays in the same slot rather than
    // moving/being removed, so it's handled entirely separately before
    // the shared "read card, clear slot, then route it elsewhere" logic
    // below.
    if (actionKey === 'attack') {
      // Deliberately unhandled for now — this app has no attack-
      // resolution system yet (no opponent field, no damage
      // calculation), so this is just the menu option itself. Return
      // early rather than falling through to the shared logic below,
      // which assumes every action either stays in place or moves the
      // card somewhere.
      return;
    }
    if (actionKey === 'activate') {
      if (zoneType === 'monster') {
        setPlayerMonsterZones((prev) => {
          const slot = prev[index];
          if (!slot) return prev;
          const next = [...prev];
          next[index] = { ...slot, faceDown: false };
          return next;
        });
      } else if (zoneType === 'spellTrap') {
        setPlayerSpellTrapZones((prev) => {
          const slot = prev[index];
          if (!slot) return prev;
          const next = [...prev];
          next[index] = { ...slot, faceDown: false };
          return next;
        });
      } else {
        setPlayerFieldZone((prev) => (prev ? { ...prev, faceDown: false } : prev));
      }
      return;
    }

    // Mirrors Activate above — flips a face-up Spell/Trap back face-down
    // in place. Only ever offered for spellTrap/field (see
    // getPlacedCardActions in DuelField.tsx) — there's no Set Monster
    // yet, so this is never reachable for zoneType 'monster'.
    if (actionKey === 'set') {
      if (zoneType === 'spellTrap') {
        setPlayerSpellTrapZones((prev) => {
          const slot = prev[index];
          if (!slot) return prev;
          const next = [...prev];
          next[index] = { ...slot, faceDown: true };
          return next;
        });
      } else if (zoneType === 'field') {
        setPlayerFieldZone((prev) => (prev ? { ...prev, faceDown: true } : prev));
      }
      return;
    }

    // Same "toggle in place" shape as Activate above — only ever applies
    // to Monster Zone cards (the menu only offers this action there).
    if (actionKey === 'toDefense' || actionKey === 'toAttack') {
      const newPosition = actionKey === 'toDefense' ? 'defense' : 'attack';
      if (zoneType === 'monster') {
        setPlayerMonsterZones((prev) => {
          const slot = prev[index];
          if (!slot) return prev;
          const next = [...prev];
          next[index] = { ...slot, position: newPosition };
          return next;
        });
      }
      return;
    }

    const placed =
      zoneType === 'monster'
        ? playerMonsterZones[index]
        : zoneType === 'spellTrap'
          ? playerSpellTrapZones[index]
          : playerFieldZone;
    if (!placed) return;

    if (zoneType === 'monster') {
      setPlayerMonsterZones((prev) => {
        const next = [...prev];
        next[index] = null;
        return next;
      });
    } else if (zoneType === 'spellTrap') {
      setPlayerSpellTrapZones((prev) => {
        const next = [...prev];
        next[index] = null;
        return next;
      });
    } else {
      setPlayerFieldZone(null);
    }

    switch (actionKey) {
      case 'toHand':
        setHandEntryFlips((prev) => ({ ...prev, [placed.instanceId]: placed.faceDown }));
        if (zoneType === 'monster') {
          setHandEntryRotations((prev) => ({
            ...prev,
            [placed.instanceId]: placed.position === 'defense' ? -90 : 0,
          }));
        }
        setHand((prev) => [...prev, placed]);
        break;
      case 'toExtra':
        if (zoneType === 'monster') {
          setDeckEntryRotations((prev) => ({
            ...prev,
            [placed.instanceId]: placed.position === 'defense' ? -90 : 0,
          }));
        }
        // Only flip if the card wasn't already showing face-down — same
        // reasoning as stackTop/stackBottom above (Field Zone is the
        // only source here that can already be face-down).
        setDeckEntryFlips((prev) => ({ ...prev, [placed.instanceId]: !placed.faceDown }));
        setExtraDeck((prev) => [placed, ...prev]);
        break;
      case 'toGrave':
        if (zoneType === 'monster') {
          setFieldZoneEntryRotations((prev) => ({
            ...prev,
            [placed.instanceId]: placed.position === 'defense' ? -90 : 0,
          }));
        }
        setFieldZoneEntryFlips((prev) => ({ ...prev, [placed.instanceId]: placed.faceDown }));
        setPlayerGrave((prev) => [...prev, placed]);
        break;
      case 'banish':
        if (zoneType === 'monster') {
          setFieldZoneEntryRotations((prev) => ({
            ...prev,
            [placed.instanceId]: placed.position === 'defense' ? -90 : 0,
          }));
        }
        setFieldZoneEntryFlips((prev) => ({ ...prev, [placed.instanceId]: placed.faceDown }));
        setPlayerBanished((prev) => [...prev, placed]);
        break;
      case 'stackTop':
        if (zoneType === 'monster') {
          setDeckEntryRotations((prev) => ({
            ...prev,
            [placed.instanceId]: placed.position === 'defense' ? -90 : 0,
          }));
        }
        // Only flip if the card wasn't already showing face-down (a Set
        // Spell/Trap/Field Spell) — it's already presenting its back,
        // same as the deck, so there's nothing to turn over.
        setDeckEntryFlips((prev) => ({ ...prev, [placed.instanceId]: !placed.faceDown }));
        setMainDeck((prev) => [placed, ...prev]);
        break;
      case 'stackBottom':
        if (zoneType === 'monster') {
          setDeckEntryRotations((prev) => ({
            ...prev,
            [placed.instanceId]: placed.position === 'defense' ? -90 : 0,
          }));
        }
        setDeckEntryFlips((prev) => ({ ...prev, [placed.instanceId]: !placed.faceDown }));
        setMainDeck((prev) => [...prev, placed]);
        break;
    }
  };

  // Main Deck viewer-specific actions — every card gets To Hand/To Grave/
  // Banish; Monsters additionally get Special Summon. Extra Deck/Grave/
  // Banished viewers don't pass this in at all, so they stay plain.
  const getMainDeckCardActions = (card: CardData) => {
    const actions = [
      { key: 'toHand', label: 'To Hand' },
      { key: 'toGrave', label: 'To Grave' },
      { key: 'banish', label: 'Banish' },
    ];
    if (card.cardClass === 'Monster') {
      actions.push({ key: 'specialSummon', label: 'S. Summon' });
    }
    return actions;
  };

  const handleMainDeckCardAction = (instanceId: string, actionKey: string) => {
    const instance = mainDeck.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = findEmptyZoneSlot(playerMonsterZones);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(instance.card, (position) => {
        setMainDeck((prev) => prev.filter((i) => i.instanceId !== instanceId));
        setMainDeckDepartureCardId(instance.instanceId);
        setPendingDeckDeparture({
          source: 'main',
          instance,
          destination: 'monsterZone',
          monsterZoneSlot: emptySlot,
          monsterPosition: position,
        });
      });
      return;
    }

    setMainDeck((prev) => prev.filter((i) => i.instanceId !== instanceId));
    switch (actionKey) {
      case 'toHand':
        setHandEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
        setHandEntryRotations((prev) => ({ ...prev, [instance.instanceId]: 0 }));
        setHand((prev) => [...prev, instance]);
        break;
      case 'toGrave':
        setMainDeckDepartureCardId(instance.instanceId);
        setPendingDeckDeparture({ source: 'main', instance, destination: 'grave' });
        break;
      case 'banish':
        setMainDeckDepartureCardId(instance.instanceId);
        setPendingDeckDeparture({ source: 'main', instance, destination: 'banish' });
        break;
    }
  };

  // Extra Deck viewer-specific actions — every card here is already
  // guaranteed to be a Monster (Fusion/Ritual/Evolution routing), so
  // unlike Main Deck's actions there's no per-card-class branching.
  // Deliberately no "To Hand" — Extra Deck monsters go to the field or
  // the Grave/Banished Zone, not back to hand.
  const getExtraDeckCardActions = () => [
    { key: 'toGrave', label: 'To Grave' },
    { key: 'banish', label: 'Banish' },
    { key: 'specialSummon', label: 'S. Summon' },
  ];

  const handleExtraDeckCardAction = (instanceId: string, actionKey: string) => {
    const instance = extraDeck.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = findEmptyZoneSlot(playerMonsterZones);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(instance.card, (position) => {
        setExtraDeck((prev) => prev.filter((i) => i.instanceId !== instanceId));
        setExtraDeckDepartureCardId(instance.instanceId);
        setPendingDeckDeparture({
          source: 'extra',
          instance,
          destination: 'monsterZone',
          monsterZoneSlot: emptySlot,
          monsterPosition: position,
        });
      });
      return;
    }

    setExtraDeck((prev) => prev.filter((i) => i.instanceId !== instanceId));
    switch (actionKey) {
      case 'toGrave':
        setExtraDeckDepartureCardId(instance.instanceId);
        setPendingDeckDeparture({ source: 'extra', instance, destination: 'grave' });
        break;
      case 'banish':
        setExtraDeckDepartureCardId(instance.instanceId);
        setPendingDeckDeparture({ source: 'extra', instance, destination: 'banish' });
        break;
    }
  };

  // Grave viewer-specific actions — different per card type.
  const getGraveCardActions = (card: CardData) => {
    const isExtraDeckMonster =
      card.cardClass === 'Monster' &&
      ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '');
    const isMainDeckMonster = card.cardClass === 'Monster' && !isExtraDeckMonster;

    if (isMainDeckMonster) {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
      ];
    }

    if (isExtraDeckMonster) {
      return [
        { key: 'toExtra', label: 'To Extra Deck' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
      ];
    }

    if (card.cardClass === 'Spell' || card.cardClass === 'Trap') {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'banish', label: 'Banish' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'toSpellTrapZone', label: 'To S/T Zone' },
      ];
    }

    return [];
  };

  const handleGraveCardAction = (instanceId: string, actionKey: string) => {
    const instance = playerGrave.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = findEmptyZoneSlot(playerMonsterZones);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(instance.card, (position) => {
        setPlayerGrave((prev) => prev.filter((i) => i.instanceId !== instanceId));
        setFieldZoneEntryFlips((prev) => ({ ...prev, [instance.instanceId]: false }));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { ...instance, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    if (actionKey === 'toSpellTrapZone') {
      // Field Spells go to the Field Zone instead — same "replace and
      // send the old one to Grave" behavior as Activating one from hand.
      if (instance.card.cardSubclass === 'Field') {
        setPlayerGrave((prev) => {
          const withoutThisCard = prev.filter((i) => i.instanceId !== instanceId);
          return playerFieldZone ? [...withoutThisCard, playerFieldZone] : withoutThisCard;
        });
        setPlayerFieldZone({ ...instance, faceDown: false });
        return;
      }

      const emptySlot = findEmptyZoneSlot(playerSpellTrapZones);
      if (emptySlot === -1) return; // no available Spell/Trap Zone

      setPlayerGrave((prev) => prev.filter((i) => i.instanceId !== instanceId));
      setPlayerSpellTrapZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { ...instance, faceDown: false };
        return next;
      });
      return;
    }

    setPlayerGrave((prev) => prev.filter((i) => i.instanceId !== instanceId));
    switch (actionKey) {
      case 'toHand':
        setHandEntryFlips((prev) => ({ ...prev, [instance.instanceId]: false }));
        setHandEntryRotations((prev) => ({ ...prev, [instance.instanceId]: 0 }));
        setHand((prev) => [...prev, instance]);
        break;
      case 'toExtra':
        setDeckEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
        setExtraDeck((prev) => [instance, ...prev]);
        break;
      case 'banish':
        setFieldZoneEntryFlips((prev) => ({ ...prev, [instance.instanceId]: false }));
        setPlayerBanished((prev) => [...prev, instance]);
        break;
      case 'stackTop':
        setDeckEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
        setMainDeck((prev) => [instance, ...prev]);
        break;
      case 'stackBottom':
        setDeckEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
        setMainDeck((prev) => [...prev, instance]);
        break;
    }
  };

  // Banished Zone viewer-specific actions — identical to Grave's, except
  // "Banish" is swapped for "To Grave" (a card already in the Banished
  // Zone obviously can't be banished again).
  const getBanishedCardActions = (card: CardData) => {
    const isExtraDeckMonster =
      card.cardClass === 'Monster' &&
      ['Fusion', 'Ritual', 'Evolution'].includes(card.cardSubclass ?? '');
    const isMainDeckMonster = card.cardClass === 'Monster' && !isExtraDeckMonster;

    if (isMainDeckMonster) {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
      ];
    }

    if (isExtraDeckMonster) {
      return [
        { key: 'toExtra', label: 'To Extra Deck' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'specialSummon', label: 'S. Summon' },
      ];
    }

    if (card.cardClass === 'Spell' || card.cardClass === 'Trap') {
      return [
        { key: 'toHand', label: 'To Hand' },
        { key: 'toGrave', label: 'To Grave' },
        { key: 'stackTop', label: 'To T. Deck' },
        { key: 'stackBottom', label: 'To B. Deck' },
        { key: 'toSpellTrapZone', label: 'To S/T Zone' },
      ];
    }

    return [];
  };

  const handleBanishedCardAction = (instanceId: string, actionKey: string) => {
    const instance = playerBanished.find((i) => i.instanceId === instanceId);
    if (!instance) return;

    if (actionKey === 'specialSummon') {
      const emptySlot = findEmptyZoneSlot(playerMonsterZones);
      if (emptySlot === -1) return; // no available Monster Zone

      requestSummonPosition(instance.card, (position) => {
        setPlayerBanished((prev) => prev.filter((i) => i.instanceId !== instanceId));
        setFieldZoneEntryFlips((prev) => ({ ...prev, [instance.instanceId]: false }));
        setPlayerMonsterZones((prev) => {
          const next = [...prev];
          next[emptySlot] = { ...instance, faceDown: false, position };
          return next;
        });
      });
      return;
    }

    if (actionKey === 'toSpellTrapZone') {
      // Field Spells go to the Field Zone instead — same "replace and
      // send the old one to Grave" behavior as Activating one from hand.
      if (instance.card.cardSubclass === 'Field') {
        setPlayerBanished((prev) => prev.filter((i) => i.instanceId !== instanceId));
        if (playerFieldZone) {
          setPlayerGrave((prev) => [...prev, playerFieldZone]);
        }
        setPlayerFieldZone({ ...instance, faceDown: false });
        return;
      }

      const emptySlot = findEmptyZoneSlot(playerSpellTrapZones);
      if (emptySlot === -1) return; // no available Spell/Trap Zone

      setPlayerBanished((prev) => prev.filter((i) => i.instanceId !== instanceId));
      setPlayerSpellTrapZones((prev) => {
        const next = [...prev];
        next[emptySlot] = { ...instance, faceDown: false };
        return next;
      });
      return;
    }

    setPlayerBanished((prev) => prev.filter((i) => i.instanceId !== instanceId));
    switch (actionKey) {
      case 'toHand':
        setHandEntryFlips((prev) => ({ ...prev, [instance.instanceId]: false }));
        setHandEntryRotations((prev) => ({ ...prev, [instance.instanceId]: 0 }));
        setHand((prev) => [...prev, instance]);
        break;
      case 'toExtra':
        setDeckEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
        setExtraDeck((prev) => [instance, ...prev]);
        break;
      case 'toGrave':
        setFieldZoneEntryFlips((prev) => ({ ...prev, [instance.instanceId]: false }));
        setPlayerGrave((prev) => [...prev, instance]);
        break;
      case 'stackTop':
        setDeckEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
        setMainDeck((prev) => [instance, ...prev]);
        break;
      case 'stackBottom':
        setDeckEntryFlips((prev) => ({ ...prev, [instance.instanceId]: true }));
        setMainDeck((prev) => [...prev, instance]);
        break;
    }
  };

  return (
    <div className="DuelFieldPage">
      <div className="DuelFieldPage-sidePanel">
        <CardDisplay card={hoveredCard} />
      </div>

      <div className="DuelFieldPage-content">
        <div className="DuelFieldPage-topActions">
          <button
            type="button"
            className="DuelFieldPage-exitButton"
            onClick={() => navigate('/duel')}
          >
            Exit
          </button>
        </div>
        <div className="DuelFieldPage-fieldArea">
          <DuelField
            playerPhaseLabel={PHASE_LABELS[phase]}
            onPrevPhase={handlePrevPhase}
            onNextPhase={handleNextPhase}
            playerIsBattlePhase={phase === 'battle'}
            playerMainDeck={mainDeck.map((i) => i.card)}
            playerExtraDeck={extraDeck.map((i) => i.card)}
            playerMainDeckTopCardId={mainDeck[0]?.instanceId}
            playerExtraDeckTopCardId={extraDeck[0]?.instanceId}
            playerExtraDeckTopCardEntryFlip={
              extraDeck[0] ? !!deckEntryFlips[extraDeck[0].instanceId] : false
            }
            playerExtraDeckTopCardEntryRotation={
              extraDeck[0] ? (deckEntryRotations[extraDeck[0].instanceId] ?? 0) : 0
            }
            playerMainDeckTopCardEntryFlip={
              mainDeck[0] ? !!deckEntryFlips[mainDeck[0].instanceId] : false
            }
            playerMainDeckTopCardEntryRotation={
              mainDeck[0] ? (deckEntryRotations[mainDeck[0].instanceId] ?? 0) : 0
            }
            playerMainDeckBottomCardId={
              mainDeck.length > 1 ? mainDeck[mainDeck.length - 1]?.instanceId : undefined
            }
            playerMainDeckBottomCardEntryFlip={
              mainDeck.length > 1
                ? !!deckEntryFlips[mainDeck[mainDeck.length - 1].instanceId]
                : false
            }
            playerMainDeckBottomCardEntryRotation={
              mainDeck.length > 1
                ? (deckEntryRotations[mainDeck[mainDeck.length - 1].instanceId] ?? 0)
                : 0
            }
            playerMainDeckDepartureCardId={mainDeckDepartureCardId}
            playerExtraDeckDepartureCardId={extraDeckDepartureCardId}
            playerMonsterZones={playerMonsterZones}
            playerSpellTrapZones={playerSpellTrapZones}
            playerGrave={playerGrave}
            playerBanished={playerBanished}
            playerFieldZoneEntryRotations={fieldZoneEntryRotations}
            playerFieldZoneEntryFlips={fieldZoneEntryFlips}
            playerFieldZone={playerFieldZone}
            onDrawCard={pendingOpeningDraws > 0 ? undefined : handleDrawCard}
            onCardHover={handleCardHover}
            onCardHoverEnd={handleCardHoverEnd}
            onFieldAction={handleFieldAction}
            onMainDeckAction={(actionKey) => {
              if (actionKey === 'view') {
                setViewingDeck('main');
              } else if (actionKey === 'shuffle') {
                setMainDeck((prev) => shuffle(prev));
              } else if (actionKey === 'mill') {
                handleMillTopCard();
              } else if (actionKey === 'banishTop') {
                handleBanishTopCard();
              } else if (actionKey === 'reset') {
                setIsResetConfirmOpen(true);
              }
            }}
            onViewExtraDeck={() => setViewingDeck('extra')}
            onViewGrave={() => setViewingDeck('grave')}
            onViewBanished={() => setViewingDeck('banished')}
          />
        </div>
        <Hand
          cards={hand}
          entryRotations={handEntryRotations}
          entryFlips={handEntryFlips}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
          onNormalSummon={handleNormalSummon}
          onActivateSpell={handleActivateSpell}
          onSetSpellOrTrap={handleSetSpellOrTrap}
          onToGrave={handleToGrave}
          onBanish={handleBanish}
          onStackTop={handleStackTop}
          onStackBottom={handleStackBottom}
          piled={isHandPiled}
          onShuffleHand={handleShuffleHand}
          shuffleDisabled={pendingOpeningDraws > 0}
        />
      </div>

      {viewingDeck && (
        <DeckViewer
          cards={
            viewingDeck === 'main'
              ? mainDeck
              : viewingDeck === 'extra'
                ? extraDeck
                : viewingDeck === 'grave'
                  ? playerGrave
                  : playerBanished
          }
          onClose={() => {
            if (viewingDeck === 'main') {
              setMainDeck((prev) => shuffle(prev));
            }
            setViewingDeck(null);
          }}
          onCardHover={handleCardHover}
          onCardHoverEnd={handleCardHoverEnd}
          getCardActions={
            viewingDeck === 'main'
              ? getMainDeckCardActions
              : viewingDeck === 'extra'
                ? getExtraDeckCardActions
                : viewingDeck === 'grave'
                  ? getGraveCardActions
                  : viewingDeck === 'banished'
                    ? getBanishedCardActions
                    : undefined
          }
          onCardAction={
            viewingDeck === 'main'
              ? handleMainDeckCardAction
              : viewingDeck === 'extra'
                ? handleExtraDeckCardAction
                : viewingDeck === 'grave'
                  ? handleGraveCardAction
                  : viewingDeck === 'banished'
                    ? handleBanishedCardAction
                    : undefined
          }
        />
      )}

      {isResetConfirmOpen && (
        <ConfirmDialog
          message="Reset the game? All cards will return to the Main/Extra Deck, and the Main Deck will be reshuffled."
          onConfirm={() => {
            loadDeck();
            setIsResetConfirmOpen(false);
          }}
          onCancel={() => setIsResetConfirmOpen(false)}
        />
      )}

      {pendingSummon && (
        <SummonPositionDialog
          onSelectAttack={() => {
            pendingSummon.onSelectPosition('attack');
            setPendingSummon(null);
          }}
          onSelectDefense={() => {
            pendingSummon.onSelectPosition('defense');
            setPendingSummon(null);
          }}
        />
      )}

      <LifePointCounter
        value={lifePoints}
        onAdd={handleAddLifePoints}
        onSubtract={handleSubtractLifePoints}
      />
    </div>
  );
}

export default DuelFieldPage;