/**
 * Hash-chained, append-only audit log.
 *
 * Each entry commits to the previous entry's hash, so editing, deleting or
 * reordering any past entry breaks verification from that point on.
 * hash = SHA-256( canonicalJSON({ seq, ts, type, payload, prevHash }) )
 */

export const GENESIS_HASH = '0'.repeat(64);

export type AuditType =
  | 'incident.start'
  | 'incident.end'
  | 'timeline.entry'
  | 'report.ai_update'
  | 'report.user_edit'
  | 'report.confirm'
  | 'protocol.open'
  | 'protocol.step'
  | 'ai.route'
  | 'consent.change'
  | 'export'
  | 'sync';

export interface AuditEntry {
  incidentId: string;
  seq: number;
  ts: string;
  type: AuditType;
  payload: unknown;
  prevHash: string;
  hash: string;
}

/** Deterministic JSON: object keys sorted recursively, undefined dropped. */
export function canonicalJSON(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return '[' + value.map((v) => canonicalJSON(v === undefined ? null : v)).join(',') + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function hashInput(e: Omit<AuditEntry, 'hash'>): string {
  return canonicalJSON({
    incidentId: e.incidentId,
    seq: e.seq,
    ts: e.ts,
    type: e.type,
    payload: e.payload,
    prevHash: e.prevHash,
  });
}

export async function createEntry(
  prev: AuditEntry | undefined,
  incidentId: string,
  type: AuditType,
  payload: unknown,
  now: Date = new Date(),
): Promise<AuditEntry> {
  const base = {
    incidentId,
    seq: prev ? prev.seq + 1 : 0,
    ts: now.toISOString(),
    type,
    // Round-trip through JSON so what we hash is exactly what we store.
    payload: JSON.parse(JSON.stringify(payload ?? null)),
    prevHash: prev ? prev.hash : GENESIS_HASH,
  };
  return { ...base, hash: await sha256Hex(hashInput(base)) };
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  /** seq of the first entry that failed, if any */
  brokenAt?: number;
  reason?: string;
}

export async function verifyChain(entries: AuditEntry[]): Promise<VerifyResult> {
  const sorted = [...entries].sort((a, b) => a.seq - b.seq);
  let prevHash = GENESIS_HASH;
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (e.seq !== i) {
      return { ok: false, checked: i, brokenAt: e.seq, reason: `Missing entry before seq ${e.seq}` };
    }
    if (e.prevHash !== prevHash) {
      return { ok: false, checked: i, brokenAt: e.seq, reason: `Entry ${e.seq} does not link to previous entry` };
    }
    const expected = await sha256Hex(hashInput(e));
    if (expected !== e.hash) {
      return { ok: false, checked: i, brokenAt: e.seq, reason: `Entry ${e.seq} content was modified` };
    }
    prevHash = e.hash;
  }
  return { ok: true, checked: sorted.length };
}
