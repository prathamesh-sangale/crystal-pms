/** Turns one raw action-log row (HTTP method/path/body) into a plain-English
 * sentence — direct request: a non-technical reader should be able to tell
 * what happened, who did it, and when, without parsing a path or a JSON
 * blob. Pure and pattern-matched on `path`/`method`/`body`, same shape every
 * route in this app already uses, so a route added later without an entry
 * here still falls through to a readable (if generic) sentence rather than
 * disappearing or showing raw JSON. */

export interface ActionLogRow {
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

export interface Described {
  summary: string;
  tone: 'ok' | 'bad';
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pathOnly(path: string): string {
  return path.split('?')[0] ?? path;
}

function segments(path: string): string[] {
  return pathOnly(path).split('/').filter(Boolean).map(decodeURIComponent);
}

const SECTION_LABELS: Record<string, string> = {
  painting: 'Painting',
  pti: 'PTI',
  cleaning: 'Cleaning',
  all_rounder: 'Repairment',
  sailing: 'Sailing Crew',
};

/** The task keys this app's own builders always use, by section — anything
 * not in here (a survey-flagged repair item, an ad-hoc "Add a new task"
 * label) falls back to humanizing the key itself rather than showing a raw
 * slug like `repair_outside_undercarriage`. */
const KNOWN_TASK_LABELS: Record<string, string> = {
  tape_display: 'Tape display + gasket',
  primer: 'Primer',
  coat1: '1st coat',
  coat2: '2nd coat',
  logo: 'Logo',
  paint_compressor: 'Paint compressor + display',
  lights: 'Lights',
  strip_curtain: 'Strip & curtain',
  mantrap: 'Mantrap',
  clean: 'Cleaning',
  repairment: 'Repairment',
  other: 'the task',
};

function taskLabel(key: string): string {
  const known = KNOWN_TASK_LABELS[key];
  if (known) return known;
  const humanized = key
    .replace(/^repair_/, '')
    .replace(/[_-]+/g, ' ')
    .trim();
  return humanized ? `Repair: ${humanized}` : key;
}

/** The verb phrase describing what happened — written assuming it
 * succeeded; a failed attempt gets this same phrase with a "— failed"
 * suffix appended by describeAction() below, rather than needing a second,
 * separately-worded version of every single case. */
function actionPhrase(row: ActionLogRow): string {
  const body = asRecord(row.body);
  const path = pathOnly(row.path);
  const segs = segments(path);

  // --- auth ---
  if (path === '/api/auth/login') return 'signed in';
  if (path === '/api/auth/logout') return 'signed out';
  if (path === '/api/auth/change-password') return 'changed their password';

  // --- containers ---
  if (path === '/api/v2/containers' && row.method === 'POST') {
    const id = typeof body.id === 'string' && body.id.trim() ? body.id : 'a new container';
    return `registered container ${id}`;
  }
  if (segs[0] === 'api' && segs[1] === 'v2' && segs[2] === 'containers' && segs.length === 4 && row.method === 'PATCH') {
    const id = segs[3]!;
    if ('gateOut' in body) return `gated out ${id}`;
    if (body.readyAt) return `marked ${id} ready to move`;
    if (body.priority === true) return `fast-tracked ${id}`;
    if (body.priority === false) return `removed the fast-track flag from ${id}`;
    if (body.departedAt) return `marked ${id} as departed`;
    if ('typeCode' in body || 'size' in body || 'color' in body) return `edited ${id}'s details`;
    return `updated container ${id}`;
  }
  if (segs[0] === 'api' && segs[1] === 'v2' && segs[2] === 'containers' && segs.length === 4 && row.method === 'DELETE') {
    return `deleted container ${segs[3]}`;
  }
  if (segs[2] === 'containers' && segs[4] === 'survey') {
    return `ran a survey on ${segs[3]}`;
  }
  if (segs[2] === 'containers' && segs[4] === 'sections' && segs[6] === 'tasks' && row.method === 'POST') {
    const id = segs[3]!;
    const kind = SECTION_LABELS[segs[5] ?? ''] ?? segs[5];
    const label = typeof body.label === 'string' ? body.label : 'a task';
    return `added "${label}" to ${id}'s ${kind} work`;
  }
  if (segs[2] === 'containers' && segs[4] === 'tasks' && segs.length === 7) {
    const id = segs[3]!;
    const kind = SECTION_LABELS[segs[5] ?? ''] ?? segs[5];
    const task = taskLabel(segs[6] ?? '');
    if (body.state === 'running') return `started "${task}" (${kind}) on ${id}`;
    if (body.state === 'done') return `completed "${task}" (${kind}) on ${id}`;
    if (body.state === 'na') return `marked "${task}" (${kind}) as N/A on ${id}`;
    if (body.state === 'pending') return `cancelled "${task}" (${kind}) on ${id}, back to pending`;
    if ('workerId' in body) return body.workerId ? `assigned a worker to "${task}" (${kind}) on ${id}` : `unassigned "${task}" (${kind}) on ${id}`;
    if ('site' in body) return `set a site for "${task}" (${kind}) on ${id}`;
    if ('scheduledFor' in body) return `rescheduled "${task}" (${kind}) on ${id}`;
    return `updated "${task}" (${kind}) on ${id}`;
  }

  // --- workers ---
  if (path === '/api/v2/workers' && row.method === 'POST') {
    const name = typeof body.name === 'string' ? body.name : 'a worker';
    return `added worker ${name}`;
  }
  if (segs[2] === 'workers' && segs.length === 4 && row.method === 'PATCH') {
    if ('active' in body) return body.active ? "reactivated a worker's roster entry" : 'marked a worker inactive';
    return "updated a worker's details";
  }
  if (segs[2] === 'workers' && segs.length === 4 && row.method === 'DELETE') return 'removed a worker';

  // --- access (logins) ---
  if (path === '/api/v2/users' && row.method === 'POST') {
    const email = typeof body.email === 'string' ? body.email : 'someone';
    return `created a login for ${email}`;
  }
  if (segs[2] === 'users' && segs.length === 4 && row.method === 'PATCH') {
    if ('password' in body) return "reset a login's password";
    if ('role' in body || 'allowedScreens' in body) return "changed a login's access";
    return 'updated a login';
  }
  if (segs[2] === 'users' && segs.length === 4 && row.method === 'DELETE') return 'removed a login';

  // --- drafts ---
  if (path === '/api/v2/drafts' && row.method === 'POST') return 'saved a draft';
  if (segs[2] === 'drafts' && row.method === 'DELETE') return 'discarded a draft';

  // --- uploads / photos ---
  if (path === '/api/v2/uploads' && row.method === 'POST') {
    const query = asRecord(row.query);
    const category = typeof query.category === 'string' && query.category !== 'other' ? ` ${query.category}` : '';
    return `uploaded a${category} photo`;
  }
  if (segs[2] === 'photos' && row.method === 'DELETE') return 'removed a photo';

  // --- power ---
  if (path === '/api/v2/power-status' && row.method === 'POST') {
    return body.isDown ? 'reported the yard power as down' : 'marked the yard power as back up';
  }

  // --- hydra ---
  if (path === '/api/v2/hydra' && row.method === 'POST') return 'logged a Hydra movement';

  // --- export ---
  if (path === '/api/v2/export-sheet' && row.method === 'POST') return 'synced the PMS Sheet';

  // --- fallback: never silent, just less specific ---
  const verb = row.method === 'POST' ? 'created' : row.method === 'PATCH' ? 'updated' : row.method === 'DELETE' ? 'removed' : 'did something with';
  const subject = segs.at(-1) ?? row.category;
  return `${verb} something in ${row.category} (${subject})`;
}

/** Who did it — the signed-in user for every normal action; for a login
 * attempt itself, nobody's authenticated yet, so falls back to the email
 * being attempted (present in the body, not redacted — "email" isn't a
 * sensitive key). */
function who(row: ActionLogRow): string {
  if (row.user_email) return row.user_email;
  const body = asRecord(row.body);
  if (pathOnly(row.path) === '/api/auth/login' && typeof body.email === 'string') return body.email;
  return 'Someone not signed in';
}

export function describeAction(row: ActionLogRow): Described {
  const phrase = actionPhrase(row);
  const failed = row.status_code >= 400;
  return {
    summary: failed ? `${who(row)} ${phrase} — failed (${row.status_code}).` : `${who(row)} ${phrase}.`,
    tone: failed ? 'bad' : 'ok',
  };
}
