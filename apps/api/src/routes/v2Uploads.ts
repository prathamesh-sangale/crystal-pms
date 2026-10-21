import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireScreen } from '../auth.js';
import { parseOr422 } from '../http.js';
import { uploadToDrive } from '../googleDrive.js';

const MAX_BYTES = 50 * 1024 * 1024; // 50MB — covers the PTI video, the largest file this form ever sends.

// Matches every `accept` attribute the client's own file inputs use (gate
// photos, the PTI video, a survey PDF) -- nothing else this form sends.
const ALLOWED_MIME_PREFIXES = ['image/', 'video/'];
const ALLOWED_MIME_EXACT = ['application/pdf'];

function isAllowedMimeType(mimetype: string): boolean {
  return ALLOWED_MIME_EXACT.includes(mimetype) || ALLOWED_MIME_PREFIXES.some((prefix) => mimetype.startsWith(prefix));
}

// A query param, not a multipart form field — `request.file()` resolves as
// soon as it hits the first file part of the stream, so a field sent after
// the file in the same FormData isn't guaranteed to be captured yet. The
// query string has no such ordering gotcha. Defaults to 'other' for a
// caller that genuinely doesn't have one of the three real moments (Hydra's
// own upload today) rather than failing the upload outright.
const uploadQuerySchema = z.object({ category: z.enum(['gate-in', 'gate-out', 'survey', 'other']).default('other') });

/** Keeps the original name recognisable (so "IMG_0231.jpg" still reads as
 * that in Drive) while dropping path separators and anything that isn't
 * plain ASCII text, a digit, or one of a few safe punctuation marks --
 * nothing here is ever used as a filesystem path, but Drive's own API and
 * whatever eventually reads these filenames shouldn't have to care. */
function sanitizeFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? 'upload';
  const cleaned = base.replace(/[^A-Za-z0-9 ._-]/g, '_').slice(0, 200).trim();
  return cleaned || 'upload';
}

/**
 * The one piece item 57's "everything now flows and stores" pass couldn't
 * close: Gate-In's photos and PTI video were still URL.createObjectURL()
 * blobs, gone on reload. This route is the missing link — uploads a single
 * file to the PMS Shared Drive and hands back a real, permanent URL for the
 * client to store in gate_in/gate_out instead.
 */
export async function v2UploadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.post('/api/v2/uploads', { preHandler: requireScreen('live', 'yard') }, async (request, reply) => {
    const query = await parseOr422(uploadQuerySchema, request.query, reply);
    if (!query) return;
    const file = await request.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) {
      return reply.code(422).send({ error: 'validation_failed', message: 'No file was sent with this request.' });
    }
    if (!isAllowedMimeType(file.mimetype)) {
      return reply.code(422).send({ error: 'validation_failed', message: 'Only photos, videos, and PDFs can be uploaded here.' });
    }
    const buffer = await file.toBuffer();
    try {
      const uploaded = await uploadToDrive(buffer, sanitizeFilename(file.filename), file.mimetype, query.category);
      return reply.code(201).send(uploaded);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not upload this file.';
      request.log.error({ err }, 'Drive upload failed');
      throw app.httpErrors.internalServerError(message);
    }
  });
}
