import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils.js';

export function DropdownMenu({ trigger, children, align = 'right', className }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) {
        setOpen(false);
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const triggerElement = React.isValidElement(trigger)
    ? React.cloneElement(trigger, {
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        onClick: event => {
          trigger.props.onClick?.(event);
          setOpen(value => !value);
        },
      })
    : (
        <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)}>
          {trigger}
        </button>
      );

  return (
    <div className="relative inline-flex" ref={ref}>
      {triggerElement}
      {open ? (
        <div
          role="menu"
          className={cn(
            'absolute top-full z-30 mt-2 min-w-[180px] rounded-md border border-border bg-popover p-2 text-sm text-popover-foreground shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
            className,
          )}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function DropdownMenuCheckboxItem({ checked, disabled, onCheckedChange, children }) {
  return (
    <label
      role="menuitemcheckbox"
      aria-checked={checked}
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="checkbox"
        className="h-4 w-4 accent-[#fe2c55]"
        checked={checked}
        disabled={disabled}
        onChange={event => onCheckedChange?.(event.target.checked)}
      />
      <span>{children}</span>
    </label>
  );
}
