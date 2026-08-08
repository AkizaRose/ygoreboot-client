import { useLayoutEffect, useRef, useState } from 'react';

interface UseAutoFitTextOptions {
  maxFontSize: number;
  minFontSize: number;
  fontSizeStep?: number;
  maxLineHeight: number;
  minLineHeight: number;
  lineHeightStep?: number;
}

// Shrinks line-height and font-size (in that order) until the element's
// content fits within its own (CSS-fixed) height, or both have hit their
// floors. Returns a ref to attach to the text element, plus the resolved
// fontSize/lineHeight to apply via style.
//
// Line-height shrinks FIRST, while font-size stays at its max. Tightening
// line spacing costs nothing in individual-glyph readability, whereas
// shrinking the font itself does — so it's better to exhaust that "free"
// space reduction before falling back to a smaller font. Only once
// line-height has hit minLineHeight does font-size start decreasing (with
// line-height held at its minimum from that point on).
//
// This directly changes font-size (rather than a scaleX/scaleY transform)
// so the text reflows naturally into more or fewer lines as it shrinks,
// rather than being visually squashed.
export function useAutoFitText<T extends HTMLElement>(
  deps: unknown[],
  {
    maxFontSize,
    minFontSize,
    fontSizeStep = 0.5,
    maxLineHeight,
    minLineHeight,
    lineHeightStep = 0.02,
  }: UseAutoFitTextOptions,
) {
  const ref = useRef<T>(null);
  const [fontSize, setFontSize] = useState(maxFontSize);
  const [lineHeight, setLineHeight] = useState(maxLineHeight);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let size = maxFontSize;
    let leading = maxLineHeight;
    el.style.fontSize = `${size}px`;
    el.style.lineHeight = `${leading}`;

    const overflowing = () => el.scrollHeight > el.clientHeight;

    // Phase 1: tighten line spacing, font-size untouched.
    while (overflowing() && leading > minLineHeight) {
      leading = Math.max(minLineHeight, leading - lineHeightStep);
      el.style.lineHeight = `${leading}`;
    }

    // Phase 2: line-height is already at its floor — now shrink font-size.
    while (overflowing() && size > minFontSize) {
      size = Math.max(minFontSize, size - fontSizeStep);
      el.style.fontSize = `${size}px`;
    }

    setFontSize(size);
    setLineHeight(leading);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ref, fontSize, lineHeight };
}
