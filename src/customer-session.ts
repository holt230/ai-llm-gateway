import { useCallback, useEffect, useRef, useState } from 'react';
import { accountRequest } from './account-api';

export type CustomerKey = { id: string; name: string; preview: string; modelGroup: string; secretAvailable: boolean };
export type CustomerDashboard = {
  role: 'user';
  user: { id: string; username: string };
  keys: CustomerKey[];
  groupLabels?: Record<string, string>;
  models: { id: string; endpoints: string[]; groups: string[] }[];
};
export type CustomerRoute = 'login' | 'register' | 'recover' | 'account';

export type AdminSession = { role: 'admin'; user: { username: string; name: string } };
export type SignedIn = CustomerDashboard | AdminSession;

export function useGatewaySession(base: string) {
  const [account, setAccount] = useState<SignedIn | null>();
  const [error, setError] = useState('');
  const version = useRef(0);
  const update = useCallback((value: SignedIn | null) => {
    version.current++;
    setError('');
    setAccount(value);
  }, []);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    setError('');
    try {
      const data = await accountRequest<SignedIn | { role: null; user: null }>(base, 'session');
      if (current === version.current) setAccount(data.role === null ? null : data);
    } catch (e) {
      if (current === version.current) setError((e as Error).message);
    }
  }, [base]);

  useEffect(() => {
    void refresh();
    const resume = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    window.addEventListener('pageshow', resume);
    window.addEventListener('gateway-session-check', refresh);
    document.addEventListener('visibilitychange', resume);
    return () => {
      version.current++;
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('gateway-session-check', refresh);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [refresh]);
  return { account, error, update, refresh };
}
