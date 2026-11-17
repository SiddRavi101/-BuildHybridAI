import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { ReportState, Where } from '../report/schema';
import { createEntry, type AuditEntry, type AuditType } from '../audit/hashChain';

export type EntryKind = 'speech' | 'typed' | 'quick' | 'protocol' | 'system';

export interface TimelineEntry {
  id: string;
  ts: string;
  text: string;
  kind: EntryKind;
  /** for speech: where recognition ran */
  speechWhere?: 'local' | 'cloud';
}

export interface Incident {
  id: string;
  title: string;
  startedAt: string;
  endedAt?: string;
  timeline: TimelineEntry[];
  report: ReportState;
  /** Per-incident consent: cloud may process PHI for THIS incident. Default false. */
  allowCloudForPHI: boolean;
  /** Per-incident opt-in to sync identifiable data. Default false (de-identified only). */
  syncPHI: boolean;
  /** Transcript entries not yet structured by AI (e.g. no on-device model). */
  pendingExtractionFrom?: number;
  protocols: { protocolId: string; checked: number[]; openedAt: string }[];
  sync?: { state: 'local' | 'pending' | 'synced' | 'error'; at?: string; error?: string };
  summary?: { text: string; where: Where; at: string };
  /** Free-text names spoken/typed, used to strengthen de-identification. */
  knownNames?: string[];
}

interface PinpointDB extends DBSchema {
  incidents: { key: string; value: Incident; indexes: { byStart: string } };
  audit: { key: [string, number]; value: AuditEntry; indexes: { byIncident: string } };
  kv: { key: string; value: unknown };
}

let dbp: Promise<IDBPDatabase<PinpointDB>> | null = null;
export function db() {
  if (!dbp) {
    dbp = openDB<PinpointDB>('pinpoint-field', 1, {
      upgrade(d) {
        const inc = d.createObjectStore('incidents', { keyPath: 'id' });
        inc.createIndex('byStart', 'startedAt');
        const a = d.createObjectStore('audit', { keyPath: ['incidentId', 'seq'] });
        a.createIndex('byIncident', 'incidentId');
        d.createObjectStore('kv');
      },
    });
  }
  return dbp;
}

export async function saveIncident(i: Incident) {
  await (await db()).put('incidents', i);
}
export async function getIncident(id: string) {
  return (await db()).get('incidents', id);
}
export async function listIncidents(): Promise<Incident[]> {
  const all = await (await db()).getAllFromIndex('incidents', 'byStart');
  return all.reverse();
}
export async function deleteIncident(id: string) {
  const d = await db();
  const tx = d.transaction(['incidents', 'audit'], 'readwrite');
  await tx.objectStore('incidents').delete(id);
  const keys = await tx.objectStore('audit').index('byIncident').getAllKeys(id);
  for (const k of keys) await tx.objectStore('audit').delete(k);
  await tx.done;
}

export async function getKV<T>(key: string, fallback: T): Promise<T> {
  const v = await (await db()).get('kv', key);
  return (v as T) ?? fallback;
}
export async function setKV(key: string, value: unknown) {
  await (await db()).put('kv', value, key);
}

// ---------------- audit chain ----------------

export async function getAudit(incidentId: string): Promise<AuditEntry[]> {
  const all = await (await db()).getAllFromIndex('audit', 'byIncident', incidentId);
  return all.sort((a, b) => a.seq - b.seq);
}

const appendQueues = new Map<string, Promise<AuditEntry | void>>();

/** Append to the hash chain. Serialized per incident so two writers can't fork the chain. */
export function appendAudit(incidentId: string, type: AuditType, payload: unknown): Promise<AuditEntry> {
  const prevP = appendQueues.get(incidentId) ?? Promise.resolve();
  const next = prevP
    .catch(() => undefined)
    .then(async () => {
      const d = await db();
      const entries = await d.getAllFromIndex('audit', 'byIncident', incidentId);
      const last = entries.sort((a, b) => a.seq - b.seq).at(-1);
      const entry = await createEntry(last, incidentId, type, payload);
      await d.add('audit', entry);
      return entry;
    });
  appendQueues.set(incidentId, next);
  return next;
}

/** For the demo's "tamper" button: silently alter a stored entry. */
export async function tamperAuditEntry(incidentId: string, seq: number) {
  const d = await db();
  const e = await d.get('audit', [incidentId, seq]);
  if (!e) return;
  await d.put('audit', { ...e, payload: { tampered: true, original: e.payload } });
}
