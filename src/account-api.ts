export class AccountError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}
export async function accountRequest<T>(base: string, path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch(base + '/account-api/' + path, {
    credentials: 'include',
    cache: 'no-store',
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined && !method ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && ['wallet','orders','me','keys','support'].includes(path.split(/[/\?]/)[0])) {
      window.dispatchEvent(new Event('gateway-session-check'));
    }
    throw new AccountError(response.status, result.error || String(response.status));
  }
  return result;
}
