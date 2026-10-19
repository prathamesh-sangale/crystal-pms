import type { FastifyReply, FastifyRequest } from 'fastify';
import type { SessionUser } from './auth.js';
import { supabase } from './supabase.js';

/** Prefix match, checked in order -- first match wins. Deliberately a list
 * of (prefix, category) pairs rather than a lookup keyed by the exact v2
 * route-file split, so a route nested under an existing prefix (e.g. the
 * task-patch/add-task routes under /api/v2/containers) falls under the same
 * category as its parent without needing its own entry. */
const CATEGORY_PREFIXES: Array<[string, string]> = [
  ['/api/auth', 'auth'],
  ['/api/v2/containers', 'containers'],
  ['/api/v2/workers', 'workers'],
  ['/api/v2/users', 'access'],
  ['/api/v2/drafts', 'drafts'],
  ['/api/v2/uploads', 'uploads'],
  ['/api/v2/power-status', 'power'],
  ['/api/v2/hydra', 'hydra'],
  ['/api/v2/ims', 'ims'],
  ['/api/v2/export', 'export'],
  ['/api/external', 'external-api'],
];

function categoryFor(path: string): string {
  for (const [prefix, category] of CATEGORY_PREFIXES) {
    if (path.startsWith(prefix)) return category;
  }
  // Never silently dropped -- a route added later and forgotten here still
  // shows up, just uncategorized, rather than vanishing from the log.
  return 'other';
}

// Matched by pattern rather than an exact set of today's field names
// (password, currentPassword, newPassword), so a future field like `pwd` or
// `passwordConfirm` gets caught without this file needing to know about it
// in advance.
const SENSITIVE_KEY = /password|secret|token/i;

/** Fully recursive -- every object/array value gets passed back through
 * redact() regardless of depth, not just the one level deep this app's
 * request bodies actually reach today (survey fields, gate-in photos). */
function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEY.test(k) ? '[redacted]' : redact(v);
  }
  return out;
}

/** Every non-GET request gets one row, success or failure alike -- a
 * rejected 401/403 is itself worth knowing about, not just what succeeded.
 * Called from app.ts's global `onResponse` hook, after the real response
 * has already been sent, so a logging failure here can never affect the
 * actual request -- caught and logged on its own, never thrown. */
export async function logAction(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (request.method === 'GET') return; // reads aren't "actions"
  if (request.url.startsWith('/api/dev/logs') || request.url.startsWith('/api/health')) return;

  const user = request.user as SessionUser | undefined;
  try {
    const { error } = await supabase()
      .from('action_logs')
      .insert({
        method: request.method,
        path: request.url,
        category: categoryFor(request.url),
        status_code: reply.statusCode,
        user_id: user?.id ?? null,
        user_email: user?.email ?? null,
        user_role: user?.role ?? null,
        body: redact(request.body),
        query: redact(request.query) ?? null,
        ip: request.ip,
      });
    if (error) throw error;
  } catch (err) {
    request.log.error({ err }, 'Failed to write action log');
  }
}
