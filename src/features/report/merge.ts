import type { ExtractionOutput, Field, Item, ReportState, Where, FieldSource } from './schema';

let counter = 0;
export const newId = (p = 'i') => `${p}_${Date.now().toString(36)}_${(counter++).toString(36)}`;

const norm = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

function mergeField(cur: Field, incoming: string | undefined, where: Where, source: FieldSource): Field {
  if (cur.status === 'confirmed' || cur.source === 'user') return cur; // never overwrite human input
  const v = (incoming ?? '').trim();
  if (!v) return cur; // model saying "unknown" never erases a draft
  return { value: v, status: 'draft', source, where };
}

/**
 * Merge an array: keep every confirmed or user-authored item, replace the previous
 * AI drafts with the model's latest view, and drop AI items that duplicate a kept item.
 */
function mergeItems<T>(cur: Item<T>[], incoming: T[], keyOf: (t: T) => string, where: Where, source: FieldSource): Item<T>[] {
  // Local rules see one utterance at a time → additive. The model sees the whole window → replaces its own drafts.
  const kept = source === 'rule' ? cur : cur.filter((i) => i.status === 'confirmed' || i.source !== source);
  const keys = new Set(kept.map((i) => keyOf(i.data)));
  const fresh: Item<T>[] = [];
  for (const data of incoming) {
    const k = keyOf(data);
    if (!k.replace(/\|/g, '').trim() || keys.has(k)) continue;
    keys.add(k);
    // Re-use the id of a previous draft for the same thing so React keys stay stable.
    const prev = cur.find((i) => i.status === 'draft' && i.source === source && keyOf(i.data) === k);
    fresh.push({ id: prev?.id ?? newId(), data, status: 'draft', source, where });
  }
  return [...kept, ...fresh];
}

export const injuryKey = (i: { bodyRegion: string; side?: string; type: string }) =>
  [norm(i.bodyRegion), norm(i.side), norm(i.type)].join('|');
export const interventionKey = (i: { type: string; time: string }) => [norm(i.type), norm(i.time)].join('|');
export const vitalsKey = (v: { time: string; hr?: number | null; bp?: string; spo2?: number | null }) =>
  [norm(v.time), v.hr ?? '', norm(v.bp), v.spo2 ?? ''].join('|');

export function mergeExtraction(
  cur: ReportState,
  out: Partial<ExtractionOutput>,
  where: Where,
  source: FieldSource = 'ai',
  now = new Date(),
): ReportState {
  return {
    ...cur,
    patient: {
      ageRange: mergeField(cur.patient.ageRange, out.patient?.ageRange, where, source),
      sex: mergeField(cur.patient.sex, out.patient?.sex, where, source),
      chiefComplaint: mergeField(cur.patient.chiefComplaint, out.patient?.chiefComplaint, where, source),
    },
    mechanismOfInjury: mergeField(cur.mechanismOfInjury, out.mechanismOfInjury, where, source),
    handoffNotes: mergeField(cur.handoffNotes, out.handoffNotes, where, source),
    injuries: out.injuries ? mergeItems(cur.injuries, out.injuries, injuryKey, where, source) : cur.injuries,
    interventions: out.interventions
      ? mergeItems(cur.interventions, out.interventions, interventionKey, where, source)
      : cur.interventions,
    vitals: out.vitals ? mergeItems(cur.vitals, out.vitals, vitalsKey, where, source) : cur.vitals,
    lastExtractedAt: now.toISOString(),
    lastExtractedWhere: where,
  };
}

/** Compact, confirmed-first summary of the current report to send back to the model. */
export function reportForPrompt(r: ReportState) {
  const f = (x: Field) => (x.value ? `${x.value}${x.status === 'confirmed' ? ' (confirmed)' : ''}` : '');
  return {
    patient: { ageRange: f(r.patient.ageRange), sex: f(r.patient.sex), chiefComplaint: f(r.patient.chiefComplaint) },
    mechanismOfInjury: f(r.mechanismOfInjury),
    injuries: r.injuries.map((i) => i.data),
    interventions: r.interventions.map((i) => i.data),
    vitals: r.vitals.map((i) => i.data),
    handoffNotes: f(r.handoffNotes),
  };
}
