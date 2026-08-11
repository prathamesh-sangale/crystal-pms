/**
 * schemas.ts — the API contract, written once and used by both sides.
 *
 * The API parses requests with these. The web app derives its form types from
 * the same objects, so a field cannot drift between client and server.
 */
import { z } from 'zod';
import {
  ANTEROOM_VARIANTS,
  CONTAINER_SIZES,
  CONTAINER_TYPES,
  GRADES,
  PRIORITIES,
  STAGE_IDS,
} from './process.js';

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

/**
 * ISO 6346 container numbers are 4 letters then 7 digits. Depot staff type them
 * with spaces and a check-digit hyphen (`RFCU 445 129-8`), so we accept the
 * readable form and normalise rather than rejecting it.
 */
export const containerId = z
  .string()
  .trim()
  .min(4, 'A container ID is required')
  .max(20, 'That is longer than any container ID')
  .transform((v) => v.replace(/\s+/g, ' '));

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const createContainerSchema = z
  .object({
    id: containerId,
    size: z.enum(CONTAINER_SIZES),
    type: z.enum(CONTAINER_TYPES),
    anteroomVariant: z.enum(ANTEROOM_VARIANTS).nullable().default(null),
    customer: z.string().trim().min(1, 'Name the customer or lessee').max(120),
    priority: z.enum(PRIORITIES).default('Standard'),
    assignee: z.string().trim().min(1, 'Assign a technician').max(120),
    depot: z.string().trim().min(1, 'Choose a depot'),
    notes: z.string().max(2000).default(''),
  })
  .superRefine((val, ctx) => {
    // An anteroom unit carries mantrap work that differs by configuration, so
    // the variant is not optional for that type.
    if (val.type === 'anteroom' && !val.anteroomVariant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anteroomVariant'],
        message: 'Choose internal or external — the mantrap checklist differs',
      });
    }
    if (val.type !== 'anteroom' && val.anteroomVariant) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['anteroomVariant'],
        message: 'Only a reefer with an anteroom has a configuration',
      });
    }
  });
export type CreateContainerInput = z.infer<typeof createContainerSchema>;

export const updateContainerSchema = z.object({
  customer: z.string().trim().min(1).max(120).optional(),
  priority: z.enum(PRIORITIES).optional(),
  assignee: z.string().trim().min(1).max(120).optional(),
  depot: z.string().trim().min(1).optional(),
  notes: z.string().max(2000).optional(),
});
export type UpdateContainerInput = z.infer<typeof updateContainerSchema>;

export const toggleTaskSchema = z.object({
  key: z.string().min(1),
  done: z.boolean(),
});
export type ToggleTaskInput = z.infer<typeof toggleTaskSchema>;

export const advanceStageSchema = z.object({
  /** Advancing with open tasks is allowed, but it has to be deliberate. */
  force: z.boolean().default(false),
});
export type AdvanceStageInput = z.infer<typeof advanceStageSchema>;

export const containerQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  depot: z.string().trim().optional(),
  stage: z.enum(STAGE_IDS).optional(),
  type: z.enum(CONTAINER_TYPES).optional(),
  priority: z.enum(PRIORITIES).optional(),
  status: z.enum(['all', 'late', 'ready', 'active']).default('all'),
});
export type ContainerQuery = z.infer<typeof containerQuerySchema>;

export const offLeaseSchema = z.object({
  id: z.string().trim().min(1),
  customer: z.string().trim().min(1),
  size: z.enum(CONTAINER_SIZES),
  type: z.enum(CONTAINER_TYPES),
  expected: isoDate,
  depot: z.string().trim().min(1),
  grade: z.enum(GRADES),
  notes: z.string().max(2000).default(''),
});
export type OffLeaseInput = z.infer<typeof offLeaseSchema>;

export const orderSchema = z.object({
  id: z.string().trim().min(1),
  customer: z.string().trim().min(1),
  size: z.enum(CONTAINER_SIZES),
  type: z.enum(CONTAINER_TYPES),
  qty: z.number().int().min(1).max(999),
  needBy: isoDate,
  requirement: z.string().trim().min(1).max(2000),
});
export type OrderInput = z.infer<typeof orderSchema>;

/** Shape of every error the API returns, so the UI has one thing to render. */
export interface ApiError {
  error: string;
  message: string;
  /** Field-level messages, keyed by form field name. */
  fields?: Record<string, string>;
}
