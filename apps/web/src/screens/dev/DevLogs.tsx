import { useCallback, useEffect, useMemo, useState } from 'react';
import { formatDMY, istDay, istDayOffset, istToday } from '../../lib/istDate';
import { Button } from '../../components/crystal/Button';
import { StatusPill } from '../../components/crystal/Data';
import { DatePicker } from '../../components/crystal/DatePicker';
import { EmptyState } from '../../components/crystal/Feedback';
import { Chip, Field, InputWithIcon, SwitchField } from '../../components/crystal/Form';
import { Icon } from '../../components/crystal/Icon';
import { describeAction, type ActionLogRow } from './describeAction';

const TOKEN_KEY = 'pms-dev-logs-token';
const POLL_MS = 15_000;

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

/** "Today at 2:30 PM" reads at a glance; a full date is only worth printing
 * once it's not today or yesterday. Always in IST -- an audit log read by
 * whoever's checking it shouldn't change meaning depending on which
 * timezone their own device happens to be set to. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit' });
  const day = istDay(d);
  if (day === istToday()) return `Today at ${time}`;
  if (day === istDayOffset(-1)) return `Yesterday at ${time}`;
  return `${formatDMY(day)} at ${time}`;
}

/** The developer-only action log — reached only by knowing this exact URL
 * (never linked anywhere), gated by its own password (never the app's real
 * Sign In screen), authenticated with its own short-lived token that has
 * nothing to do with any login account. See App.tsx for how this bypasses
 * the normal session check entirely, and apps/api/src/routes/devLogs.ts /
 * actionLog.ts for the server side.
 *
 * The page reads like a diary, not a database dump: every row leads with a
 * plain-English sentence (describeAction.ts) — what happened, who did it,
 * when — with the raw method/path/status/body available on request behind
 * an expand toggle, for whoever actually needs to debug something. */
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
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [failedOnly, setFailedOnly] = useState(false);
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
      const params = new URLSearchParams();
      if (category) params.set('category', category);
      // "+05:30" (IST), not "Z" (UTC) -- the picker means "this calendar
      // day in IST," and stamping it as UTC midnight would shift the whole
      // window by 5.5 hours. Postgres/PostgREST parse an explicit-offset
      // ISO string correctly on their own; no manual conversion needed.
      if (from) params.set('since', `${from}T00:00:00+05:30`);
      if (to) params.set('until', `${to}T23:59:59.999+05:30`);
      const qs = params.toString();
      const { logs: fetched } = await devLogsFetch<{ logs: ActionLogRow[] }>(`/api/dev/logs${qs ? `?${qs}` : ''}`, token);
      setLogs(fetched);
    } catch (err) {
      if (err instanceof DevLogsError && err.status === 401) lock();
    } finally {
      setLoading(false);
    }
  }, [token, category, from, to, lock]);

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

  const described = useMemo(() => logs.map((row) => ({ row, ...describeAction(row) })), [logs]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return described.filter(({ row, summary, tone }) => {
      if (failedOnly && tone !== 'bad') return false;
      if (!needle) return true;
      return (
        summary.toLowerCase().includes(needle) ||
        (row.user_email ?? '').toLowerCase().includes(needle) ||
        row.path.toLowerCase().includes(needle)
      );
    });
  }, [described, search, failedOnly]);

  const hasFilters = category !== '' || from !== '' || to !== '' || search.trim() !== '' || failedOnly;

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
      <div className="stack stack-loose" style={{ maxWidth: '920px', margin: '0 auto' }}>
        <div className="cluster" style={{ justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: '18px', margin: 0, color: 'var(--text)' }}>Action Log</h1>
            <p className="subtle" style={{ margin: 0, fontSize: '12px' }}>What happened in the system, who did it, and when — in plain English.</p>
          </div>
          <Button variant="ghost" size="sm" onClick={lock}>
            Lock
          </Button>
        </div>

        <div className="stack" style={{ gap: 'var(--s-2)' }}>
          <div className="cluster" style={{ gap: 'var(--s-2)', flexWrap: 'wrap' }}>
            <Chip pressed={category === ''} onClick={() => setCategory('')}>
              All
            </Chip>
            {categories.map((c) => (
              <Chip key={c} pressed={category === c} onClick={() => setCategory(c)}>
                {c}
              </Chip>
            ))}
          </div>

          <div className="cluster" style={{ gap: 'var(--s-3)', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ minWidth: '220px', flex: '1 1 220px' }}>
              <InputWithIcon
                icon="search"
                placeholder="Search who, what, or path…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <Field label="From">{() => <DatePicker value={from} onChange={setFrom} />}</Field>
            <Field label="To">{() => <DatePicker value={to} onChange={setTo} />}</Field>
            <SwitchField checked={failedOnly} onCheckedChange={setFailedOnly} label="Failed only" />
            {hasFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setCategory('');
                  setFrom('');
                  setTo('');
                  setSearch('');
                  setFailedOnly(false);
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        </div>

        {visible.length === 0 ? (
          <EmptyState icon="info" title={loading ? 'Loading…' : hasFilters ? 'No matching actions' : 'Nothing logged yet'}>
            {loading ? 'One moment.' : hasFilters ? 'Try widening the filters above.' : 'Actions will show up here as they happen.'}
          </EmptyState>
        ) : (
          <div className="stack" style={{ gap: 'var(--s-2)' }}>
            {visible.map(({ row, summary, tone }) => {
              const expanded = expandedId === row.id;
              return (
                <div key={row.id} className="card" style={{ padding: 'var(--s-3)' }}>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : row.id)}
                    className="cluster"
                    style={{ width: '100%', justifyContent: 'space-between', alignItems: 'flex-start', background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div className="stack" style={{ gap: '4px' }}>
                      <span className="cluster" style={{ gap: 'var(--s-2)', flexWrap: 'nowrap' }}>
                        <StatusPill
                          status={{
                            tone,
                            icon: tone === 'ok' ? 'check' : 'alert',
                            label: tone === 'ok' ? 'OK' : 'Failed',
                            detail: `HTTP ${row.status_code}`,
                          }}
                        />
                        <span style={{ color: 'var(--text)' }}>{summary}</span>
                      </span>
                      <span className="subtle" style={{ fontSize: '12px' }}>
                        {formatWhen(row.created_at)} · {row.category}
                        {row.ip && <> · IP {row.ip}</>}
                      </span>
                    </div>
                    <Icon name={expanded ? 'chev-up' : 'chev-down'} size="sm" />
                  </button>
                  {expanded && (
                    <div className="stack" style={{ marginTop: 'var(--s-2)', paddingTop: 'var(--s-2)', borderTop: '1px solid var(--line)', gap: '4px' }}>
                      <span className="mono subtle" style={{ fontSize: '11px' }}>
                        {row.method} {row.path}
                      </span>
                      {row.user_role && (
                        <span className="mono subtle" style={{ fontSize: '11px' }}>
                          Role: {row.user_role}
                        </span>
                      )}
                      <pre className="mono" style={{ margin: 0, fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {JSON.stringify({ body: row.body, query: row.query }, null, 2)}
                      </pre>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
