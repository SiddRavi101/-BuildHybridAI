import { InferenceMode, type GenerateContentResult } from 'firebase/ai';
import { buildModel } from './ai';
import { decideRoute, TASK_POLICY, type RouteContext, type Task } from './privacyRouter';
import { isFirebaseConfigured } from './init';
import { getOnDeviceStatus } from './onDevice';
import { deidentifyText } from '../features/sync/deidentify';
import { appendAudit } from '../features/incident/db';

export type Served = 'on_device' | 'in_cloud';

export interface RunInput {
  system: string;
  prompt: string;
  jsonSchema?: object;
  temperature?: number;
  /** Incident to log the routing decision to (audit chain). */
  incidentId?: string;
  allowCloudForPHI?: boolean;
  knownNames?: string[];
  onChunk?: (textSoFar: string) => void;
}

export type RunResult =
  | { ok: true; text: string; served: Served; modeRequested: InferenceMode; reason: string }
  | { ok: false; blocked: boolean; reason: string; fallback?: string };

export async function currentRouteContext(allowCloudForPHI = false): Promise<RouteContext> {
  return {
    onDevice: await getOnDeviceStatus(),
    online: navigator.onLine,
    cloudConfigured: isFirebaseConfigured,
    allowCloudForPHI,
  };
}

/**
 * privacyRouter.run(task, input): the ONLY way the app calls a model.
 * Decides the InferenceMode, enforces de-identification, runs via Firebase AI
 * Logic, reads the SDK's `inferenceSource` so the badge is truthful, and logs
 * {task, modeRequested, modeUsed, timestamp} to the hash-chained audit log.
 */
async function run(task: Task, input: RunInput): Promise<RunResult> {
  const policy = TASK_POLICY[task];
  const ctx = await currentRouteContext(!!input.allowCloudForPHI);
  const decision = decideRoute(task, ctx);
  const log = (payload: Record<string, unknown>) =>
    input.incidentId ? appendAudit(input.incidentId, 'ai.route', { task, ...payload }).catch(() => undefined) : undefined;

  if (decision.kind === 'blocked') {
    await log({ modeRequested: policy.mode, modeUsed: 'none', blocked: true, reason: decision.reason, ctx });
    return { ok: false, blocked: true, reason: decision.reason, fallback: decision.fallback };
  }

  const prompt = policy.deidentifyInput ? deidentifyText(input.prompt, input.knownNames) : input.prompt;

  try {
    const model = buildModel({ mode: decision.mode, system: input.system, jsonSchema: input.jsonSchema, temperature: input.temperature });
    let text = '';
    let served: Served | undefined;
    if (input.onChunk) {
      const { stream, response } = await model.generateContentStream(prompt);
      for await (const chunk of stream) {
        text += chunk.text();
        input.onChunk(text);
      }
      const final = await response;
      served = final.inferenceSource as Served | undefined;
      if (!text) text = final.text();
    } else {
      const res: GenerateContentResult = await model.generateContent(prompt);
      text = res.response.text();
      served = res.response.inferenceSource as Served | undefined;
    }
    // If the SDK didn't report a source, derive it from the mode we forced.
    served ??= decision.expected === 'either' ? 'in_cloud' : decision.expected;

    // Defence in depth: a PHI task must never be served in the cloud without consent.
    if (policy.containsPHI && served === 'in_cloud' && !decision.consentUsed) {
      await log({ modeRequested: decision.mode, modeUsed: served, violation: true });
      return { ok: false, blocked: true, reason: 'Refused: PHI result came from cloud without consent' };
    }

    await log({ modeRequested: decision.mode, modeUsed: served, consentUsed: decision.consentUsed, reason: decision.reason });
    return { ok: true, text, served, modeRequested: decision.mode, reason: decision.reason };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log({ modeRequested: decision.mode, modeUsed: 'error', error: msg });
    return { ok: false, blocked: false, reason: msg, fallback: policy.fallback };
  }
}

export const privacyRouter = { run };
