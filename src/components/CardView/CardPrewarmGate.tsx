import { useEffect, useMemo, useState, type ReactNode } from 'react';
import cardData from '../../data/carddata.json';
import type { CardData } from '../../types/Card';
import CardImage from './CardImage';
import { getCachedCardImage } from './rasterCache';
import './CardPrewarmGate.css';

// Session-level (module-scope, not component state) — this component
// sits inside routed content (see App.tsx), so navigating between pages
// remounts it repeatedly. Without this flag, every remount would
// re-scan the cache and, if anything were still missing, show the
// loading screen again — this flag is what makes the whole warm-up
// process something that only ever happens once per session, the first
// time it completes, however many times this component itself remounts
// afterward.
let hasWarmedThisSession = false;

// Small enough that only a modest number of full card DOM trees are ever
// mounted off-screen at once (each uncached card renders BOTH a live
// fallback and its own capture stage — see CardImage) rather than all
// ~300+ at once, which would make for a slow, janky initial render on
// its own before a single capture even starts. Large enough to keep the
// bounded capture pool (see rasterCache) consistently fed rather than
// idling between batches.
const BATCH_SIZE = 16;

// Slightly longer than rasterCache's own 8s per-capture timeout, so a
// genuinely stuck or failed card can't hang the whole warm-up process
// forever. Giving up on a batch and moving on is always safe — the app
// already falls back gracefully to live rendering for anything that
// never ends up cached, the exact same fallback it always had before
// this component existed at all; it just means that one card stays on
// that slower path a bit longer.
const BATCH_GIVE_UP_MS = 5000;

const POLL_INTERVAL_MS = 50;

interface CardPrewarmGateProps {
  children: ReactNode;
}

function CardPrewarmGate({ children }: CardPrewarmGateProps) {
  const cards = useMemo(() => cardData as CardData[], []);
  const uncachedAtStart = useMemo(
    () => cards.filter((card) => !getCachedCardImage(String(card.id))),
    [cards],
  );

  const [isReady, setIsReady] = useState(hasWarmedThisSession || uncachedAtStart.length === 0);
  const [batchStart, setBatchStart] = useState(0);
  const [readyCount, setReadyCount] = useState(cards.length - uncachedAtStart.length);

  useEffect(() => {
    if (isReady) return;

    const batch = uncachedAtStart.slice(batchStart, batchStart + BATCH_SIZE);
    if (batch.length === 0) {
      hasWarmedThisSession = true;
      setIsReady(true);
      return;
    }

    // Polls the shared cache rather than threading a completion callback
    // through every individual CardImage below — the cache is already
    // the single source of truth for "is this card done," and polling a
    // few hundred entries every 100ms is trivially cheap at this scale.
    const startTime = Date.now();
    const interval = setInterval(() => {
      const batchDone = batch.every((card) => getCachedCardImage(String(card.id)));
      const timedOut = Date.now() - startTime > BATCH_GIVE_UP_MS;
      if (batchDone || timedOut) {
        clearInterval(interval);
        setReadyCount(cards.filter((card) => getCachedCardImage(String(card.id))).length);
        setBatchStart((prev) => prev + BATCH_SIZE);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [isReady, batchStart, uncachedAtStart, cards]);

  if (isReady) {
    return <>{children}</>;
  }

  const currentBatch = uncachedAtStart.slice(batchStart, batchStart + BATCH_SIZE);
  const progressPercent = cards.length === 0 ? 100 : (readyCount / cards.length) * 100;

  return (
    <div className="CardPrewarmGate">
      <div className="CardPrewarmGate-message">
        <p>Loading cards…</p>
        <p className="CardPrewarmGate-count">
          {readyCount} / {cards.length}
        </p>
        <div className="CardPrewarmGate-progressTrack">
          <div
            className="CardPrewarmGate-progressFill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Off-screen: mounting each card's existing CardImage here is what
          actually triggers its own capture pipeline (see
          useRasterizedCard) — this component just watches the shared
          cache for progress, rather than reimplementing any of that. */}
      <div className="CardPrewarmGate-offscreen" aria-hidden="true">
        {currentBatch.map((card) => (
          <div key={card.id} className="CardPrewarmGate-cardSlot">
            <CardImage card={card} />
          </div>
        ))}
      </div>
    </div>
  );
}

export default CardPrewarmGate;
