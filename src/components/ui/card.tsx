import type { ComponentPropsWithoutRef } from 'react';
import { cn } from './utils';

export function Card({ as: Element = 'div', className, ...props }: ComponentPropsWithoutRef<'div'> & {
  as?: 'div' | 'section' | 'article';
}) {
  return <Element data-slot="card" className={cn('rounded-xl border border-border bg-card text-card-foreground', className)} {...props} />;
}
