import { useCallback, useEffect, useRef, useState } from 'react';
import { appendAudit, getIncident, saveIncident, type EntryKind, type Incident, type TimelineEntry } from './db';
import { emptyReport, type Field, type Injury, type Intervention, type Item, type ReportState, type Vitals } from '../report/schema';
import { mergeExtraction, newId } from '../report/merge';
import { ruleExtract } from '../report/rules';
import { extractReport } from '../report/extractor';
import type { AuditType } from '../audit/hashChain';

export type ScalarPath = 'patient.ageRange' | 'patient.sex' | 'patient.chiefComplaint' | 'mechanismOfInjury' | 'handoffNotes';
export type ListKey = 'injuries' | 'interventions' | 'vitals';

export interface ExtractionStatus {
  state: 'idle' | 'running' | 'blocked' | 'error';
  message?: string;
  streaming?: string;
}

export async function createIncident(allowCloudForPHI: boolean): Promise<Incident> {
  const now = new Date();
  const inc: Incident = {
    id: crypto.randomUUID(),
    title: `INC-${now.toISOString().slice(2, 10).replace(/-/g, '')}-${now.toTimeString().slice(0, 5).replace(':', '')}`,
    startedAt: now.toISOString(),
    timeline: [],
    report: emptyReport(),
    allowCloudForPHI,
    syncPHI: false,
    protocols: [],
    sync: { state: 'local' },
    knownNames: [],
  };
  await saveIncident(inc);
  await appendAudit(inc.id, 'incident.start', { title: inc.title, allowCloudForPHI });
  return inc;
}

const getScalar = (r: ReportState, p: ScalarPath): Field =>
  p.startsWith('patient.') ? r.patient[p.slice(8) as keyof ReportState['patient']] : (r[p as 'mechanismOfInjury' | 'handoffNotes'] as Field);

function setScalar(r: ReportState, p: ScalarPath, f: Field): ReportState {
  if (p.startsWith('patient.')) return { ...r, patient: { ...r.patient, [p.slice(8)]: f } };
  return { ...r, [p]: f };
}

/** Pull obvious names out of what was said so de-identification can redact them everywhere. */
function harvestNames(text: string): string[] {
  const out: string[] = [];
  const re = /\b(?:name is|named|called)\s+([A-Z][a-z'-]+(?:\s+[A-Z][a-z'-]+)?)/g;
  for (const m of text.matchAll(re)) out.push(...m[1].split(/\s+/));
  return out;
}

export function useIncident(id: string | null, opts: { autoStructure: boolean; onDeviceReady: boolean }) {
  const [incident, setIncident] = useState<Incident | null>(null);
  const [extraction, setExtraction] = useState<ExtractionStatus>({ state: 'idle' });
  const ref = useRef<Incident | null>(null);
  const running = useRef(false);
  const rerun = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setIncident(null);
      ref.current = null;
      return;
    }
    getIncident(id).then((i) => {
      if (!cancelled) {
        ref.current = i ?? null;
        setIncident(i ?? null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const commit = useCallback(async (next: Incident) => {
    ref.current = next;
    setIncident(next);
    await saveIncident(next);
  }, []);

  const audit = useCallback((type: AuditType, payload: unknown) => {
    if (ref.current) return appendAudit(ref.current.id, type, payload);
  }, []);

  const runExtraction = useCallback(async () => {
    const inc = ref.current;
    if (!inc || inc.timeline.filter((e) => e.kind !== 'system').length === 0) return;
    if (running.current) {
      rerun.current = true;
      return;
    }
    running.current = true;
    setExtraction({ state: 'running', streaming: '' });
    try {
      const res = await extractReport(inc.id, inc.timeline, inc.report, inc.allowCloudForPHI, (t) =>
        setExtraction({ state: 'running', streaming: t }),
      );
      const latest = ref.current!;
      if (res.ok) {
        const merged = mergeExtraction(latest.report, res.data, res.served);
        await commit({ ...latest, report: merged, pendingExtractionFrom: undefined });
        await audit('report.ai_update', {
          where: res.served,
          injuries: merged.injuries.length,
          interventions: merged.interventions.length,
          vitals: merged.vitals.length,
        });
        setExtraction({ state: 'idle' });
      } else {
        if (res.blocked) {
          await commit({ ...latest, pendingExtractionFrom: latest.pendingExtractionFrom ?? Math.max(0, latest.timeline.length - 1) });
        }
        setExtraction({ state: res.blocked ? 'blocked' : 'error', message: res.blocked ? `${res.reason}. ${res.fallback ?? ''}` : res.reason });
      }
    } finally {
      running.current = false;
      if (rerun.current) {
        rerun.current = false;
        setTimeout(() => void runRef.current?.(), 0);
      }
    }
  }, [audit, commit]);

  useEffect(() => {
    runRef.current = runExtraction;
  }, [runExtraction]);

  const scheduleExtraction = useCallback(() => {
    if (!opts.autoStructure) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void runExtraction(), 1200);
  }, [opts.autoStructure, runExtraction]);

  // When the on-device model becomes ready, structure anything that was queued.
  useEffect(() => {
    if (opts.onDeviceReady && incident?.pendingExtractionFrom != null) void runExtraction();
  }, [opts.onDeviceReady, incident?.pendingExtractionFrom, runExtraction]);

  const addEntry = useCallback(
    async (text: string, kind: EntryKind, speechWhere?: 'local' | 'cloud') => {
      const inc = ref.current;
      const t = text.trim();
      if (!inc || !t) return;
      const now = new Date();
      const entry: TimelineEntry = { id: newId('t'), ts: now.toISOString(), text: t, kind, speechWhere };
      let report = inc.report;
      const rules = ruleExtract(t, now);
      const ruleHit = (rules.vitals?.length ?? 0) + (rules.interventions?.length ?? 0) > 0;
      if (ruleHit) report = mergeExtraction(report, rules, 'local_rules', 'rule');
      const names = [...new Set([...(inc.knownNames ?? []), ...harvestNames(t)])];
      await commit({ ...inc, timeline: [...inc.timeline, entry], report, knownNames: names });
      await audit('timeline.entry', { id: entry.id, kind, text: t, speechWhere });
      if (ruleHit) await audit('report.ai_update', { where: 'local_rules', ...rules });
      if (kind !== 'system') scheduleExtraction();
    },
    [audit, commit, scheduleExtraction],
  );

  const editScalar = useCallback(
    async (path: ScalarPath, value: string) => {
      const inc = ref.current!;
      const prev = getScalar(inc.report, path);
      const f: Field = value.trim() ? { value: value.trim(), status: 'confirmed', source: 'user', where: 'user' } : { value: '', status: 'empty' };
      await commit({ ...inc, report: setScalar(inc.report, path, f) });
      await audit('report.user_edit', { path, from: prev.value, to: f.value });
    },
    [audit, commit],
  );

  const confirmScalar = useCallback(
    async (path: ScalarPath) => {
      const inc = ref.current!;
      const f = getScalar(inc.report, path);
      await commit({ ...inc, report: setScalar(inc.report, path, { ...f, status: 'confirmed' }) });
      await audit('report.confirm', { path, value: f.value, where: f.where });
    },
    [audit, commit],
  );

  const updateList = useCallback(
    async <K extends ListKey>(key: K, fn: (items: ReportState[K]) => ReportState[K], auditType: AuditType, payload: unknown) => {
      const inc = ref.current!;
      await commit({ ...inc, report: { ...inc.report, [key]: fn(inc.report[key]) } });
      await audit(auditType, payload);
    },
    [audit, commit],
  );

  const confirmItem = (key: ListKey, itemId: string) =>
    updateList(key, (items) => items.map((i) => (i.id === itemId ? { ...i, status: 'confirmed' } : i)) as never, 'report.confirm', { key, itemId });
  const removeItem = (key: ListKey, itemId: string) =>
    updateList(key, (items) => items.filter((i) => i.id !== itemId) as never, 'report.user_edit', { key, itemId, removed: true });
  const editItem = <T,>(key: ListKey, itemId: string, data: T) =>
    updateList(
      key,
      (items) => items.map((i) => (i.id === itemId ? { ...i, data, status: 'confirmed', source: 'user', where: 'user' } : i)) as never,
      'report.user_edit',
      { key, itemId, data },
    );
  const addItem = (key: ListKey, data: Injury | Intervention | Vitals) =>
    updateList(
      key,
      (items) => [...items, { id: newId(), data, status: 'confirmed', source: 'user', where: 'user' } as Item<typeof data>] as never,
      'report.user_edit',
      { key, added: data },
    );

  const setConsent = useCallback(
    async (patch: Partial<Pick<Incident, 'allowCloudForPHI' | 'syncPHI'>>) => {
      const inc = ref.current!;
      await commit({ ...inc, ...patch });
      await audit('consent.change', patch);
      if (patch.allowCloudForPHI && inc.pendingExtractionFrom != null) void runExtraction();
    },
    [audit, commit, runExtraction],
  );

  const openProtocol = useCallback(
    async (protocolId: string) => {
      const inc = ref.current!;
      if (!inc.protocols.some((p) => p.protocolId === protocolId)) {
        await commit({ ...inc, protocols: [...inc.protocols, { protocolId, checked: [], openedAt: new Date().toISOString() }] });
      }
      await audit('protocol.open', { protocolId });
    },
    [audit, commit],
  );

  const toggleStep = useCallback(
    async (protocolId: string, title: string, idx: number, text: string) => {
      const inc = ref.current!;
      const p = inc.protocols.find((x) => x.protocolId === protocolId);
      if (!p) return;
      const done = !p.checked.includes(idx);
      const protocols = inc.protocols.map((x) =>
        x.protocolId === protocolId ? { ...x, checked: done ? [...x.checked, idx] : x.checked.filter((c) => c !== idx) } : x,
      );
      await commit({ ...inc, protocols });
      await audit('protocol.step', { protocolId, step: idx + 1, done });
      if (done) await addEntry(`✓ [${title}] step ${idx + 1} done: ${text}`, 'protocol');
    },
    [addEntry, audit, commit],
  );

  const endIncident = useCallback(async () => {
    const inc = ref.current!;
    await commit({ ...inc, endedAt: new Date().toISOString() });
    await audit('incident.end', { durationMs: Date.now() - new Date(inc.startedAt).getTime() });
  }, [audit, commit]);

  const patch = useCallback(async (p: Partial<Incident>) => commit({ ...ref.current!, ...p }), [commit]);

  return {
    incident,
    extraction,
    addEntry,
    runExtraction,
    editScalar,
    confirmScalar,
    confirmItem,
    removeItem,
    editItem,
    addItem,
    setConsent,
    openProtocol,
    toggleStep,
    endIncident,
    patch,
    getScalar: (p: ScalarPath) => (incident ? getScalar(incident.report, p) : { value: '', status: 'empty' as const }),
  };
}

export type IncidentApi = ReturnType<typeof useIncident>;
