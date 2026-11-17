import type { OnDeviceStatus } from './privacyRouter';

/**
 * Chrome's built-in Prompt API (Gemini Nano) exposes a global `LanguageModel`.
 * The Firebase AI Logic SDK uses it under the hood; we query it directly so the
 * Privacy Router can decide *before* calling, and so the UI can show status
 * and trigger the (large) one-time download.
 */
interface LanguageModelStatic {
  availability(options?: unknown): Promise<'available' | 'downloadable' | 'downloading' | 'unavailable'>;
}

export const ON_DEVICE_CREATE_OPTIONS = {
  expectedInputs: [{ type: 'text' as const, languages: ['en'] }],
  expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
};

export async function getOnDeviceStatus(): Promise<OnDeviceStatus> {
  const LM = (globalThis as unknown as { LanguageModel?: LanguageModelStatic }).LanguageModel;
  if (!LM?.availability) return 'no-api';
  try {
    return await LM.availability(ON_DEVICE_CREATE_OPTIONS);
  } catch {
    return 'unavailable';
  }
}

export function onDeviceStatusLabel(s: OnDeviceStatus): string {
  switch (s) {
    case 'available':
      return 'Gemini Nano ready';
    case 'downloadable':
      return 'Gemini Nano not downloaded';
    case 'downloading':
      return 'Gemini Nano downloading…';
    case 'unavailable':
      return 'On-device model unsupported on this device';
    case 'no-api':
      return 'Prompt API not enabled (see setup)';
  }
}
