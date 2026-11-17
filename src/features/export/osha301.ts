import type { Incident } from '../incident/db';
import type { ExportDoc } from './mist';
import { countUnconfirmed } from './mist';
import { hhmm } from '../report/rules';

/**
 * Draft of the case-information portion of an OSHA Form 301 ("Injury and Illness
 * Incident Report"), pre-filled from the care record. Employee and physician
 * sections are intentionally left for the employer to complete.
 */
export function buildOsha301(inc: Incident): ExportDoc {
  const r = inc.report;
  const start = new Date(inc.startedAt);
  const injuries = r.injuries.map((i) => `${[i.data.side, i.data.bodyRegion].filter(Boolean).join(' ')} — ${i.data.type}`).join('; ');
  const blank = '______________________________ (employer to complete)';
  return {
    title: 'OSHA Form 301 — DRAFT',
    subtitle: 'Injury and Illness Incident Report · DRAFT FOR EMPLOYER REVIEW',
    banner: `DRAFT for employer review. Not an official OSHA filing. The employer must verify every field.${
      countUnconfirmed(r) ? ` ${countUnconfirmed(r)} source item(s) are unconfirmed.` : ''
    }`,
    sections: [
      {
        heading: 'Information about the employee',
        lines: [`Full name: ${blank}`, `Street / City / State / ZIP: ${blank}`, `Date of birth: ${blank}`, `Date hired: ${blank}`, `Sex: ${r.patient.sex.value || blank}`],
      },
      {
        heading: 'Information about the physician or other health care professional',
        lines: [`Name: ${blank}`, `Facility / address: ${blank}`, `Treated in an emergency room?  ☐ Yes  ☐ No`, `Hospitalized overnight as an in-patient?  ☐ Yes  ☐ No`],
      },
      {
        heading: 'Information about the case',
        lines: [
          `Case number from the Log: ${blank}`,
          `Date of injury or illness: ${start.toLocaleDateString()}`,
          `Time employee began work: ${blank}`,
          `Time of event: ${hhmm(start)} (incident start in Pinpoint)`,
          `What was the employee doing just before the incident occurred?  ${blank}`,
          `What happened? ${r.mechanismOfInjury.value || blank}`,
          `What was the injury or illness? (part of body and how affected) ${injuries || blank}`,
          `What object or substance directly harmed the employee? ${blank}`,
          `If the employee died, when did death occur? ${blank}`,
        ],
      },
      {
        heading: 'First aid recorded at scene (from Pinpoint care record)',
        lines: r.interventions.length ? r.interventions.map((i) => `${i.data.time}  ${i.data.type}`) : ['None recorded'],
      },
    ],
    footer: 'Prepared from a Pinpoint Field care record. Field names follow the public OSHA Form 301 layout; this is not the official form.',
  };
}
