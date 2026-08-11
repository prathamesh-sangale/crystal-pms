import type { ApiError } from '@pms/shared';
import type { FastifyReply } from 'fastify';
import { ZodError, type ZodSchema } from 'zod';

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

/** Parse or reply 422. Returns null when it has already answered. */
export async function parseOr422<T>(
  schema: ZodSchema<T>,
  data: unknown,
  reply: FastifyReply
): Promise<T | null> {
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
