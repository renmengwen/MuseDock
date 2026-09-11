// Synced from shadcn/ui registry/new-york-v4/ui/table.tsx.
// Source: https://ui.shadcn.com/r/styles/new-york-v4/table.json
// Adapted to JSX, the local cn helper and Tailwind 3 syntax.
import { cn } from '@/lib/utils.js';

function Table({ className, ...props }) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn('w-full caption-bottom text-sm', className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }) {
  return <thead data-slot="table-header" className={cn('[&_tr]:border-b', className)} {...props} />;
}

function TableBody({ className, ...props }) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}

function TableFooter({ className, ...props }) {
  return <tfoot data-slot="table-footer" className={cn('border-t bg-muted/50 font-medium [&>tr]:last:border-b-0', className)} {...props} />;
}

function TableRow({ className, ...props }) {
  return <tr data-slot="table-row" className={cn('border-b transition-colors hover:bg-muted/50 [&:has([aria-expanded=true])]:bg-muted/50 data-[state=selected]:bg-muted', className)} {...props} />;
}

function TableHead({ className, ...props }) {
  return <th data-slot="table-head" className={cn('h-10 whitespace-nowrap px-2 text-left align-middle font-medium text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]', className)} {...props} />;
}

function TableCell({ className, ...props }) {
  return <td data-slot="table-cell" className={cn('whitespace-nowrap p-2 align-middle [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]', className)} {...props} />;
}

function TableCaption({ className, ...props }) {
  return <caption data-slot="table-caption" className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
