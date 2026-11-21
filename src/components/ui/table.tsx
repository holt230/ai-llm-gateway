import type { ComponentProps } from 'react';
import { cn } from './utils';

export function Table({ className, ...props }: ComponentProps<'table'>) {
  return <div data-slot="table-container" className="relative min-w-0 max-w-full overflow-x-auto">
    <table data-slot="table" className={cn('w-full border-collapse text-sm', className)} {...props} />
  </div>;
}
export function TableHeader({ className, ...props }: ComponentProps<'thead'>) {
  return <thead data-slot="table-header" className={cn('text-xs text-muted-foreground [&_tr]:border-b', className)} {...props} />;
}
export function TableBody({ className, ...props }: ComponentProps<'tbody'>) {
  return <tbody data-slot="table-body" className={cn('[&_tr:last-child]:border-0', className)} {...props} />;
}
export function TableRow({ className, ...props }: ComponentProps<'tr'>) {
  return <tr data-slot="table-row" className={cn('border-b border-border hover:bg-muted/50', className)} {...props} />;
}
export function TableHead({ className, scope = 'col', ...props }: ComponentProps<'th'>) {
  return <th data-slot="table-head" scope={scope} className={cn('px-2 py-2.5 text-left align-middle font-medium', className)} {...props} />;
}
export function TableCell({ className, ...props }: ComponentProps<'td'>) {
  return <td data-slot="table-cell" className={cn('px-2 py-2.5 align-middle wrap-anywhere', className)} {...props} />;
}
