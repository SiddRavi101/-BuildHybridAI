import type { ExtractionOutput, Vitals } from './schema';

/**
 * Deterministic, offline, no-AI structuring of the most time-critical items:
 * vitals and named interventions. Runs on every entry so the report is never
 * empty even when no model is available. It only records what was *said*.
 */

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const num = (re: RegExp, s: string) => {
  const m = s.match(re);
  return m ? Number(m[1]) : null;
};

export function parseVitals(text: string, time: string): Vitals | null {
  const s = text.toLowerCase();
  const v: Vitals = {
    time,
    hr: num(/\b(?:hr|heart rate|pulse)\s*(?:is|of|at|:)?\s*(\d{2,3})\b/, s),
    rr: num(/\b(?:rr|resp(?:irations?|iratory rate)?|breathing(?: rate)?)\s*(?:is|of|at|:)?\s*(\d{1,2})\b/, s),
    spo2: num(/\b(?:spo2|sp02|o2 sat|sats?|oxygen(?: saturation)?)\s*(?:is|of|at|:)?\s*(\d{2,3})\s*%?/, s),
    gcs: num(/\bgcs\s*(?:is|of|at|:)?\s*(\d{1,2})\b/, s),
    temp: num(/\b(?:temp(?:erature)?)\s*(?:is|of|at|:)?\s*(\d{2,3}(?:\.\d)?)\b/, s),
  };
  const bp = s.match(/\b(?:bp|blood pressure)\s*(?:is|of|at|:)?\s*(\d{2,3})\s*(?:\/|over)\s*(\d{2,3})\b/);
  if (bp) v.bp = `${bp[1]}/${bp[2]}`;
  const any = v.hr != null || v.rr != null || v.spo2 != null || v.gcs != null || v.temp != null || v.bp;
  if (!any) return null;
  // drop nulls for a clean record
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x != null)) as Vitals;
}

const INTERVENTIONS: Array<[RegExp, string]> = [
  [/\btourniquet\b/i, 'Tourniquet applied'],
  [/\bdirect pressure\b/i, 'Direct pressure'],
  [/\b(?:wound )?pack(?:ed|ing)\b/i, 'Wound packing'],
  [/\bpressure (?:dressing|bandage)\b/i, 'Pressure dressing'],
  [/\bsplint(?:ed|ing)?\b/i, 'Splint applied'],
  [/\b(?:hypothermia wrap|burrito wrap|insulat(?:ed|ion)|vapor barrier|warm(?:ed|ing)? (?:packs?|blanket))\b/i, 'Insulation / warming'],
  [/\b(?:cool(?:ed|ing)|cold water|ice packs?)\b/i, 'Active cooling'],
  [/\bcpr\b/i, 'CPR'],
  [/\brecovery position\b/i, 'Recovery position'],
];

export function parseInterventions(text: string, time: string) {
  return INTERVENTIONS.filter(([re]) => re.test(text)).map(([, type]) => ({ type, time, notes: '' }));
}

export function ruleExtract(text: string, at: Date): Partial<ExtractionOutput> {
  const time = hhmm(at);
  const vitals = parseVitals(text, time);
  return {
    vitals: vitals ? [vitals] : [],
    interventions: parseInterventions(text, time),
  };
}
