// Module-level (not component state), so it survives CardImage mount/unmount
// as you page through the browser — a card rasterized once stays cached for
// the rest of the session. Deliberately NOT persisted to localStorage/etc:
// while the card layout is still being iterated on, a persistent cache
// would keep showing stale renders after every CSS/asset tweak until
// manually cleared, which would work against active development.
const cache = new Map<string, string>();

// Tracks captures currently in progress, so two CardImage instances asking
// for the same card at the same moment (e.g. a React StrictMode double
// mount in dev) share one toPng() call instead of racing two.
const inFlight = new Map<string, Promise<string>>();

export function getCachedCardImage(id: string): string | undefined {
  return cache.get(id);
}

export function setCachedCardImage(id: string, url: string): void {
  cache.set(id, url);
}

export function getInFlightCapture(id: string): Promise<string> | undefined {
  return inFlight.get(id);
}

export function setInFlightCapture(id: string, promise: Promise<string>): void {
  inFlight.set(id, promise);
}

export function clearInFlightCapture(id: string): void {
  inFlight.delete(id);
}

// html-to-image is not safe to call many times concurrently — running
// toPng() for ~25 cards in parallel (as happens naturally when a page's
// worth of CardImage components all mount at once) causes most of the
// calls to hang or race rather than resolve, which is why only the first
// card was ever completing. This queue chains every capture task onto a
// single running promise, so only one toPng() call is ever in flight at a
// time globally, while everything else (font loading, off-screen render)
// still happens freely in parallel per-card.
let queueTail: Promise<void> = Promise.resolve();

// A queued task's promise settling (resolving OR rejecting) is what lets
// the queue move on to the next one — but if toPng() itself hangs and
// never settles at all for some card, the queue would otherwise be stuck
// forever waiting on it, blocking every capture after it too. Racing each
// task against a timeout guarantees the queue's own bookkeeping promise
// always settles within CAPTURE_TIMEOUT_MS, regardless of whether the
// underlying toPng() call ever actually finishes.
const CAPTURE_TIMEOUT_MS = 8000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export function enqueueCapture<T>(task: () => Promise<T>, label = 'capture'): Promise<T> {
  const result = queueTail.then(() => withTimeout(task(), CAPTURE_TIMEOUT_MS, label));
  // Keep the tail moving even if this task fails or times out, so one bad
  // capture doesn't stall every capture queued after it.
  queueTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
