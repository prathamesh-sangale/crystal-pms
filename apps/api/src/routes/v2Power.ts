import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth.js';
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

  app.get('/api/v2/power-status', async (_request, reply) => {
    const { data, error } = await supabase()
      .from('yard_power_status')
      .select('is_down, changed_at')
      .eq('id', true)
      .single();
    if (error) throw error;
    const row = data as { is_down: boolean; changed_at: string };
    return reply.send({ isDown: row.is_down, changedAt: row.changed_at });
  });

  const sectionIdsForKinds = async (kinds: string[]): Promise<string[]> => {
    const { data, error } = await supabase().from('sections').select('id').in('kind', kinds);
    if (error) throw error;
    return (data ?? []).map((s: { id: string }) => s.id);
  };

  app.post('/api/v2/power-status', async (request, reply) => {
    const body = await parseOr422(setPowerSchema, request.body, reply);
    if (!body) return;
    const now = new Date().toISOString();

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
        if (pauseErr) throw pauseErr;
      }

      // PTI: reset outright, not paused -- a fresh clock for whatever's
      // currently in that stage, per direct instruction.
      const ptiIds = await sectionIdsForKinds(['pti']);
      if (ptiIds.length > 0) {
        const { error: resetErr } = await supabase()
          .from('tasks')
          .update({ tnt_started_at: now, tnt_paused_at: null, tnt_paused_ms: 0 })
          .in('state', ['pending', 'running'])
          .in('section_id', ptiIds);
        if (resetErr) throw resetErr;
      }
    } else {
      // Resuming: fold each paused task's outage time into its running
      // total, then clear the pause -- same clock it left off at.
      const { data: paused, error: pausedErr } = await supabase()
        .from('tasks')
        .select('id, tnt_paused_ms, tnt_paused_at')
        .not('tnt_paused_at', 'is', null);
      if (pausedErr) throw pausedErr;
      for (const t of (paused ?? []) as Array<{ id: string; tnt_paused_ms: number; tnt_paused_at: string }>) {
        const extraMs = Date.now() - new Date(t.tnt_paused_at).getTime();
        const { error: resumeErr } = await supabase()
          .from('tasks')
          .update({ tnt_paused_ms: t.tnt_paused_ms + Math.max(0, extraMs), tnt_paused_at: null })
          .eq('id', t.id);
        if (resumeErr) throw resumeErr;
      }
    }

    const { error: statusErr } = await supabase()
      .from('yard_power_status')
      .update({ is_down: body.isDown, changed_at: now })
      .eq('id', true);
    if (statusErr) throw statusErr;

    return reply.send({ isDown: body.isDown, changedAt: now });
  });
}
