import { useEffect, useRef, useState } from 'react';
import useAnimatedCount from './useAnimatedCount';
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

  // See useAnimatedCount's own comment for the full reasoning — counts
  // toward `value` over a fixed 2s any time it changes, rather than
  // jumping straight to it.
  const displayValue = useAnimatedCount(value);

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
