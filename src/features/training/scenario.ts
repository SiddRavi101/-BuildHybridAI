import { z } from 'zod';
import { privacyRouter, type Served } from '../../firebase/runTask';

export const ScenarioSchema = z.object({
  title: z.string(),
  setting: z.string(),
  patient: z.string(),
  mechanism: z.string(),
  presentation: z.array(z.string()),
  vitalsProgression: z.array(z.object({ minute: z.number(), vitals: z.string() })),
  complications: z.array(z.string()),
  debriefQuestions: z.array(z.string()),
});
export type Scenario = z.infer<typeof ScenarioSchema>;

export const scenarioJsonSchema = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    setting: { type: 'string' },
    patient: { type: 'string', description: 'fictional patient, e.g. "hiker, 52, male"' },
    mechanism: { type: 'string' },
    presentation: { type: 'array', items: { type: 'string' } },
    vitalsProgression: {
      type: 'array',
      items: { type: 'object', properties: { minute: { type: 'number' }, vitals: { type: 'string' } }, required: ['minute', 'vitals'] },
    },
    complications: { type: 'array', items: { type: 'string' } },
    debriefQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'setting', 'patient', 'mechanism', 'presentation', 'vitalsProgression', 'complications', 'debriefQuestions'],
};

const SYSTEM = `You write realistic, FICTIONAL training drill scenarios for volunteer search-and-rescue teams and remote work crews.
Never use real people or real incidents. The scenario describes what the "patient" actor presents with and how vitals change over time,
so an instructor can run a drill. Debrief questions should reference the team's own protocols (e.g. "Which protocol card applied and why?")
rather than prescribing treatment.`;

export async function generateScenario(opts: { environment: string; focus: string; difficulty: string }, onChunk?: (t: string) => void) {
  const res = await privacyRouter.run('training_scenario', {
    system: SYSTEM,
    prompt: `Create one drill scenario. Environment: ${opts.environment}. Focus: ${opts.focus}. Difficulty: ${opts.difficulty}. Return JSON.`,
    jsonSchema: scenarioJsonSchema,
    temperature: 0.9,
    onChunk,
  });
  if (!res.ok) return res;
  try {
    const parsed = ScenarioSchema.safeParse(JSON.parse(res.text.replace(/^```(?:json)?|```$/g, '')));
    if (parsed.success) return { ok: true as const, scenario: parsed.data, served: res.served as Served };
  } catch {
    /* fall through */
  }
  return { ok: false as const, blocked: false, reason: 'Scenario output was not valid JSON — try again.' };
}
