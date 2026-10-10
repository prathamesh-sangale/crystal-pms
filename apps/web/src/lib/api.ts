import type { ApiError } from '@pms/shared';
import type { ContainerDraft, ContainerDraftData, MockContainer, MockWorker, SectionKind } from './mockV2';

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
  // A FormData body (the upload endpoint) needs the browser to set its own
  // multipart/form-data content-type, boundary included — setting it by
  // hand here would produce a body the server can't actually parse.
  if (init.body && !headers.has('content-type') && !(init.body instanceof FormData)) {
    headers.set('content-type', 'application/json');
  }
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

  v2Workers: () => request<{ workers: MockWorker[] }>('/api/v2/workers'),

  v2CreateWorker: (worker: MockWorker) =>
    request<{ worker: MockWorker }>('/api/v2/workers', {
      method: 'POST',
      body: JSON.stringify(worker),
    }),

  v2UpdateWorker: (id: string, patch: Partial<Omit<MockWorker, 'id'>>) =>
    request<{ worker: MockWorker }>(`/api/v2/workers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  v2DeleteWorker: (id: string) =>
    request<void>(`/api/v2/workers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  v2Containers: () => request<{ containers: MockContainer[] }>('/api/v2/containers'),

  v2GateIn: (container: MockContainer) =>
    request<{ container: MockContainer }>('/api/v2/containers', {
      method: 'POST',
      body: JSON.stringify(container),
    }),

  v2PatchContainer: (id: string, patch: ContainerPatch) =>
    request<{ container: MockContainer }>(`/api/v2/containers/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),

  v2RemoveContainer: (id: string) =>
    request<void>(`/api/v2/containers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  v2PatchTask: (containerId: string, kind: SectionKind, key: string, patch: TaskPatch) =>
    request<{ container: MockContainer }>(
      `/api/v2/containers/${encodeURIComponent(containerId)}/tasks/${encodeURIComponent(kind)}/${encodeURIComponent(key)}`,
      { method: 'PATCH', body: JSON.stringify(patch) }
    ),

  v2AddTask: (containerId: string, kind: SectionKind, task: NewTaskInput) =>
    request<{ container: MockContainer }>(
      `/api/v2/containers/${encodeURIComponent(containerId)}/sections/${encodeURIComponent(kind)}/tasks`,
      { method: 'POST', body: JSON.stringify(task) }
    ),

  v2Drafts: () => request<{ drafts: ContainerDraft[] }>('/api/v2/drafts'),

  v2SaveDraft: (id: string, savedAt: string, data: ContainerDraftData) =>
    request<{ draft: ContainerDraft }>('/api/v2/drafts', {
      method: 'POST',
      body: JSON.stringify({ id, savedAt, data }),
    }),

  v2DiscardDraft: (id: string) => request<void>(`/api/v2/drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  v2Upload: (file: File) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return request<{ id: string; url: string }>('/api/v2/uploads', { method: 'POST', body: form });
  },

  v2ImsLookup: (containerId: string) =>
    request<ImsLookupResult>(`/api/v2/ims-lookup?containerId=${encodeURIComponent(containerId)}`),

  hydraMovements: () => request<{ movements: HydraMovement[] }>('/api/v2/hydra'),

  hydraCreateMovement: (input: HydraMovementInput) =>
    request<{ movement: HydraMovement }>('/api/v2/hydra', { method: 'POST', body: JSON.stringify(input) }),
};

/** One row from the IMS's own container data — read-only, never written
 * back to. `suggestedTypeCode`/`suggestedSize` are this depot's own
 * Type/Size dropdown values the server could confidently map IMS's own
 * (messier, inconsistent) values onto; `null` means no confident mapping,
 * so the admin picks manually instead of a guess being forced on them. */
export interface ImsMatch {
  containerId: string;
  imsType: string;
  imsSize: string;
  depot: string;
  status: string;
  grade: string;
  suggestedTypeCode: string | null;
  suggestedSize: string | null;
}

export interface ImsLookupResult {
  /** Candidates at our own yard only — the only ones ever offered for pre-fill. */
  matches: ImsMatch[];
  /** The same number found at a different depot — never pre-filled, shown as a note instead. */
  elsewhere: ImsMatch[];
}

/** A Hydra movement log entry — standalone, independent of the readiness
 * workflow's own container records. Append-only: there's no edit/delete. */
export interface HydraMovement {
  id: string;
  movementDate: string;
  containerNo: string;
  type: string;
  size: string;
  movementType: 'Loading' | 'Unloading' | 'Shifting';
  /** Null for Shifting — the form disables and clears this field then. */
  direction: 'IN' | 'OUT' | null;
  fileId: string | null;
  fileUrl: string | null;
  loggedBy: string | null;
  createdAt: string;
}

export type HydraMovementInput = Pick<
  HydraMovement,
  'movementDate' | 'containerNo' | 'type' | 'size' | 'movementType' | 'direction' | 'fileId' | 'fileUrl'
>;

type ContainerPatch = Partial<
  Pick<MockContainer, 'typeCode' | 'size' | 'color' | 'priority' | 'currentSite' | 'readyAt' | 'readyPhotoUrl' | 'departedAt' | 'gateOut'>
>;
type TaskPatch = Partial<
  Pick<MockContainer['sections'][number]['tasks'][number], 'workerId' | 'state' | 'startedAt' | 'elapsedSec' | 'completedAt' | 'site' | 'scheduledFor'>
>;

export interface NewTaskInput {
  key: string;
  label: string;
  workerId: string | null;
  site: string | null;
  ownerType?: string;
  scheduledFor?: string | null;
}

