import { useLayoutEffect, useRef, useState } from 'react';

interface UseAutoFitFontSizeOptions {
  maxFontSize: number;
  minFontSize: number;
  step?: number;
}

// Shrinks font-size in fixed steps, remeasuring after each step, until the
// element's content fits within its own (CSS-fixed) height, or the
// minimum font size is reached. Returns a ref to attach to the text
// element and the resolved font size to apply via style.
//
// This directly changes font-size (rather than a scaleX/scaleY transform)
// so the text reflows naturally into more or fewer lines as it shrinks,
// rather than being visually squashed.
export function useAutoFitFontSize<T extends HTMLElement>(
  deps: unknown[],
  { maxFontSize, minFontSize, step = 0.5 }: UseAutoFitFontSizeOptions,
) {
  const ref = useRef<T>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let size = maxFontSize;
    el.style.fontSize = `${size}px`;

    // scrollHeight reflects the content's full, unclipped height even
    // when overflow is hidden, while clientHeight stays pinned to the
    // element's own fixed CSS height — so this comparison works reliably
    // as long as the element has `overflow: hidden` (or similar) set.
    while (el.scrollHeight > el.clientHeight && size > minFontSize) {
      size = Math.max(minFontSize, size - step);
      el.style.fontSize = `${size}px`;
    }

    setFontSize(size);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, fontSize };
}
