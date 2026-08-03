import { useEffect, useRef, useState } from 'react';
import { playClickSound } from '../../utils/clickSound';

// How long the "clicked" image stays visible after a click, in ms. A real
// click (mousedown immediately followed by mouseup) is often too fast to
// actually perceive an image swap, so this holds the click image visible
// briefly regardless of how quick the actual click was.
const CLICK_FLASH_DURATION_MS = 150;

interface IconButtonProps {
  icon: string;
  hoverIcon?: string;
  clickIcon?: string;
  disabledIcon?: string;
  alt: string;
  title?: string;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  ariaPressed?: boolean;
}

function IconButton({
  icon,
  hoverIcon,
  clickIcon,
  disabledIcon,
  alt,
  title,
  disabled = false,
  onClick,
  className,
  ariaPressed,
}: IconButtonProps) {
  const [isHovering, setIsHovering] = useState(false);
  const [isFlashingClick, setIsFlashingClick] = useState(false);
  const flashTimeoutRef = useRef<number | undefined>(undefined);

  // Clear any pending flash timeout on unmount, so it doesn't try to call
  // setState on an unmounted component.
  useEffect(() => {
    return () => {
      if (flashTimeoutRef.current !== undefined) {
        window.clearTimeout(flashTimeoutRef.current);
      }
    };
  }, []);

  // Once a button is disabled, the browser stops delivering mouse events to
  // it — including mouseleave — so if the cursor was already hovering (or a
  // click flash was still in progress) the instant it became disabled,
  // that state would otherwise stay stuck forever. Reset both here so a
  // later re-enable starts from a clean slate.
  useEffect(() => {
    if (disabled) {
      setIsHovering(false);
      setIsFlashingClick(false);
      if (flashTimeoutRef.current !== undefined) {
        window.clearTimeout(flashTimeoutRef.current);
        flashTimeoutRef.current = undefined;
      }
    }
  }, [disabled]);

  const handleClick = () => {
    if (disabled) return;
    playClickSound();
    onClick?.();

    if (clickIcon) {
      setIsFlashingClick(true);
      if (flashTimeoutRef.current !== undefined) {
        window.clearTimeout(flashTimeoutRef.current);
      }
      flashTimeoutRef.current = window.setTimeout(() => {
        setIsFlashingClick(false);
      }, CLICK_FLASH_DURATION_MS);
    }
  };

  // Disabled takes priority over any leftover hover/click state, then
  // click flash > hover > normal.
  const src = disabled
    ? (disabledIcon ?? icon)
    : isFlashingClick && clickIcon
      ? clickIcon
      : isHovering && hoverIcon
        ? hoverIcon
        : icon;

  return (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={handleClick}
      onMouseEnter={disabled ? undefined : () => setIsHovering(true)}
      onMouseLeave={disabled ? undefined : () => setIsHovering(false)}
      aria-label={alt}
      aria-pressed={ariaPressed}
      title={title}
    >
      <img src={src} alt={alt} />
    </button>
  );
}

export default IconButton;
