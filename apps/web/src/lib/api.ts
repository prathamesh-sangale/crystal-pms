import type {
  ApiError,
  Container,
  OffLeaseUnit,
  Order,
  Stage,
  StageId,
  Status,
} from '@pms/shared';

const TOKEN_KEY = 'pms-token';

/**
 * Some browsers block localStorage outright (private mode, file:// origins).
 * Falling back to memory keeps the session alive for the tab instead of
 * throwing on every read.
 */
const store = {
  memory: null as string | null,
  get(): string | null {
    try {
      return localStorage.getItem(TOKEN_KEY) ?? this.memory;
    } catch {
      return this.memory;
    }
  },
  set(value: string | null): void {
    this.memory = value;
    try {
      if (value === null) localStorage.removeItem(TOKEN_KEY);
      else localStorage.setItem(TOKEN_KEY, value);
    } catch {
      /* memory copy above is the fallback */
    }
  },
};

export const token = {
  get: (): string | null => store.get(),
  set: (value: string | null): void => store.set(value),
};

/** A failed request, carrying the field-level messages a form needs. */
export class RequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;
  readonly payload: Record<string, unknown>;

  constructor(status: number, body: Partial<ApiError> & Record<string, unknown>) {
    super(body.message ?? 'Something went wrong.');
    this.name = 'RequestError';
    this.status = status;
    this.code = body.error ?? 'request_failed';
    this.fields = (body.fields as Record<string, string>) ?? {};
    this.payload = body;
  }
}

let onUnauthorized: (() => void) | null = null;
/** Lets the auth provider clear its state when a token expires mid-session. */
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const auth = token.get();
  if (auth) headers.set('authorization', `Bearer ${auth}`);

  let response: Response;
  try {
    response = await fetch(path, { ...init, headers });
  } catch {
    // A network failure is not the same as a rejected request, and the message
    // has to tell the difference or people retry the wrong thing.
    throw new RequestError(0, {
      error: 'offline',
      message: 'Could not reach the server. Check your connection and try again.',
    });
  }

  if (response.status === 204) return undefined as T;

  const body: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      token.set(null);
      onUnauthorized?.();
    }
    throw new RequestError(response.status, body as Partial<ApiError>);
  }
  return body as T;
}

/* ------------------------------------------------------------------------ */
/* Response shapes                                                           */
/* ------------------------------------------------------------------------ */

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: 'manager' | 'supervisor' | 'technician' | 'viewer';
  depotId: string | null;
}

export interface DepotSummary {
  name: string;
  location: string;
  isHome: boolean;
  total: number;
  ready: number;
  late: number;
  averageProgress: number;
}

export interface StageSummary extends Stage {
  count: number;
  late: number;
}

export interface OrderMatchSummary {
  order: Order;
  containerId: string | null;
  remaining: number | null;
  ready: boolean;
  elsewhereCount: number;
  status: Status;
}

export interface Overview {
  today: string;
  homeDepot: string;
  containers: Container[];
  offLease: OffLeaseUnit[];
  orders: Order[];
  matches: OrderMatchSummary[];
  depots: DepotSummary[];
  stages: StageSummary[];
  totals: {
    fleet: number;
    home: number;
    homeReady: number;
    homeLate: number;
    active: number;
    late: number;
    ready: number;
    double: number;
    anteroom: number;
    offLeaseIncoming: number;
    offLeaseHeavy: number;
    orders: number;
    ordersReady: number;
    ordersUnmatched: number;
    averagePlannedTurnaround: number;
  };
}

export interface Reference {
  depots: Array<{ id: string; name: string; isHome: boolean; location: string }>;
  homeDepot: string;
  technicians: Array<{ name: string; trade: string; backup: string | null }>;
  stages: Stage[];
  types: Array<{ value: 'standard' | 'double' | 'anteroom'; label: string; hint: string }>;
  sizes: string[];
  priorities: string[];
  anteroomVariants: string[];
  today: string;
}

export interface ContainerEvent {
  id: string;
  at: string;
  kind: string;
  summary: string;
  actor: string;
}

export interface ContainerDetail {
  container: Container;
  backup: string | null;
  events: ContainerEvent[];
  today: string;
}

export interface ChecklistLibrary {
  stages: Array<
    Stage & {
      tasks: Array<{ key: string; label: string; hrs: number; onlyFor: string[] | null }>;
      budget: { standard: number; double: number; anteroom: number };
    }
  >;
  totals: { standard: number; double: number; anteroom: number };
  today: string;
}

/* ------------------------------------------------------------------------ */
/* Endpoints                                                                 */
/* ------------------------------------------------------------------------ */

export const api = {
  login: (email: string, password: string) =>
    request<{ token: string; user: SessionUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: SessionUser }>('/api/auth/me'),

  reference: () => request<Reference>('/api/reference'),

  overview: () => request<Overview>('/api/overview'),

  containers: (query: Record<string, string | undefined> = {}) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) params.set(k, v);
    const qs = params.toString();
    return request<{ containers: Container[]; today: string }>(
      `/api/containers${qs ? `?${qs}` : ''}`
    );
  },

  container: (id: string) => request<ContainerDetail>(`/api/containers/${encodeURIComponent(id)}`),

  createContainer: (input: unknown) =>
    request<{ container: Container; today: string }>('/api/containers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  updateContainer: (id: string, input: unknown) =>
    request<{ container: Container; today: string }>(`/api/containers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  toggleTask: (id: string, key: string, done: boolean) =>
    request<{ container: Container; today: string }>(
      `/api/containers/${encodeURIComponent(id)}/tasks`,
      { method: 'POST', body: JSON.stringify({ key, done }) }
    ),

  advanceStage: (id: string, force = false) =>
    request<{ container: Container; today: string }>(
      `/api/containers/${encodeURIComponent(id)}/advance`,
      { method: 'POST', body: JSON.stringify({ force }) }
    ),

  removeContainer: (id: string) =>
    request<void>(`/api/containers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  checklistLibrary: () => request<ChecklistLibrary>('/api/checklist-library'),
};

/** Shape of the 409 the API returns when a stage still has open tasks. */
export interface StageIncomplete {
  openTasks: string[];
  nextStage: string;
}

export function isStageIncomplete(err: unknown): err is RequestError & { payload: StageIncomplete } {
  return err instanceof RequestError && err.code === 'stage_incomplete';
}

export type { StageId };
