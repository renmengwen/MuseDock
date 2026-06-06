import * as React from 'react';
import { cn } from '@/lib/utils.js';

export const Select = React.forwardRef(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'h-10 min-w-[158px] rounded-md border border-input bg-white px-2.5 text-sm text-foreground outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});
