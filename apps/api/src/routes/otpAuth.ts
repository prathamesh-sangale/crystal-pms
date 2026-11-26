import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { otpRequestSchema, otpVerifySchema } from '@pms/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { env } from '../env.js';
import { parseOr422 } from '../http.js';
import { mailerConfigured, sendPmsLoginCode } from '../mailer.js';
import { supabase } from '../supabase.js';
import { toSession, USER_AUTH_SELECT, type UserRow } from './auth.js';

/**
 * Sign-in with an emailed 6-digit code: an additional way in alongside the
 * password login (routes/auth.ts), never a replacement for it (owner's
 * decision, 2026-11-26: "both").
 *
 * PMS sends the code itself, through the same mailbox OMS uses
 * (mailer.ts), in a PMS-branded email. Nothing is stored: /request returns
 * a signed, 10-minute `challenge` (its own HMAC format, never a session
 * JWT) holding an HMAC of email + code (keyed
 * with the server secret, so the code can't be recovered from it), and
 * /verify checks the code against it. The session issued on success is
 * identical to a password login's (same `toSession`, JWT shape, 12h expiry,
 * `token_version` check on every later request).
 *
 * Only addresses with an active PMS login get an email. Every other address
 * gets the same response, with a challenge no code can satisfy, so this
 * endpoint can't be used to find out which emails have accounts.
 */

const CODE_TTL_MS = 10 * 60 * 1000;
const verifyBodySchema = otpVerifySchema.extend({ challenge: z.string().min(20).max(2000) });

const mac = (purpose: string, data: string): string => createHmac('sha256', env.JWT_SECRET).update(`${purpose}:${data}`).digest('base64url');
const codeMac = (email: string, code: string): string => mac('pms-otp-code', `${email}:${code}`);

/** A challenge has its own signature format, so it can never pass as a session JWT. */
function signChallenge(email: string, h: string): string {
  const payload = Buffer.from(JSON.stringify({ e: email, h, x: Date.now() + CODE_TTL_MS })).toString('base64url');
  return `${payload}.${mac('pms-otp-challenge', payload)}`;
}

function readChallenge(challenge: string): { e: string; h: string } | null {
  const [payload, sig] = challenge.split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig);
  const b = Buffer.from(mac('pms-otp-challenge', payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { e?: unknown; h?: unknown; x?: unknown };
    if (typeof c.e !== 'string' || typeof c.h !== 'string' || typeof c.x !== 'number' || c.x < Date.now()) return null;
    return { e: c.e, h: c.h };
  } catch {
    return null;
  }
}

export async function otpAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/otp/request', {
    config: {
      // Lower than login's own budget: each call here can send a real email.
      rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 5, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const body = await parseOr422(otpRequestSchema, request.body, reply);
      if (!body) return;
      const email = body.email.toLowerCase();

      const { data: user } = (await supabase()
        .from('users')
        .select('id, name, active')
        .eq('email', email)
        .maybeSingle()) as { data: (Pick<UserRow, 'id' | 'active'> & { name?: string }) | null };

      const message = 'If that email has a PMS account, a 6-digit code has been sent.';
      // Unknown or deactivated: same response, with a challenge that matches no code.
      if (!user || !user.active || !mailerConfigured()) {
        if (user?.active && !mailerConfigured()) request.log.error('OTP requested but SMTP is not configured');
        return reply.send({ ok: true, message, challenge: signChallenge(email, randomBytes(32).toString('base64url')) });
      }

      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const challenge = signChallenge(email, codeMac(email, code));
      try {
        await sendPmsLoginCode(email, code, user.name ?? '');
      } catch (err) {
        request.log.error({ err }, 'Sending the PMS sign-in code failed');
        return reply.code(502).send({ error: 'otp_send_failed', message: 'Could not send the code right now. Try again, or use your password.' });
      }
      return reply.send({ ok: true, message, challenge });
    },
  });

  app.post('/api/auth/otp/verify', {
    config: {
      // Same budget as password login: this is the brute-force-guarded step.
      rateLimit: { max: env.NODE_ENV === 'test' ? 1000 : 10, timeWindow: '1 minute' },
    },
    handler: async (request, reply) => {
      const body = await parseOr422(verifyBodySchema, request.body, reply);
      if (!body) return;
      const email = body.email.toLowerCase();
      const invalid = { error: 'invalid_otp', message: 'That code is incorrect or has expired.' };

      const claims = readChallenge(body.challenge);
      if (!claims || claims.e !== email) return reply.code(401).send(invalid);
      const expected = Buffer.from(claims.h);
      const actual = Buffer.from(codeMac(email, body.code.trim()));
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return reply.code(401).send(invalid);

      const { data: user, error: fetchErr } = (await supabase()
        .from('users')
        .select(USER_AUTH_SELECT)
        .eq('email', email)
        .maybeSingle()) as { data: UserRow | null; error: unknown };
      if (fetchErr) throw app.httpErrors.internalServerError(String(fetchErr));
      if (!user || !user.active) return reply.code(401).send(invalid);

      const session = toSession(user);
      const token = app.jwt.sign(session, { expiresIn: '12h' });
      return reply.send({ token, user: session });
    },
  });
}
