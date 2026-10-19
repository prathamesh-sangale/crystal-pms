import { supabase } from './supabase.js';

/** Mirrors mockV2.ts's SECTION_TNT_HRS/PAINT_WORK_KEYS/LOGO_TNT_HRS and the
 * coat2-done -> 10h rule — kept in sync by hand for now, same "temporary
 * exception" v2Workers.ts's WORKER_TYPES already lives under (SPEC.md §6's
 * "no value typed twice" applies once v2's types move into @pms/shared, not
 * before). These are the only numbers that decide whether a finished clock
 * gets recorded as on-time or over target, so a drift here would be a real,
 * silent correctness bug, not a cosmetic one -- change this file whenever
 * the client-side targets change, and vice versa. */
const SECTION_TARGET_HRS: Partial<Record<string, number>> = { pti: 6, all_rounder: 11 };
const PAINT_WORK_KEYS = ['tape_display', 'primer', 'coat1', 'coat2'];
const LOGO_TARGET_HRS = 11;

interface TaskRow {
  key: string;
  state: string;
  completed_at: string | null;
  tnt_started_at: string;
  tnt_paused_at: string | null;
  tnt_paused_ms: number;
}

const settled = (t: TaskRow): boolean => t.state === 'done' || t.state === 'na';

/** Same pause-aware math as mockV2.ts's tntElapsedMs -- folds in whatever
 * outage time was already accumulated, plus (if still paused right now, the
 * one case that can't actually happen here since the group just finished,
 * but kept for parity) however long the current pause has run. */
function elapsedMs(startIso: string, pausedAtIso: string | null, pausedMs: number, nowMs: number): number {
  const livePauseMs = pausedAtIso ? Math.max(0, nowMs - new Date(pausedAtIso).getTime()) : 0;
  return Math.max(0, nowMs - new Date(startIso).getTime() - pausedMs - livePauseMs);
}

function earliestOf(tasks: TaskRow[]): TaskRow {
  return tasks.reduce((a, b) => (new Date(a.tnt_started_at).getTime() < new Date(b.tnt_started_at).getTime() ? a : b));
}

interface Candidate {
  clockKey: string;
  targetHrs: number;
  members: TaskRow[];
  /** Overrides the plain earliest-member start time -- only Logo needs
   * this, gated on the paint run it waits on having already finished. */
  startOverride?: () => string | null;
}

function candidatesFor(kind: string, tasks: TaskRow[]): Candidate[] {
  const target = SECTION_TARGET_HRS[kind];
  if (target && tasks.length > 0) {
    return [{ clockKey: kind === 'all_rounder' ? 'repairment' : 'pti', targetHrs: target, members: tasks }];
  }
  if (kind !== 'painting') return [];

  const candidates: Candidate[] = [];
  const nonLogo = tasks.filter((t) => t.key !== 'logo');
  if (nonLogo.length > 0) {
    const coat2 = tasks.find((t) => t.key === 'coat2');
    candidates.push({ clockKey: 'paint_work', targetHrs: coat2?.state === 'done' ? 10 : 4, members: nonLogo });
  }
  const logo = tasks.find((t) => t.key === 'logo');
  if (logo) {
    const paintRun = tasks.filter((t) => PAINT_WORK_KEYS.includes(t.key));
    candidates.push({
      clockKey: 'logo',
      targetHrs: LOGO_TARGET_HRS,
      members: [logo],
      startOverride: () => {
        if (paintRun.length > 0 && !paintRun.every(settled)) return null; // still gated on the paint run
        const paintDoneMs = Math.max(0, ...paintRun.map((t) => (t.completed_at ? new Date(t.completed_at).getTime() : 0)));
        return new Date(Math.max(new Date(logo.tnt_started_at).getTime(), paintDoneMs)).toISOString();
      },
    });
  }
  return candidates;
}

/** Called after a task PATCH sets a task to 'done'/'na' -- checks whether
 * that change just completed a whole TnT clock's group (every member task
 * now settled) and, if so, permanently records its final numbers. Safe to
 * call liberally: `unique (section_id, clock_key)` on tnt_records makes a
 * duplicate recording a harmless no-op, not a bug to guard against here. */
export async function recordTntCompletions(sectionId: string): Promise<void> {
  const { data: section, error: sectionErr } = await supabase()
    .from('sections')
    .select('kind, tasks(key, state, completed_at, tnt_started_at, tnt_paused_at, tnt_paused_ms)')
    .eq('id', sectionId)
    .single();
  if (sectionErr) throw sectionErr;

  const { kind, tasks } = section as { kind: string; tasks: TaskRow[] };
  const nowMs = Date.now();

  for (const candidate of candidatesFor(kind, tasks)) {
    if (!candidate.members.every(settled)) continue;
    const startIso = candidate.startOverride ? candidate.startOverride() : earliestOf(candidate.members).tnt_started_at;
    if (!startIso) continue; // Logo's own gate said "not yet" -- nothing to record.
    const driver = candidate.startOverride ? candidate.members[0]! : earliestOf(candidate.members);

    const { error } = await supabase()
      .from('tnt_records')
      .insert({
        section_id: sectionId,
        clock_key: candidate.clockKey,
        target_hrs: candidate.targetHrs,
        started_at: startIso,
        completed_at: new Date(nowMs).toISOString(),
        elapsed_ms: elapsedMs(startIso, driver.tnt_paused_at, driver.tnt_paused_ms, nowMs),
      });
    // 23505 = unique_violation -- already recorded (another member task's
    // own patch beat this one to it), not a real failure.
    if (error && error.code !== '23505') throw error;
  }
}
