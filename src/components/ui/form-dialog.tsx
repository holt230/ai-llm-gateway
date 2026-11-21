import * as Dialog from '@radix-ui/react-dialog';
import type { ReactNode } from 'react';
import { useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { cn } from './utils';

export const dialogForm = 'grid min-h-0 grid-rows-[minmax(0,1fr)_auto]';
export const dialogBody = 'm-0 grid min-w-0 content-start gap-4 overflow-auto overscroll-contain px-4 py-5 sm:px-6 [&>*]:min-w-0 [&>*]:m-0';
export const dialogFooter = 'flex flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3 [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))] sm:px-6';

export function FormDialog({ title, description, closeLabel, drawer = false, busy = false, onClose, returnFocus, children }: {
  title: string;
  description?: string;
  closeLabel: string;
  drawer?: boolean;
  busy?: boolean;
  onClose: () => void;
  returnFocus?: () => HTMLElement | null;
  children: ReactNode;
}) {
  const trigger = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <Dialog.Content data-slot="form-dialog" data-drawer={drawer} aria-busy={busy}
          className={cn('fixed z-50 grid grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-background text-foreground shadow-xl motion-safe:data-[state=open]:animate-in motion-safe:data-[state=open]:fade-in-0 motion-safe:duration-200',
            drawer ? 'inset-y-0 right-0 h-dvh w-full max-w-3xl sm:rounded-l-xl motion-safe:data-[state=open]:slide-in-from-right-4' :
              'left-1/2 top-1/2 w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 max-h-[calc(100dvh-2rem)] rounded-xl')}
          {...(!description ? { 'aria-describedby': undefined } : {})}
          onPointerDownOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            const initial = heading.current?.closest('[role="dialog"]')?.querySelector<HTMLElement>('[data-initial-focus]');
            (initial ?? heading.current)?.focus({ preventScroll: true });
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocus?.() || trigger.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}>
          <header className="flex items-start justify-between gap-4 border-b border-border px-4 py-4 sm:px-6">
            <div>
              <Dialog.Title className="m-0 text-xl leading-snug font-semibold tracking-tight outline-none" ref={heading} tabIndex={-1}>{title}</Dialog.Title>
              {description && <Dialog.Description className="m-0 mt-1.5 wrap-anywhere text-sm text-muted-foreground">{description}</Dialog.Description>}
            </div>
            <Dialog.Close asChild>
              <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={closeLabel} disabled={busy}><X aria-hidden="true" /></Button>
            </Dialog.Close>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
