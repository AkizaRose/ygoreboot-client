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

// html-to-image is not safe to call with UNLIMITED concurrency — running
// toPng() for ~25 cards all at once (as happens naturally when a page's
// worth of CardImage components all mount together) causes most of the
// calls to hang or race rather than resolve, which is why full
// serialization (one at a time) was used previously. A small, BOUNDED
// pool of concurrent captures avoids that failure mode while running
// several times faster than one-at-a-time — but this specific number is
// a judgment call, not something empirically proven safe, since it can't
// be tested outside a real browser. If intermittent capture failures
// (or the blank-border symptom this pipeline had before) show up again,
// lowering this — even back down to 1 — is the first thing to try.
const MAX_CONCURRENT_CAPTURES = 5;
let activeCaptures = 0;
const waitQueue: Array<() => void> = [];

function acquireSlot(): Promise<void> {
  if (activeCaptures < MAX_CONCURRENT_CAPTURES) {
    activeCaptures++;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waitQueue.push(() => {
      activeCaptures++;
      resolve();
    });
  });
}

function releaseSlot(): void {
  activeCaptures--;
  const next = waitQueue.shift();
  if (next) next();
}

// A queued task's promise settling (resolving OR rejecting) is what lets
// its slot free up for the next waiting task — but if toPng() itself
// hangs and never settles at all for some card, that slot would
// otherwise stay occupied forever, eventually starving the whole pool as
// more captures pile up waiting. Racing each task against a timeout
// guarantees its slot is always released within CAPTURE_TIMEOUT_MS,
// regardless of whether the underlying toPng() call ever actually
// finishes.
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

export async function enqueueCapture<T>(task: () => Promise<T>, label = 'capture'): Promise<T> {
  await acquireSlot();
  try {
    return await withTimeout(task(), CAPTURE_TIMEOUT_MS, label);
  } finally {
    releaseSlot();
  }
}