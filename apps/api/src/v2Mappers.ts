/**
 * Row <-> shape conversion for v2's Supabase tables. The relational columns
 * (containers/sections/tasks' own scalar fields) are snake_case and need
 * mapping; the three jsonb blobs (survey_fields, gate_in, gate_out) are
 * stored as whatever shape the app wrote them in — mockV2.ts's camelCase
 * types pass straight through unchanged, no mapping needed there.
 */

export interface TaskRow {
  id: string;
  key: string;
  label: string;
  worker_id: string | null;
  state: string;
  started_at: string | null;
  elapsed_sec: number;
  completed_at: string | null;
  optional: boolean;
  est_hrs: number;
  site: string | null;
  owner_type: string | null;
  depends_on: string[];
  scheduled_for: string | null;
}

export interface SectionRow {
  id: string;
  kind: string;
  tasks: TaskRow[];
}

export interface ContainerRow {
  id: string;
  type_code: string;
  size: string;
  color: string | null;
  priority: boolean;
  registered_at: string;
  current_site: string | null;
  ready_at: string | null;
  ready_photo_url: string | null;
  departed_at: string | null;
  survey_performed_at: string | null;
  survey_outcome: string | null;
  survey_fields: unknown;
  gate_in: unknown;
  gate_out: unknown;
  sections?: SectionRow[];
}

function fromTaskRow(row: TaskRow): Record<string, unknown> {
  return {
    key: row.key,
    label: row.label,
    workerId: row.worker_id,
    state: row.state,
    startedAt: row.started_at ? new Date(row.started_at).getTime() : null,
    elapsedSec: row.elapsed_sec,
    completedAt: row.completed_at,
    optional: row.optional,
    estHrs: Number(row.est_hrs),
    site: row.site,
    ownerType: row.owner_type ?? undefined,
    dependsOn: row.depends_on?.length ? row.depends_on : undefined,
    scheduledFor: row.scheduled_for,
  };
}

/** `sections`/`tasks` come from a PostgREST embedded select
 * (`containers?select=*,sections(*,tasks(*))`) — absent only if the caller
 * didn't ask for them. */
export function fromContainerRow(row: ContainerRow): Record<string, unknown> {
  return {
    id: row.id,
    typeCode: row.type_code,
    size: row.size,
    color: row.color,
    priority: row.priority,
    registeredAt: row.registered_at,
    currentSite: row.current_site,
    readyAt: row.ready_at,
    readyPhotoUrl: row.ready_photo_url,
    departedAt: row.departed_at,
    survey: row.survey_performed_at
      ? { performedAt: row.survey_performed_at, outcome: row.survey_outcome, fields: row.survey_fields ?? [] }
      : null,
    gateIn: row.gate_in ?? null,
    gateOut: row.gate_out ?? null,
    sections: (row.sections ?? []).map((s) => ({ kind: s.kind, tasks: (s.tasks ?? []).map(fromTaskRow) })),
  };
}

export interface InboundTask {
  key: string;
  label: string;
  workerId: string | null;
  state: string;
  startedAt: number | null;
  elapsedSec: number;
  completedAt?: string | null;
  optional?: boolean;
  estHrs: number;
  site: string | null;
  ownerType?: string;
  dependsOn?: string[];
  scheduledFor?: string | null;
}

export function toTaskInsert(sectionId: string, task: InboundTask): Record<string, unknown> {
  return {
    section_id: sectionId,
    key: task.key,
    label: task.label,
    worker_id: task.workerId,
    state: task.state,
    started_at: task.startedAt ? new Date(task.startedAt).toISOString() : null,
    elapsed_sec: task.elapsedSec,
    completed_at: task.completedAt ?? null,
    optional: task.optional ?? false,
    est_hrs: task.estHrs,
    site: task.site,
    owner_type: task.ownerType ?? null,
    depends_on: task.dependsOn ?? [],
    scheduled_for: task.scheduledFor ?? null,
  };
}
