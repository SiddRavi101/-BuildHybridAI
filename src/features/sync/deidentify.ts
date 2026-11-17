/**
 * De-identification for anything that leaves the device by default
 * (Firestore sync, cloud summaries). Conservative by design: when in doubt, redact.
 *
 * Removes: personal names (after common cues + title-cased name pairs), dates of
 * birth / full dates, phone numbers, emails, GPS coordinates, street addresses,
 * ID/record numbers. Coarsens exact ages to 10-year ranges.
 */

export function ageToRange(age: number): string {
  if (!Number.isFinite(age) || age < 0) return 'unknown';
  if (age >= 90) return '90+';
  const lo = Math.floor(age / 10) * 10;
  return `${lo}-${lo + 9}`;
}

const NAME_CUE =
  /\b(?:(?:his|her|their|patient'?s?|pt'?s?)\s+name\s+is|name\s*[:=]|named|called|i'?m|this is|mr\.?|mrs\.?|ms\.?|miss|dr\.?)\s+([a-z][a-z'-]+(?:\s+[a-z][a-z'-]+)?)/gi;

/** Redact only the capitalised words of a cue match ("named Bob fell" → "named [NAME] fell"). */
function redactCapitalised(match: string, captured: string): string {
  const words = captured.split(/\s+/);
  let n = 0;
  while (n < words.length && /^[A-Z]/.test(words[n])) n++;
  if (n === 0) return match;
  return match.replace(captured, ['[NAME]', ...words.slice(n)].join(' '));
}

const RULES: Array<[RegExp, string | ((...m: string[]) => string)]> = [
  // emails
  [/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, '[EMAIL]'],
  // GPS coordinates e.g. 37.3382, -121.8863
  [/-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g, '[LOCATION]'],
  // date of birth cue
  [/\b(?:dob|d\.o\.b\.?|date of birth|born(?: on)?)\s*[:\-]?\s*[\w\s,/.-]{4,20}?\d{2,4}\b/gi, '[DOB]'],
  // numeric dates 03/14/1972, 2024-03-14
  [/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g, '[DATE]'],
  [/\b\d{4}-\d{2}-\d{2}\b/g, '[DATE]'],
  // phone numbers (before generic numbers)
  [/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, '[PHONE]'],
  // SSN / record / ID numbers
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[ID]'],
  [/\b(?:mrn|ssn|id|badge|employee(?: id)?|license)\s*(?:#|no\.?|number)?\s*[:\-]?\s*[A-Z0-9-]{4,}\b/gi, '[ID]'],
  // street addresses: "123 Oak Ridge Rd"
  [
    /\b\d{1,6}\s+(?:[A-Z][a-z]+\s){1,3}(?:St|Street|Rd|Road|Ave|Avenue|Blvd|Ln|Lane|Dr|Drive|Ct|Court|Way|Hwy|Highway|Trail|Pl)\b\.?/g,
    '[ADDRESS]',
  ],
  // ages: "52 year old", "52-year-old", "age 52", "aged 52", "52 yo"
  [
    /\b(\d{1,3})(?:\s*|-)(?:years?|yrs?|y\/o|yo)(?:[\s-]old)?\b/gi,
    (_m: string, a: string) => `age ${ageToRange(Number(a))}`,
  ],
  [/\b(?:age|aged)\s*[:]?\s*(\d{1,3})\b(?![-\d])/gi, (_m: string, a: string) => `age ${ageToRange(Number(a))}`],
];

export function deidentifyText(input: string, knownNames: string[] = []): string {
  let out = input;
  for (const name of knownNames.filter((n) => n.trim().length > 1)) {
    const escaped = name.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '[NAME]');
  }
  out = out.replace(NAME_CUE, redactCapitalised);
  for (const [re, rep] of RULES) {
    out = out.replace(re, rep as never);
  }
  return out;
}

/** Recursively de-identify every string in a JSON-like value. Drops keys that are PHI by name. */
export function deidentify<T>(value: T, knownNames: string[] = []): T {
  const PHI_KEYS = new Set(['name', 'patientName', 'dob', 'dateOfBirth', 'phone', 'address', 'email', 'gps', 'coordinates', 'exactLocation']);
  const walk = (v: unknown): unknown => {
    if (typeof v === 'string') return deidentifyText(v, knownNames);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        if (PHI_KEYS.has(k)) continue;
        if (k === 'age' && typeof val === 'number') {
          out.ageRange = ageToRange(val);
          continue;
        }
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(value) as T;
}
