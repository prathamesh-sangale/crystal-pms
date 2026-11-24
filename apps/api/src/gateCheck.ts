import type { FastifyBaseLogger } from 'fastify';
import { env } from './env.js';
import { evaluateGateIn, evaluateGateOut, imsUnavailableDecision, type GateDecision } from './gateRules.js';
import { findMasterSheetStatus } from './imsLookup.js';

/** Off unless GATE_RULES_ENABLED is exactly "true": gate entries behave as before. */
export function gateRulesEnabled(): boolean {
  return env.GATE_RULES_ENABLED === 'true';
}

/**
 * Reads IMS (only reads) and applies the agreed Gate In / Gate Out rule.
 * Fails open: if IMS can't be read, the gate entry is allowed with a warning.
 */
export async function checkGate(
  kind: 'in' | 'out',
  containerId: string,
  typeCode: string | null | undefined,
  log?: FastifyBaseLogger
): Promise<GateDecision> {
  let rows;
  try {
    rows = await findMasterSheetStatus(containerId);
  } catch (err) {
    log?.warn({ err, containerId }, 'IMS status read failed; gate rule fails open');
    return imsUnavailableDecision(kind);
  }
  return kind === 'in' ? evaluateGateIn(rows, typeCode) : evaluateGateOut(rows, typeCode);
}
