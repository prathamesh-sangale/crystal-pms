import type { ApiError } from '@pms/shared';
import type { FastifyReply } from 'fastify';
import { ZodError, type z, type ZodType } from 'zod';

/**
 * Turns a Zod failure into the single error shape the UI renders, with
 * per-field messages the form can attach directly to inputs.
 */
export function zodToApiError(error: ZodError): ApiError {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return {
    error: 'validation_failed',
    message: 'Some details need fixing before this can be saved.',
    fields,
  };
}

/**
 * Parse or reply 422. Returns null when it has already answered.
 *
 * Captures the whole schema type (`Schema extends ZodType`) and derives the
 * return type from it via `z.infer`, rather than asking TypeScript to infer
 * a bare output type parameter from `ZodType<T, ...>` directly — the latter
 * is a multi-param generic whose inference is version-sensitive (seen
 * diverging between local tsc and Vercel's newer bundled TypeScript,
 * silently loosening every field to optional).
 */
export async function parseOr422<Schema extends ZodType>(
  schema: Schema,
  data: unknown,
  reply: FastifyReply
): Promise<z.infer<Schema> | null> {
  try {
    return schema.parse(data);
  } catch (err) {
    if (err instanceof ZodError) {
      await reply.code(422).send(zodToApiError(err));
      return null;
    }
    throw err;
  }
}

export const notFound = (what: string): ApiError => ({
  error: 'not_found',
  message: `${what} was not found. It may have been removed by someone else.`,
});

export const conflict = (message: string): ApiError => ({ error: 'conflict', message });
