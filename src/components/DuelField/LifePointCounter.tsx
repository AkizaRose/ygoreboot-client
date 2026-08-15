import { useEffect, useRef, useState } from 'react';
import './LifePointCounter.css';

interface LifePointCounterProps {
  value: number;
  onAdd: (amount: number) => void;
  onSubtract: (amount: number) => void;
}

function LifePointCounter({ value, onAdd, onSubtract }: LifePointCounterProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // The number actually shown, separate from `value` — counts toward
  // `value` over a fixed 2s any time it changes, rather than jumping
  // straight to it. Kept in a ref alongside the state so a new
  // animation (value changing again before the current one finishes)
  // always starts from wherever the count currently and actually is,
  // not from a stale snapshot of value at the time the last animation
  // was kicked off.
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

    const durationMs = 2000;
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
  }, [value]);

  // Closes on any click outside the counter/popover — a plain button
  // triggering a popover (rather than the hover-driven menus elsewhere
  // in this app) needs its own explicit dismiss behavior, since there's
  // no hover-leave to fall back on.
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) inputRef.current?.focus();
  }, [isOpen]);

  const applyAmount = (direction: 1 | -1) => {
    const amount = Number.parseInt(inputValue, 10);
    if (Number.isNaN(amount) || amount <= 0) return;
    if (direction === 1) {
      onAdd(amount);
    } else {
      onSubtract(amount);
    }
    setInputValue('');
  };

  return (
    <div className="LifePointCounter" ref={containerRef}>
      {isOpen && (
        <div className="LifePointCounter-popover">
          <input
            ref={inputRef}
            type="text"
            inputMode="numeric"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyAmount(1);
            }}
            placeholder="Amount"
            className="LifePointCounter-input"
          />
          <div className="LifePointCounter-popoverActions">
            <button
              type="button"
              className="LifePointCounter-actionButton"
              onClick={() => applyAmount(1)}
            >
              Add
            </button>
            <button
              type="button"
              className="LifePointCounter-actionButton"
              onClick={() => applyAmount(-1)}
            >
              Subtract
            </button>
          </div>
        </div>
      )}
      <button
        type="button"
        className="LifePointCounter-display"
        onClick={() => setIsOpen((prev) => !prev)}
      >
        {displayValue}
      </button>
    </div>
  );
}

export default LifePointCounter;
