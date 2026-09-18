import { useEffect, useRef, useState } from 'react';

// The steady, odometer-style counting behavior originally built for
// LifePointCounter's own display — extracted here so it can be reused
// by a plain, read-only display too (the opponent's own Life Point
// display specifically, which deliberately has no edit popover at all,
// so it was never appropriate to just reuse LifePointCounter itself
// for it). LifePointCounter now uses this hook rather than duplicating
// the same animation logic.
//
// Returns the number actually to be displayed, separate from `value` —
// counts toward `value` over durationMs any time it changes, rather
// than jumping straight to it. A new change (value changing again
// before the current count finishes) always continues from wherever
// the count currently and actually is, not from a stale snapshot of
// value at the time the previous animation was kicked off.
function useAnimatedCount(value: number, durationMs = 2000): number {
  const [displayValue, setDisplayValue] = useState(value);
  const displayValueRef = useRef(value);
  const animationFrameRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (animationFrameRef.current !== undefined) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = undefined;
    }

    const startValue = displayValueRef.current;
    const endValue = value;
    if (startValue === endValue) return;

    const startTime = performance.now();

    const step = (now: number) => {
      const progress = Math.min(1, (now - startTime) / durationMs);
      // Linear, not eased — this is meant to read as a steady count (an
      // odometer/scoreboard), not a decelerating animation.
      const current = Math.round(startValue + (endValue - startValue) * progress);
      displayValueRef.current = current;
      setDisplayValue(current);

      if (progress < 1) {
        animationFrameRef.current = requestAnimationFrame(step);
      } else {
        animationFrameRef.current = undefined;
      }
    };

    animationFrameRef.current = requestAnimationFrame(step);

    return () => {
      if (animationFrameRef.current !== undefined) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = undefined;
      }
    };
  }, [value, durationMs]);

  return displayValue;
}

export default useAnimatedCount;
