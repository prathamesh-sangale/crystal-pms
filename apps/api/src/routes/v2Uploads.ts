import type { FastifyInstance } from 'fastify';
import { authenticate } from '../auth.js';
import { uploadToDrive } from '../googleDrive.js';

const MAX_BYTES = 50 * 1024 * 1024; // 50MB — covers the PTI video, the largest file this form ever sends.

/**
 * The one piece item 57's "everything now flows and stores" pass couldn't
 * close: Gate-In's photos and PTI video were still URL.createObjectURL()
 * blobs, gone on reload. This route is the missing link — uploads a single
 * file to the PMS Shared Drive and hands back a real, permanent URL for the
 * client to store in gate_in/gate_out instead.
 */
export async function v2UploadRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);

  app.post('/api/v2/uploads', async (request, reply) => {
    const file = await request.file({ limits: { fileSize: MAX_BYTES } });
    if (!file) {
      return reply.code(422).send({ error: 'validation_failed', message: 'No file was sent with this request.' });
    }
    const buffer = await file.toBuffer();
    try {
      const uploaded = await uploadToDrive(buffer, file.filename, file.mimetype);
      return reply.code(201).send(uploaded);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not upload this file.';
      request.log.error({ err }, 'Drive upload failed');
      throw app.httpErrors.internalServerError(message);
    }
  });
}
