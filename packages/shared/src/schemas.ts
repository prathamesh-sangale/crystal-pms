/**
 * schemas.ts — the API contract, written once and used by both sides.
 *
 * What used to live here (every v1 pipeline request schema) was removed
 * along with the rest of v1 — `loginSchema` is the one piece of the contract
 * that survived, since v2 still signs in through the same `/api/auth/login`
 * shape.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
  password: z.string().min(1, 'Enter your password'),
});
export type LoginInput = z.infer<typeof loginSchema>;

/** Sign-in with an emailed one-time code — an alternative to `loginSchema`'s
 * password flow, not a replacement for it. See routes/otpAuth.ts. */
export const otpRequestSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
});
export type OtpRequestInput = z.infer<typeof otpRequestSchema>;

export const otpVerifySchema = z.object({
  email: z.string().trim().min(1, 'Enter your email').email('That does not look like an email'),
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type OtpVerifyInput = z.infer<typeof otpVerifySchema>;

/** Shape of every error the API returns, so the UI has one thing to render. */
export interface ApiError {
  error: string;
  message: string;
  /** Field-level messages, keyed by form field name. */
  fields?: Record<string, string>;
}
