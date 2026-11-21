import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle
} from './alert-dialog';

type AskConfirmation = (message: string) => Promise<boolean>;
const ConfirmationContext = createContext<AskConfirmation>(async () => false);

export const useConfirmation = () => useContext(ConfirmationContext);

export function ConfirmationProvider({ english, children }: { english: boolean; children: ReactNode }) {
  const [message, setMessage] = useState('');
  const resolve = useRef<((confirmed: boolean) => void) | undefined>(undefined);
  const returnFocus = useRef<HTMLElement | null>(null);
  const ask: AskConfirmation = (text) => new Promise((done) => {
    if (resolve.current) return done(false);
    const active = document.activeElement;
    const triggerId = active?.closest('[role="menu"]')?.getAttribute('aria-labelledby');
    const trigger = triggerId ? document.getElementById(triggerId) : active;
    returnFocus.current = trigger instanceof HTMLElement ? trigger : null;
    resolve.current = done;
    setMessage(text);
  });
  const close = (confirmed: boolean) => {
    resolve.current?.(confirmed);
    resolve.current = undefined;
    setMessage('');
  };
  return (
    <ConfirmationContext.Provider value={ask}>
      {children}
      <AlertDialog open={Boolean(message)} onOpenChange={(open) => { if (!open) close(false); }}>
        <AlertDialogContent onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (returnFocus.current?.isConnected) returnFocus.current.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle>{english ? 'Confirm action' : '确认操作'}</AlertDialogTitle>
            <AlertDialogDescription>{message}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => close(false)}>{english ? 'Cancel' : '取消'}</AlertDialogCancel>
            <AlertDialogAction onClick={() => close(true)}>{english ? 'Confirm' : '确认'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </ConfirmationContext.Provider>
  );
}
