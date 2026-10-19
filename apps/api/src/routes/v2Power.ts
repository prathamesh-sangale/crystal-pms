import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScreen } from '../auth.js';
import { parseOr422 } from '../http.js';
import { supabase } from '../supabase.js';

const setPowerSchema = z.object({ isDown: z.boolean() });

/** One yard-wide electricity switch, by direct request — not a log of past
 * outages, just the current state. Flipping it pauses the turnaround-time
 * (TnT) clock for Painting/Cleaning/Repairment work and resets it for PTI;
 * never touches elapsed_sec, started_at, worker_id, or task state, which
 * track actual logged work and stay exactly as they were. */
export async function v2PowerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  // V2DataProvider loads this for every signed-in user regardless of which
  // screen they're on (power state affects TnT clocks app-wide, not just
  // Dashboards), so this can't be scoped to one screen like the POST below
  // -- gated on having access to *any* screen instead, which only turns away
  // an account with none at all (nothing it could see this reflected in
  // anyway), closing the actual gap: an authenticated account with an empty
  // allowedScreens array could otherwise still probe this.
  app.get('/api/v2/power-status', { preHandler: requireScreen('live', 'yard', 'workers', 'dashboards', 'hydra', 'ims-stock') }, async (_request, reply) => {
    const { data, error } = await supabase()
      .from('yard_power_status')
      .select('is_down, changed_at')
      .eq('id', true)
      .single();
    if (error) throw app.httpErrors.internalServerError(error.message);
    const row = data as { is_down: boolean; changed_at: string };
    return reply.send({ isDown: row.is_down, changedAt: row.changed_at });
  });

  const sectionIdsForKinds = async (kinds: string[]): Promise<string[]> => {
    const { data, error } = await supabase().from('sections').select('id').in('kind', kinds);
    if (error) throw app.httpErrors.internalServerError(error.message);
    return (data ?? []).map((s: { id: string }) => s.id);
  };

  app.post('/api/v2/power-status', { preHandler: requireScreen('dashboards') }, async (request, reply) => {
    const body = await parseOr422(setPowerSchema, request.body, reply);
    if (!body) return;
    const now = new Date().toISOString();

    // Idempotency guard: this is the only thing standing between two
    // overlapping toggles (two supervisors reacting to the same outage, or a
    // double-click) and PTI's reset branch discarding elapsed time a second
    // time for no reason. Re-sending the state we're already in is a no-op.
    const { data: current, error: currentErr } = await supabase()
      .from('yard_power_status')
      .select('is_down')
      .eq('id', true)
      .single();
    if (currentErr) throw app.httpErrors.internalServerError(currentErr.message);
    if ((current as { is_down: boolean }).is_down === body.isDown) {
      return reply.send({ isDown: body.isDown, changedAt: now, unchanged: true });
    }

    if (body.isDown) {
      // Painting/Cleaning/Repairment: freeze the clock on every still-open
      // task in those sections — the outage shouldn't count against them.
      const pausableIds = await sectionIdsForKinds(['painting', 'cleaning', 'all_rounder']);
      if (pausableIds.length > 0) {
        const { error: pauseErr } = await supabase()
          .from('tasks')
          .update({ tnt_paused_at: now })
          .in('state', ['pending', 'running'])
          .is('tnt_paused_at', null)
          .in('section_id', pausableIds);
        if (pauseErr) throw app.httpErrors.internalServerError(pauseErr.message);
      }

      // PTI: reset outright, not paused -- a fresh clock for whatever's
      // currently in that stage, per direct instruction. Safe to run
      // unconditionally now that the idempotency guard above stops a repeat
      // "down" call from re-triggering this.
      const ptiIds = await sectionIdsForKinds(['pti']);
      if (ptiIds.length > 0) {
        const { error: resetErr } = await supabase()
          .from('tasks')
          .update({ tnt_started_at: now, tnt_paused_at: null, tnt_paused_ms: 0 })
          .in('state', ['pending', 'running'])
          .in('section_id', ptiIds);
        if (resetErr) throw app.httpErrors.internalServerError(resetErr.message);
      }
    } else {
      // Resuming: fold each paused task's outage time into its running
      // total, then clear the pause -- same clock it left off at. Run
      // concurrently rather than one round-trip at a time, and keep going
      // even if a handful of tasks fail, so one bad row can't leave the rest
      // stuck paused *and* the yard-wide flag never updated — the two most
      // confusing outcomes if this throws partway through.
      const { data: paused, error: pausedErr } = await supabase()
        .from('tasks')
        .select('id, tnt_paused_ms, tnt_paused_at')
        .not('tnt_paused_at', 'is', null);
      if (pausedErr) throw app.httpErrors.internalServerError(pausedErr.message);

      const results = await Promise.allSettled(
        ((paused ?? []) as Array<{ id: string; tnt_paused_ms: number; tnt_paused_at: string }>).map(async (t) => {
          const extraMs = Date.now() - new Date(t.tnt_paused_at).getTime();
          const { error: resumeErr } = await supabase()
            .from('tasks')
            .update({ tnt_paused_ms: t.tnt_paused_ms + Math.max(0, extraMs), tnt_paused_at: null })
            .eq('id', t.id);
          if (resumeErr) throw resumeErr;
          return t.id;
        })
      );
      const failedTaskIds = results
        .map((r, i) => (r.status === 'rejected' ? (paused ?? [])[i]!.id : null))
        .filter((id): id is string => id !== null);
      if (failedTaskIds.length > 0) {
        request.log.error({ failedTaskIds }, 'Some tasks failed to resume after power was restored');
      }
    }

    const { error: statusErr } = await supabase()
      .from('yard_power_status')
      .update({ is_down: body.isDown, changed_at: now })
      .eq('id', true);
    if (statusErr) throw app.httpErrors.internalServerError(statusErr.message);

    return reply.send({ isDown: body.isDown, changedAt: now });
  });
}
