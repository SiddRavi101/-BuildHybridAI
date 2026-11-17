import { privacyRouter } from '../../firebase/runTask';
import type { Incident } from '../incident/db';
import { deidentify } from './deidentify';
import { reportForPrompt } from '../report/merge';

const SYSTEM = `You write short, de-identified incident summaries for a search-and-rescue team lead.
3-5 sentences: what happened, what was observed, what care was recorded, time from start to handoff.
No names, no exact locations, no diagnosis, no treatment advice. Only restate what is in the record.`;

export async function summarizeIncident(inc: Incident, onChunk?: (t: string) => void) {
  // De-identify up front (the router de-identifies the prompt text again — belt and braces).
  const record = deidentify(
    {
      started: inc.startedAt,
      ended: inc.endedAt,
      report: reportForPrompt(inc.report),
      protocols: inc.protocols.map((p) => p.protocolId),
    },
    inc.knownNames,
  );
  return privacyRouter.run('team_summary', {
    system: SYSTEM,
    prompt: `INCIDENT RECORD (de-identified):\n${JSON.stringify(record)}\n\nWrite the summary.`,
    incidentId: inc.id,
    knownNames: inc.knownNames,
    temperature: 0.3,
    onChunk,
  });
}
