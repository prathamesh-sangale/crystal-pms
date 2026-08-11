import { toISODate } from '@pms/shared';
import type { FastifyRequest } from 'fastify';
import { isProduction } from './env.js';

/**
 * "Today" as a single value the whole request agrees on.
 *
 * Outside production an `x-today: YYYY-MM-DD` header pins it, which is what
 * lets the end-to-end tests assert on delayed containers without waiting for
 * real days to pass. The header is ignored in production.
 */
export function todayFor(request: FastifyRequest): string {
  if (!isProduction) {
    const header = request.headers['x-today'];
    const value = Array.isArray(header) ? header[0] : header;
    if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }
  return toISODate(new Date());
}
