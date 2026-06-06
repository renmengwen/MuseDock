import * as React from 'react';
import { cn } from '@/lib/utils.js';

export const Table = React.forwardRef(function Table({ className, ...props }, ref) {
  return <table ref={ref} className={cn('w-full border-collapse bg-white text-sm', className)} {...props} />;
});

export const TableHeader = React.forwardRef(function TableHeader({ className, ...props }, ref) {
  return <thead ref={ref} className={cn(className)} {...props} />;
});

export const TableBody = React.forwardRef(function TableBody({ className, ...props }, ref) {
  return <tbody ref={ref} className={cn(className)} {...props} />;
});

export const TableRow = React.forwardRef(function TableRow({ className, ...props }, ref) {
  return <tr ref={ref} className={cn('border-b border-border', className)} {...props} />;
});

export const TableHead = React.forwardRef(function TableHead({ className, ...props }, ref) {
  return (
    <th
      ref={ref}
      className={cn('sticky top-0 z-10 bg-[#fafbfc] px-3.5 py-3 text-left align-top text-[13px] font-semibold text-[#5f6876]', className)}
      {...props}
    />
  );
});

export const TableCell = React.forwardRef(function TableCell({ className, ...props }, ref) {
  return <td ref={ref} className={cn('px-3.5 py-3 align-top text-[13px]', className)} {...props} />;
});
