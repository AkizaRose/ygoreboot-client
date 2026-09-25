import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import './ViewportScaler.css';

interface ViewportScalerProps {
  children: ReactNode;
}

// Makes the whole app behave the way DuelingBook's client does: every page
// is laid out at its own natural, fixed-pixel size (nothing in here uses
// vw/vh for its own sizing — see AuthPage.css/AccountPage.css, which had
// their old 100vh self-centering removed in favor of this), and this
// component uniformly scales that natural-size content to fit whatever the
// actual browser window is, via a single CSS transform: scale(...)
// recomputed on resize. The scale is capped at 1 (see recompute below) —
// this only ever SHRINKS a page to fit a window smaller than its own
// natural size, never enlarges one beyond it. Without that cap, a page
// with a small natural footprint (the Login/Landing/Account/Duel Menu
// pages, all far smaller than the Duel Field/Deck Builder's fixed
// 1400x660) gets blown up to fill the whole window on anything but a tiny
// screen — much more zoomed-in than its original, native size — since
// each page is scaled to fit the SAME window independently of how big its
// own content actually is. Two things fall out of the (capped) scaling:
//  - Resizing the window never reflows anything — every element stays in
//    exactly the same position relative to every other element, the whole
//    page just gets visually bigger or smaller together.
//  - Native browser zoom (Ctrl+/-, Ctrl+wheel, pinch) changes
//    window.innerWidth/innerHeight in CSS pixels, which is exactly what
//    the resize handler below already reacts to — so a zoomed-in/out page
//    re-scales to compensate and ends up looking unchanged, the same
//    "stays fixed in place" effect DuelingBook has. See the wheel/keydown
//    handlers further down for the (best-effort — see their own comment)
//    extra step of trying to stop the zoom gesture itself.
function ViewportScaler({ children }: ViewportScalerProps) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // canvas.offsetWidth/Height is the element's own layout size, which a
    // CSS transform on that same element does NOT affect — so this always
    // reads the content's true, unscaled natural size, however big the
    // current scale factor already is.
    const recompute = () => {
      const naturalWidth = canvas.offsetWidth;
      const naturalHeight = canvas.offsetHeight;
      if (naturalWidth === 0 || naturalHeight === 0) return;
      // The trailing `, 1` is the cap described above — shrink to fit a
      // small window, but never scale up past a page's real, native size.
      const nextScale = Math.min(
        window.innerWidth / naturalWidth,
        window.innerHeight / naturalHeight,
        1,
      );
      setScale(nextScale);
    };

    recompute();

    // Picks up the current page's own natural size changing (e.g.
    // navigating to a differently-sized page), not just the window itself
    // being resized.
    const resizeObserver = new ResizeObserver(recompute);
    resizeObserver.observe(canvas);
    window.addEventListener('resize', recompute);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', recompute);
    };
  }, []);

  // Best-effort native-zoom suppression. This can't fully block every
  // browser's zoom gesture (Firefox in particular doesn't let a page
  // intercept its own Ctrl+/- shortcuts at all), which is exactly why the
  // scaling above is the real fix — it makes whatever zoom DOES get
  // through look like nothing happened. This is just belt-and-suspenders
  // for the gestures that CAN be stopped (Ctrl+wheel/pinch in Chromium and
  // Firefox, and Ctrl+=/-/0 in Chromium).
  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0') {
        e.preventDefault();
      }
    };
    // wheel must be registered non-passive for preventDefault() to have
    // any effect on it.
    window.addEventListener('wheel', handleWheel, { passive: false });
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('wheel', handleWheel);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div className="ViewportScaler-stage">
      <div
        ref={canvasRef}
        className="ViewportScaler-canvas"
        style={{ transform: `scale(${scale})` }}
      >
        {children}
      </div>
    </div>
  );
}

export default ViewportScaler;
