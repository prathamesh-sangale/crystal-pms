import { Fragment, useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/crystal/Button';
import { StatusPill } from '../../components/crystal/Data';
import { EmptyState } from '../../components/crystal/Feedback';
import { Field } from '../../components/crystal/Form';

const TOKEN_KEY = 'pms-dev-logs-token';
const POLL_MS = 15_000;

interface ActionLogRow {
  id: number;
  created_at: string;
  method: string;
  path: string;
  category: string;
  status_code: number;
  user_id: string | null;
  user_email: string | null;
  user_role: string | null;
  body: unknown;
  query: unknown;
  ip: string | null;
}

class DevLogsError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Deliberately not `lib/api.ts`'s shared `request()` -- that helper
 * auto-attaches the normal app's own bearer token (`lib/api.ts`'s `token`
 * object), which must never apply here. This page's token lives under its
 * own sessionStorage key and is passed explicitly on every call. */
async function devLogsFetch<T>(path: string, token: string | null, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });
  const body: Record<string, unknown> = await res.json().catch(() => ({}));
  if (!res.ok) throw new DevLogsError(res.status, typeof body.message === 'string' ? body.message : 'Request failed.');
  return body as T;
}

/** The developer-only action log — reached only by knowing this exact URL
 * (never linked anywhere), gated by its own password (never the app's real
 * Sign In screen), authenticated with its own short-lived token that has
 * nothing to do with any login account. See App.tsx for how this bypasses
 * the normal session check entirely, and apps/api/src/routes/devLogs.ts /
 * actionLog.ts for the server side. */
export function DevLogs(): React.ReactElement {
  const [token, setToken] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });
  const [password, setPassword] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [logs, setLogs] = useState<ActionLogRow[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const lock = useCallback((): void => {
    try {
      sessionStorage.removeItem(TOKEN_KEY);
    } catch {
      /* private-mode storage can throw on write; nothing to clean up then anyway */
    }
    setToken(null);
  }, []);

  const handleLogin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setLoggingIn(true);
    setLoginError(null);
    try {
      const { token: newToken } = await devLogsFetch<{ token: string }>('/api/dev/logs/login', null, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      try {
        sessionStorage.setItem(TOKEN_KEY, newToken);
      } catch {
        /* still works for this tab even if it can't persist across a refresh */
      }
      setToken(newToken);
      setPassword('');
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : 'Could not sign in.');
    } finally {
      setLoggingIn(false);
    }
  };

  const loadLogs = useCallback(async (): Promise<void> => {
    if (!token) return;
    setLoading(true);
    try {
      const qs = category ? `?category=${encodeURIComponent(category)}` : '';
      const { logs: fetched } = await devLogsFetch<{ logs: ActionLogRow[] }>(`/api/dev/logs${qs}`, token);
      setLogs(fetched);
    } catch (err) {
      if (err instanceof DevLogsError && err.status === 401) lock();
    } finally {
      setLoading(false);
    }
  }, [token, category, lock]);

  useEffect(() => {
    if (!token) return;
    void loadLogs();
    const id = setInterval(() => void loadLogs(), POLL_MS);
    return () => clearInterval(id);
  }, [token, loadLogs]);

  useEffect(() => {
    if (!token) return;
    devLogsFetch<{ categories: string[] }>('/api/dev/logs/categories', token)
      .then(({ categories: fetched }) => setCategories(fetched))
      .catch(() => {});
  }, [token]);

  // Deterrent only, not real protection -- said plainly rather than implied
  // otherwise. Anyone can still open DevTools with a keyboard shortcut; the
  // actual gate is the server-side password + purpose-built token above.
  const blockContextMenu = (e: React.MouseEvent): void => e.preventDefault();

  if (!token) {
    return (
      <div onContextMenu={blockContextMenu} style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', background: 'var(--bg)' }}>
        <form onSubmit={(e) => void handleLogin(e)} className="stack" style={{ width: '280px' }}>
          <h1 style={{ fontSize: '16px', margin: '0 0 var(--s-2)', color: 'var(--text)' }}>Action Log</h1>
          <Field label="Password" required error={loginError ?? undefined}>
            {(props) => (
              <input {...props} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            )}
          </Field>
          <Button type="submit" variant="primary" loading={loggingIn} disabled={loggingIn || !password}>
            Unlock
          </Button>
        </form>
      </div>
    );
  }

  return (
    <div onContextMenu={blockContextMenu} style={{ minHeight: '100dvh', background: 'var(--bg)', padding: 'var(--s-4)' }}>
      <div className="stack stack-loose">
        <div className="cluster" style={{ justifyContent: 'space-between' }}>
          <h1 style={{ fontSize: '18px', margin: 0, color: 'var(--text)' }}>Action Log</h1>
          <Button variant="ghost" size="sm" onClick={lock}>
            Lock
          </Button>
        </div>

        <div className="cluster" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
          <button type="button" className="chip" aria-pressed={category === ''} onClick={() => setCategory('')}>
            All
          </button>
          {categories.map((c) => (
            <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </div>

        {logs.length === 0 ? (
          <EmptyState icon="info" title={loading ? 'Loading…' : 'Nothing logged yet'}>
            {loading ? 'One moment.' : 'No actions in this category yet.'}
          </EmptyState>
        ) : (
          <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--line)' }}>
                <th style={{ padding: '6px 8px' }}>Time</th>
                <th style={{ padding: '6px 8px' }}>Category</th>
                <th style={{ padding: '6px 8px' }}>Method</th>
                <th style={{ padding: '6px 8px' }}>Path</th>
                <th style={{ padding: '6px 8px' }}>Status</th>
                <th style={{ padding: '6px 8px' }}>User</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row) => (
                <Fragment key={row.id}>
                  <tr
                    style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }}
                    onClick={() => setExpandedId((cur) => (cur === row.id ? null : row.id))}
                  >
                    <td className="mono" style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{new Date(row.created_at).toLocaleString()}</td>
                    <td style={{ padding: '6px 8px' }}>{row.category}</td>
                    <td className="mono" style={{ padding: '6px 8px' }}>{row.method}</td>
                    <td className="mono" style={{ padding: '6px 8px' }}>{row.path}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <StatusPill
                        status={{
                          tone: row.status_code < 400 ? 'ok' : 'bad',
                          icon: row.status_code < 400 ? 'check' : 'alert',
                          label: String(row.status_code),
                          detail: `HTTP ${row.status_code}`,
                        }}
                      />
                    </td>
                    <td style={{ padding: '6px 8px' }}>{row.user_email ?? '—'}</td>
                  </tr>
                  {expandedId === row.id && (
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      <td colSpan={6} style={{ padding: '8px', background: 'var(--surface)' }}>
                        <pre className="mono" style={{ margin: 0, fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                          {JSON.stringify({ body: row.body, query: row.query, ip: row.ip, userRole: row.user_role }, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
