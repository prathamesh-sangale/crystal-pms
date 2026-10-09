import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { verifyApiKey } from '../apiKeys.js';
import { supabase } from '../supabase.js';
import { fromContainerRow, type ContainerRow } from '../v2Mappers.js';

const SECTION_LABELS: Record<string, string> = {
  painting: 'Painting',
  pti: 'PTI',
  cleaning: 'Cleaning',
  all_rounder: 'Repairment',
};

interface TaskLike {
  state: string;
}
interface SectionLike {
  kind: string;
  tasks: TaskLike[];
}
interface ContainerLike {
  typeCode: string;
  survey: { outcome: string } | null;
  sections: SectionLike[];
}

const settled = (t: TaskLike): boolean => t.state === 'done' || t.state === 'na';

/** Same logic as mockV2.ts's `isReadyToMove`/`sectionContainerCounts`,
 * reimplemented here rather than imported — apps/api's own `tsc -b`
 * project boundary (`rootDir`) doesn't allow `src/` to import a source
 * file from `apps/web`; only files outside that build graph (the
 * `scripts/` one-off tools) get away with crossing packages that way.
 * Small enough to duplicate deliberately rather than restructure the
 * build config for one route. */
function isReadyToMove(c: ContainerLike): boolean {
  if (!c.survey) return false;
  if (c.survey.outcome === 'ready') return true;
  if (c.sections.length === 0) return false;
  return c.sections.every((s) => s.tasks.length > 0 && s.tasks.every(settled));
}

/** Separate from `authenticate` (apps/api/src/auth.ts) on purpose — that's
 * for a person signed into the app with a JWT; this is for a non-human
 * caller (the IMS integration) that was never issued a user session and
 * never will be. A missing/garbage/revoked key always reads as 401, same
 * shape whichever reason, so a caller can't distinguish "wrong key" from
 * "key once existed" by probing. */
async function authenticateApiKey(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const header = request.headers.authorization ?? '';
  const key = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!key || !(await verifyApiKey(key))) {
    await reply.code(401).send({ error: 'unauthorized', message: 'Missing or invalid API key.' });
  }
}

/**
 * The one route built specifically for sharing data with an outside
 * system (the IMS), not for the app's own UI — deliberately a narrow,
 * read-only summary rather than raw access to every container's full
 * record: the caller gets exactly the numbers it asked for (yard count,
 * ready-for-transport count, and a few more a yard-management system
 * would realistically want), nothing it didn't ask for, and no way to
 * change anything through this path at all — there's no POST/PATCH/DELETE
 * here, only GET.
 */
export async function externalApiRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticateApiKey);

  app.get('/api/external/yard-summary', { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (_request, reply) => {
    const { data, error } = await supabase().from('containers').select('*, sections(*, tasks(*))').is('departed_at', null);
    if (error) throw app.httpErrors.internalServerError(error.message);

    const containers = (data as ContainerRow[]).map((row) => fromContainerRow(row) as unknown as ContainerLike);
    const totalInYard = containers.length;
    const readyForTransport = containers.filter(isReadyToMove).length;
    const awaitingSurvey = containers.filter((c) => !c.survey).length;
    const inProgress = totalInYard - readyForTransport - awaitingSurvey;

    const byType: Record<string, number> = {};
    for (const c of containers) {
      const key = c.typeCode.split(' · ')[0] ?? c.typeCode; // drop the "· Variant" half some records carry
      byType[key] = (byType[key] ?? 0) + 1;
    }

    const stageTally = new Map<string, { inProcess: number; inLine: number; done: number }>();
    for (const kind of ['painting', 'pti', 'cleaning', 'all_rounder']) stageTally.set(kind, { inProcess: 0, inLine: 0, done: 0 });
    for (const c of containers) {
      for (const kind of stageTally.keys()) {
        const section = c.sections.find((s) => s.kind === kind);
        if (!section || section.tasks.length === 0) continue;
        const tally = stageTally.get(kind)!;
        if (section.tasks.some((t) => t.state === 'running')) tally.inProcess += 1;
        else if (section.tasks.every(settled)) tally.done += 1;
        else tally.inLine += 1;
      }
    }
    const byStage = [...stageTally.entries()].map(([kind, counts]) => ({ stage: SECTION_LABELS[kind] ?? kind, ...counts }));

    return reply.send({
      generatedAt: new Date().toISOString(),
      totalInYard,
      readyForTransport,
      awaitingSurvey,
      inProgress,
      byType,
      byStage,
    });
  });
}
