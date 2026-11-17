import { z } from 'zod';

/**
 * What the model is asked to return. Kept flat and string-heavy on purpose:
 * Gemini Nano follows small, simple schemas far more reliably. Empty string = unknown.
 */
const str = z.string().catch('');
const optNum = z.number().nullable().optional().catch(null);

export const InjuryOut = z.object({
  bodyRegion: str,
  side: str.optional(),
  type: str,
  notes: str.optional(),
});
export const InterventionOut = z.object({
  type: str,
  time: str,
  notes: str.optional(),
});
export const VitalsOut = z.object({
  time: str,
  hr: optNum,
  rr: optNum,
  bp: str.optional(),
  spo2: optNum,
  gcs: optNum,
  temp: optNum,
});

export const ExtractionOutput = z.object({
  patient: z
    .object({ ageRange: str.optional(), sex: str.optional(), chiefComplaint: str.optional() })
    .catch({}),
  mechanismOfInjury: str.optional(),
  injuries: z.array(InjuryOut).catch([]),
  interventions: z.array(InterventionOut).catch([]),
  vitals: z.array(VitalsOut).catch([]),
  handoffNotes: str.optional(),
});
export type ExtractionOutput = z.infer<typeof ExtractionOutput>;

/** JSON Schema handed to both Chrome's Prompt API (responseConstraint) and Gemini (responseJsonSchema). */
export const extractionJsonSchema = {
  type: 'object',
  properties: {
    patient: {
      type: 'object',
      properties: {
        ageRange: { type: 'string', description: 'e.g. "50-59"; empty if not said' },
        sex: { type: 'string', enum: ['', 'male', 'female', 'other'] },
        chiefComplaint: { type: 'string' },
      },
      required: ['ageRange', 'sex', 'chiefComplaint'],
    },
    mechanismOfInjury: { type: 'string' },
    injuries: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          bodyRegion: { type: 'string' },
          side: { type: 'string', enum: ['', 'left', 'right', 'bilateral', 'midline'] },
          type: { type: 'string', description: 'what the responder described, e.g. laceration, deformity, burn' },
          notes: { type: 'string' },
        },
        required: ['bodyRegion', 'side', 'type', 'notes'],
      },
    },
    interventions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'care the responder said they performed' },
          time: { type: 'string', description: 'HH:MM 24h' },
          notes: { type: 'string' },
        },
        required: ['type', 'time', 'notes'],
      },
    },
    vitals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          time: { type: 'string', description: 'HH:MM 24h' },
          hr: { type: 'number' },
          rr: { type: 'number' },
          bp: { type: 'string', description: 'systolic/diastolic' },
          spo2: { type: 'number' },
          gcs: { type: 'number' },
          temp: { type: 'number' },
        },
        required: ['time'],
      },
    },
    handoffNotes: { type: 'string' },
  },
  required: ['patient', 'mechanismOfInjury', 'injuries', 'interventions', 'vitals', 'handoffNotes'],
} as const;

// ---------- App-side report state (what the user sees and confirms) ----------

export type FieldStatus = 'empty' | 'draft' | 'confirmed';
export type FieldSource = 'ai' | 'user' | 'rule';
/** Where an AI value was produced (from the SDK's response.inferenceSource). */
export type Where = 'on_device' | 'in_cloud' | 'local_rules' | 'user';

export interface Field {
  value: string;
  status: FieldStatus;
  source?: FieldSource;
  where?: Where;
}

export interface Item<T> {
  id: string;
  data: T;
  status: Exclude<FieldStatus, 'empty'>;
  source: FieldSource;
  where?: Where;
}

export type Injury = z.infer<typeof InjuryOut>;
export type Intervention = z.infer<typeof InterventionOut> & { protocolId?: string };
export type Vitals = z.infer<typeof VitalsOut>;

export interface ReportState {
  patient: { ageRange: Field; sex: Field; chiefComplaint: Field };
  mechanismOfInjury: Field;
  handoffNotes: Field;
  injuries: Item<Injury>[];
  interventions: Item<Intervention>[];
  vitals: Item<Vitals>[];
  lastExtractedAt?: string;
  lastExtractedWhere?: Where;
}

export const emptyField = (): Field => ({ value: '', status: 'empty' });

export function emptyReport(): ReportState {
  return {
    patient: { ageRange: emptyField(), sex: emptyField(), chiefComplaint: emptyField() },
    mechanismOfInjury: emptyField(),
    handoffNotes: emptyField(),
    injuries: [],
    interventions: [],
    vitals: [],
  };
}

/** Parse raw model text into a validated extraction, tolerating ```json fences. */
export function parseExtraction(raw: string): ExtractionOutput | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      json = JSON.parse(m[0]);
    } catch {
      return null;
    }
  }
  const res = ExtractionOutput.safeParse(json);
  return res.success ? res.data : null;
}
