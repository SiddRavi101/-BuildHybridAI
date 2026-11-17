import { getAI, getGenerativeModel, GoogleAIBackend, InferenceMode, type AI, type GenerativeModel } from 'firebase/ai';
import { getFirebase } from './init';
import { ON_DEVICE_CREATE_OPTIONS } from './onDevice';

/** Cloud model used when a request is served in the cloud (Gemini Developer API). */
export const CLOUD_MODEL = import.meta.env.VITE_CLOUD_MODEL || 'gemini-3.5-flash-lite';

let ai: AI | null = null;
export function getAIInstance(): AI | null {
  if (ai) return ai;
  const fb = getFirebase();
  if (!fb) return null;
  ai = getAI(fb.app, { backend: new GoogleAIBackend() });
  return ai;
}

export interface ModelSpec {
  mode: InferenceMode;
  system: string;
  /** JSON Schema for structured output — applied on BOTH backends. */
  jsonSchema?: object;
  temperature?: number;
}

/**
 * Build a hybrid model. Note from the SDK source (v13.4):
 *  - on-device sessions ignore `systemInstruction`, so the system prompt is passed
 *    as an initial `system` prompt in `onDeviceParams.createOptions`;
 *  - on-device structured output uses `promptOptions.responseConstraint`;
 *  - cloud structured output uses `generationConfig.responseJsonSchema`.
 * Call this after a user gesture (the SDK may start a model download).
 */
export function buildModel(spec: ModelSpec): GenerativeModel {
  const instance = getAIInstance();
  if (!instance) throw new Error('Firebase is not configured');
  return getGenerativeModel(instance, {
    mode: spec.mode,
    onDeviceParams: {
      createOptions: {
        ...ON_DEVICE_CREATE_OPTIONS,
        initialPrompts: [{ role: 'system', content: [{ type: 'text', value: spec.system }] }],
      },
      promptOptions: spec.jsonSchema ? { responseConstraint: spec.jsonSchema } : undefined,
    },
    inCloudParams: {
      model: CLOUD_MODEL,
      systemInstruction: spec.system,
      generationConfig: {
        temperature: spec.temperature ?? 0.2,
        ...(spec.jsonSchema
          ? { responseMimeType: 'application/json', responseJsonSchema: spec.jsonSchema as Record<string, unknown> }
          : {}),
      },
    },
  });
}

/** Trigger / monitor the one-time Gemini Nano download via the SDK. */
export async function downloadOnDeviceModel(onProgress: (p: number) => void): Promise<void> {
  const model = buildModel({ mode: InferenceMode.PREFER_ON_DEVICE, system: 'You are a helpful assistant.' });
  await model.initializeDeviceModel(onProgress);
}
