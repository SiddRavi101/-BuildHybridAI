import { describe, it, expect } from 'vitest';
import { emptyReport, parseExtraction } from '../features/report/schema';
import { mergeExtraction } from '../features/report/merge';
import { parseVitals, ruleExtract } from '../features/report/rules';
import { buildMist, docToText, countUnconfirmed } from '../features/export/mist';
import { buildOsha301 } from '../features/export/osha301';
import type { Incident } from '../features/incident/db';

const ai = {
  patient: { ageRange: '50-59', sex: 'male', chiefComplaint: 'forearm pain' },
  mechanismOfInjury: 'fell about 3 m from a ledge',
  injuries: [{ bodyRegion: 'forearm', side: 'left', type: 'deformity', notes: '' }],
  interventions: [{ type: 'Direct pressure', time: '14:30', notes: '' }],
  vitals: [{ time: '14:31', hr: 110, bp: '128/84' }],
  handoffNotes: '',
};

describe('extraction parsing', () => {
  it('parses fenced JSON and tolerates junk around it', () => {
    expect(parseExtraction('```json\n' + JSON.stringify(ai) + '\n```')?.patient.sex).toBe('male');
    expect(parseExtraction('Sure! ' + JSON.stringify(ai))?.injuries).toHaveLength(1);
  });
  it('rejects non-JSON', () => {
    expect(parseExtraction('I cannot help with that')).toBeNull();
  });
  it('coerces bad field types instead of failing', () => {
    const r = parseExtraction(JSON.stringify({ ...ai, injuries: 'none', vitals: [{ time: '1', hr: 'fast' }] }));
    expect(r?.injuries).toEqual([]);
    expect(r?.vitals[0].hr).toBeNull();
  });
});

describe('merge', () => {
  it('fills drafts from AI', () => {
    const r = mergeExtraction(emptyReport(), ai, 'on_device');
    expect(r.patient.ageRange).toMatchObject({ value: '50-59', status: 'draft', where: 'on_device' });
    expect(r.injuries[0].status).toBe('draft');
  });
  it('never overwrites confirmed or user fields', () => {
    let r = mergeExtraction(emptyReport(), ai, 'on_device');
    r = { ...r, patient: { ...r.patient, ageRange: { ...r.patient.ageRange, value: '40-49', status: 'confirmed' } } };
    r.injuries = r.injuries.map((i) => ({ ...i, status: 'confirmed' }));
    const r2 = mergeExtraction(r, { ...ai, patient: { ageRange: '60-69' }, injuries: [] }, 'on_device');
    expect(r2.patient.ageRange.value).toBe('40-49');
    expect(r2.injuries).toHaveLength(1);
  });
  it('empty AI values do not erase drafts', () => {
    const r = mergeExtraction(emptyReport(), ai, 'on_device');
    const r2 = mergeExtraction(r, { patient: { ageRange: '' }, mechanismOfInjury: '' }, 'on_device');
    expect(r2.patient.ageRange.value).toBe('50-59');
    expect(r2.mechanismOfInjury.value).toContain('fell');
  });
  it('replaces stale AI drafts but dedupes against confirmed', () => {
    let r = mergeExtraction(emptyReport(), ai, 'on_device');
    r.interventions = r.interventions.map((i) => ({ ...i, status: 'confirmed' }));
    const r2 = mergeExtraction(r, { interventions: [ai.interventions[0], { type: 'Splint applied', time: '14:40', notes: '' }] }, 'on_device');
    expect(r2.interventions.map((i) => i.data.type)).toEqual(['Direct pressure', 'Splint applied']);
  });
  it('rule-based items survive an AI merge', () => {
    let r = mergeExtraction(emptyReport(), ruleExtract('HR 120, tourniquet on', new Date(2026, 0, 1, 9, 5)), 'local_rules', 'rule');
    r = mergeExtraction(r, { vitals: [], interventions: [] }, 'on_device');
    expect(r.vitals).toHaveLength(1);
    expect(r.interventions[0].data.type).toBe('Tourniquet applied');
  });
});

describe('rules', () => {
  it('rule merges are additive across utterances', () => {
    let r = mergeExtraction(emptyReport(), ruleExtract('Pulse 112, BP 130 over 85', new Date()), 'local_rules', 'rule');
    r = mergeExtraction(r, ruleExtract('Direct pressure applied', new Date()), 'local_rules', 'rule');
    expect(r.vitals).toHaveLength(1);
    expect(r.interventions).toHaveLength(1);
  });
  it('parses spoken vitals', () => {
    expect(parseVitals('pulse is 112, BP 130 over 85, sats 94%, resp 22, GCS 15', '10:00')).toEqual({
      time: '10:00', hr: 112, bp: '130/85', spo2: 94, rr: 22, gcs: 15,
    });
    expect(parseVitals('left forearm deformity', '10:00')).toBeNull();
  });
});

describe('exports', () => {
  const inc: Incident = {
    id: 'x', title: 'DEMO-1', startedAt: new Date(2026, 10, 17, 14, 20).toISOString(), timeline: [],
    report: mergeExtraction(emptyReport(), ai, 'on_device'), allowCloudForPHI: false, syncPHI: false, protocols: [],
  };
  it('MIST contains all four sections and flags drafts', () => {
    const t = docToText(buildMist(inc));
    for (const h of ['M — Mechanism', 'I — Injuries', 'S — Signs', 'T — Treatment']) expect(t).toContain(h);
    expect(t).toContain('[unconfirmed]');
    expect(t).toContain('HR 110');
    expect(countUnconfirmed(inc.report)).toBeGreaterThan(0);
  });
  it('OSHA 301 is labelled as a draft and leaves employee info blank', () => {
    const d = buildOsha301(inc);
    expect(d.banner).toMatch(/DRAFT for employer review/);
    expect(docToText(d)).toContain('employer to complete');
  });
});
