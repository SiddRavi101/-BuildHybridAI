import { describe, it, expect } from 'vitest';
import { InferenceMode } from 'firebase/ai';
import { decideRoute, TASK_POLICY, type RouteContext } from '../firebase/privacyRouter';

const ctx = (o: Partial<RouteContext> = {}): RouteContext => ({ onDevice: 'available', online: true, cloudConfigured: true, allowCloudForPHI: false, ...o });

describe('privacy router', () => {
  it('declares PHI tasks as ONLY_ON_DEVICE', () => {
    expect(TASK_POLICY.extract_report.mode).toBe(InferenceMode.ONLY_ON_DEVICE);
    expect(TASK_POLICY.polish_handoff.mode).toBe(InferenceMode.ONLY_ON_DEVICE);
    expect(TASK_POLICY.team_summary.deidentifyInput).toBe(true);
    expect(TASK_POLICY.training_scenario.mode).toBe(InferenceMode.PREFER_IN_CLOUD);
  });
  it('PHI runs on-device when available, even online', () => {
    const d = decideRoute('extract_report', ctx());
    expect(d).toMatchObject({ kind: 'run', mode: InferenceMode.ONLY_ON_DEVICE, expected: 'on_device' });
  });
  it('PHI is blocked without on-device model, even when online', () => {
    for (const onDevice of ['downloadable', 'unavailable', 'no-api', 'downloading'] as const) {
      expect(decideRoute('extract_report', ctx({ onDevice })).kind).toBe('blocked');
      expect(decideRoute('polish_handoff', ctx({ onDevice })).kind).toBe('blocked');
    }
  });
  it('PHI goes to cloud ONLY with explicit consent and connectivity', () => {
    expect(decideRoute('extract_report', ctx({ onDevice: 'no-api', allowCloudForPHI: true }))).toMatchObject({
      kind: 'run', mode: InferenceMode.ONLY_IN_CLOUD, consentUsed: true,
    });
    expect(decideRoute('extract_report', ctx({ onDevice: 'no-api', allowCloudForPHI: true, online: false })).kind).toBe('blocked');
    expect(decideRoute('extract_report', ctx({ onDevice: 'no-api', allowCloudForPHI: true, cloudConfigured: false })).kind).toBe('blocked');
  });
  it('consent is not used when device is available', () => {
    expect(decideRoute('extract_report', ctx({ allowCloudForPHI: true }))).toMatchObject({ mode: InferenceMode.ONLY_ON_DEVICE, consentUsed: false });
  });
  it('team summary prefers device, falls back to cloud', () => {
    expect(decideRoute('team_summary', ctx())).toMatchObject({ mode: InferenceMode.PREFER_ON_DEVICE, expected: 'on_device' });
    expect(decideRoute('team_summary', ctx({ onDevice: 'no-api' }))).toMatchObject({ expected: 'in_cloud' });
    expect(decideRoute('team_summary', ctx({ onDevice: 'no-api', online: false })).kind).toBe('blocked');
  });
  it('training prefers cloud, uses device offline', () => {
    expect(decideRoute('training_scenario', ctx())).toMatchObject({ mode: InferenceMode.PREFER_IN_CLOUD, expected: 'in_cloud' });
    expect(decideRoute('training_scenario', ctx({ online: false }))).toMatchObject({ mode: InferenceMode.ONLY_ON_DEVICE, expected: 'on_device' });
    expect(decideRoute('training_scenario', ctx({ online: false, onDevice: 'no-api' })).kind).toBe('blocked');
  });
});
