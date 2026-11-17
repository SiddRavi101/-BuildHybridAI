/**
 * PRIVACY ROUTER — the core idea of Pinpoint Field.
 *
 * Privacy, not just availability, is the routing key. Every AI task declares
 * whether its input contains patient data (PHI). The router picks the Firebase
 * AI Logic InferenceMode from that, plus on-device availability, connectivity
 * and the user's explicit per-incident consent.
 *
 * | Task                | PHI | Mode               | If unavailable                              |
 * |---------------------|-----|--------------------|---------------------------------------------|
 * | extract_report      | yes | ONLY_ON_DEVICE     | queue locally, or cloud only with consent   |
 * | polish_handoff      | yes | ONLY_ON_DEVICE     | template-only export (no AI)                |
 * | team_summary        | no* | PREFER_ON_DEVICE   | cloud fallback (input de-identified first)  |
 * | training_scenario   | no  | PREFER_IN_CLOUD    | on-device fallback                          |
 *  * de-identified by the router before any model sees it.
 */
import { InferenceMode } from 'firebase/ai';

export type Task = 'extract_report' | 'polish_handoff' | 'team_summary' | 'training_scenario' | 'hello';

export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

export interface TaskPolicy {
  containsPHI: boolean;
  /** De-identify input before it reaches any model (and therefore before any cloud call). */
  deidentifyInput: boolean;
  mode: InferenceMode;
  label: string;
  fallback: string;
}

export const TASK_POLICY: Record<Task, TaskPolicy> = {
  extract_report: {
    containsPHI: true,
    deidentifyInput: false,
    mode: InferenceMode.ONLY_ON_DEVICE,
    label: 'Structure care report',
    fallback: 'Queued locally — will structure when the on-device model is ready (or allow cloud for this incident).',
  },
  polish_handoff: {
    containsPHI: true,
    deidentifyInput: false,
    mode: InferenceMode.ONLY_ON_DEVICE,
    label: 'Polish handoff wording',
    fallback: 'Template-only export (no AI).',
  },
  team_summary: {
    containsPHI: false,
    deidentifyInput: true,
    mode: InferenceMode.PREFER_ON_DEVICE,
    label: 'De-identified team summary',
    fallback: 'Cloud fallback allowed (input already de-identified).',
  },
  training_scenario: {
    containsPHI: false,
    deidentifyInput: false,
    mode: InferenceMode.PREFER_IN_CLOUD,
    label: 'Training scenario',
    fallback: 'On-device fallback.',
  },
  hello: {
    containsPHI: false,
    deidentifyInput: false,
    mode: InferenceMode.PREFER_ON_DEVICE,
    label: 'Connectivity check',
    fallback: 'Cloud fallback.',
  },
};

export interface RouteContext {
  onDevice: OnDeviceStatus;
  online: boolean;
  /** Firebase project configured (cloud reachable in principle). */
  cloudConfigured: boolean;
  /** User explicitly allowed cloud processing of patient data for THIS incident. */
  allowCloudForPHI: boolean;
}

export type RouteDecision =
  | { kind: 'run'; mode: InferenceMode; expected: 'on_device' | 'in_cloud' | 'either'; consentUsed: boolean; reason: string }
  | { kind: 'blocked'; reason: string; fallback: string };

/** Pure decision function — unit tested. No side effects, no SDK calls. */
export function decideRoute(task: Task, ctx: RouteContext): RouteDecision {
  const p = TASK_POLICY[task];
  const deviceReady = ctx.onDevice === 'available';
  const cloudReady = ctx.online && ctx.cloudConfigured;

  if (p.containsPHI) {
    if (deviceReady) {
      return { kind: 'run', mode: InferenceMode.ONLY_ON_DEVICE, expected: 'on_device', consentUsed: false, reason: 'Patient data → on-device only' };
    }
    if (ctx.allowCloudForPHI && cloudReady) {
      return {
        kind: 'run',
        mode: InferenceMode.ONLY_IN_CLOUD,
        expected: 'in_cloud',
        consentUsed: true,
        reason: 'On-device model unavailable; user explicitly allowed cloud for this incident',
      };
    }
    const why =
      ctx.onDevice === 'downloading' || ctx.onDevice === 'downloadable'
        ? 'On-device model is not downloaded yet'
        : 'On-device model unavailable in this browser';
    return { kind: 'blocked', reason: `${why}; patient data never goes to the cloud without consent`, fallback: p.fallback };
  }

  if (p.mode === InferenceMode.PREFER_ON_DEVICE) {
    if (deviceReady) return { kind: 'run', mode: p.mode, expected: 'on_device', consentUsed: false, reason: 'Prefer on-device' };
    if (cloudReady) return { kind: 'run', mode: p.mode, expected: 'in_cloud', consentUsed: false, reason: 'On-device unavailable → cloud (no PHI)' };
    return { kind: 'blocked', reason: 'Offline and no on-device model', fallback: p.fallback };
  }

  // PREFER_IN_CLOUD
  if (cloudReady) return { kind: 'run', mode: p.mode, expected: 'in_cloud', consentUsed: false, reason: 'Prefer cloud (no PHI)' };
  if (deviceReady) {
    // Offline: the SDK would only fall back after a failed fetch; go straight to device.
    return { kind: 'run', mode: InferenceMode.ONLY_ON_DEVICE, expected: 'on_device', consentUsed: false, reason: 'Offline → on-device fallback' };
  }
  return { kind: 'blocked', reason: 'Offline and no on-device model', fallback: p.fallback };
}
