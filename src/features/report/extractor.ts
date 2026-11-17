import { privacyRouter, type Served } from '../../firebase/runTask';
import type { TimelineEntry } from '../incident/db';
import { extractionJsonSchema, parseExtraction, type ExtractionOutput, type ReportState } from './schema';
import { reportForPrompt } from './merge';
import { hhmm } from './rules';

export const EXTRACTION_SYSTEM = `You are a medical scribe for a wilderness first responder.
You ONLY record what the responder said. You never diagnose, never suggest treatment, never guess.
Convert the responder's spoken notes into the JSON schema.
Rules:
- Use "" for anything not explicitly stated. Do not invent vitals, ages or injuries.
- injuries: what the responder observed (e.g. "laceration", "deformity", "swelling", "burn"), not a diagnosis.
- interventions: only care the responder says was DONE, with the time it was said (HH:MM).
- vitals: one object per set of measurements, with the time they were said.
- ageRange: a 10-year range like "50-59" if an age is mentioned.
- Keep items already present in CURRENT REPORT unless the responder corrected them.`;

/** Last N transcript lines, with clock times, newest last. */
export function transcriptWindow(timeline: TimelineEntry[], n = 25): string {
  return timeline
    .filter((e) => e.kind !== 'system')
    .slice(-n)
    .map((e) => `[${hhmm(new Date(e.ts))}] ${e.text}`)
    .join('\n');
}

export function buildExtractionPrompt(timeline: TimelineEntry[], report: ReportState): string {
  return `CURRENT REPORT:\n${JSON.stringify(reportForPrompt(report))}\n\nRESPONDER NOTES:\n${transcriptWindow(timeline)}\n\nReturn the full updated report as JSON.`;
}

export type ExtractResult =
  | { ok: true; data: ExtractionOutput; served: Served }
  | { ok: false; blocked: boolean; reason: string; fallback?: string };

/** Ask the model; validate with zod; on invalid output retry once; else signal "keep previous". */
export async function extractReport(
  incidentId: string,
  timeline: TimelineEntry[],
  report: ReportState,
  allowCloudForPHI: boolean,
  onChunk?: (t: string) => void,
): Promise<ExtractResult> {
  const prompt = buildExtractionPrompt(timeline, report);
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await privacyRouter.run('extract_report', {
      system: EXTRACTION_SYSTEM,
      prompt: attempt === 0 ? prompt : prompt + '\n\nYour previous answer was not valid JSON for the schema. Return ONLY valid JSON.',
      jsonSchema: extractionJsonSchema,
      temperature: 0,
      incidentId,
      allowCloudForPHI,
      onChunk,
    });
    if (!res.ok) return res;
    const data = parseExtraction(res.text);
    if (data) return { ok: true, data, served: res.served };
  }
  return { ok: false, blocked: false, reason: 'Model returned invalid JSON twice — kept the previous report.' };
}
