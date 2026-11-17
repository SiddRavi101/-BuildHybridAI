import { privacyRouter } from '../../firebase/runTask';
import type { Incident } from '../incident/db';
import { docToText, type ExportDoc } from './mist';

const SYSTEM = `You rewrite a first-responder handoff into one clear, concise radio-style paragraph for arriving EMS.
Use ONLY facts in the text. Keep "[unconfirmed]" markers. No diagnosis, no treatment advice, no new facts.`;

/**
 * Optional wording polish for the handoff. Contains PHI → ONLY_ON_DEVICE.
 * If the router blocks it, the caller simply uses the template text.
 */
export async function polishHandoff(inc: Incident, doc: ExportDoc, onChunk?: (t: string) => void) {
  return privacyRouter.run('polish_handoff', {
    system: SYSTEM,
    prompt: docToText(doc),
    incidentId: inc.id,
    allowCloudForPHI: inc.allowCloudForPHI,
    temperature: 0.2,
    onChunk,
  });
}
