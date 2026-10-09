import { createHash, randomBytes } from 'node:crypto';
import { supabase } from './supabase.js';

const PREFIX = 'rrpms_';

/** A fast cryptographic hash, not scrypt — unlike a user password, an API
 * key is already a long, high-entropy random string nobody has to
 * remember or could feasibly guess, so there's nothing for a slow,
 * brute-force-resistant hash to defend against here; a key only leaks by
 * being exposed outright, not guessed. */
function hashKey(rawKey: string): string {
  return createHash('sha256').update(rawKey).digest('hex');
}

/** Generates a new key, stores only its hash, and returns the raw value —
 * which is shown exactly once, here, and never recoverable again (same
 * guarantee Supabase's own Personal Access Tokens make). */
export async function createApiKey(name: string): Promise<string> {
  const rawKey = `${PREFIX}${randomBytes(32).toString('hex')}`;
  const { error } = await supabase().from('api_keys').insert({ name, key_hash: hashKey(rawKey) });
  if (error) throw new Error(`Could not save the new API key: ${error.message}`);
  return rawKey;
}

/** Looks up a presented key by its hash, rejecting anything revoked or
 * simply unknown. Awaits the `last_used_at` update rather than firing it
 * and moving on — a true fire-and-forget call here turned out not to
 * reliably land (confirmed live: the update never persisted when left
 * unawaited inside a request handler, even though the exact same call
 * succeeds immediately when awaited directly). The audit trail this field
 * exists for isn't worth much if "best effort" quietly means "usually
 * doesn't happen," so a slightly slower, logged-on-failure await replaces
 * it instead of chasing the unawaited version's root cause further. */
export async function verifyApiKey(rawKey: string): Promise<boolean> {
  if (!rawKey.startsWith(PREFIX)) return false;
  const { data, error } = await supabase()
    .from('api_keys')
    .select('id, revoked_at')
    .eq('key_hash', hashKey(rawKey))
    .maybeSingle();
  if (error || !data || data.revoked_at) return false;
  const { error: touchError } = await supabase().from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', data.id);
  if (touchError) console.error('Failed to record API key usage:', touchError.message);
  return true;
}
