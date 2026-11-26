import { api } from './api';

/**
 * Copies one just-saved gate entry into the legacy Gate-In portal's sheets,
 * in short server steps (each request stays inside the hosting time limit).
 * Fire-and-forget: the gate entry is already saved in PMS, and anything left
 * unfinished here is resumed by the app shell's periodic catch-up. Does
 * nothing while the sync is switched off on the server.
 */
export async function syncGateEntryToLegacy(containerId: string, kind: 'in' | 'out'): Promise<'done' | 'off' | 'pending'> {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await api.v2LegacySync(containerId, kind);
      if (!res.enabled) return 'off';
      if (res.state?.done) return 'done';
    } catch {
      // Network or a step failure: the catch-up retries later.
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return 'pending';
}
