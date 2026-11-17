import { describe, it, expect } from 'vitest';
import { deidentify, deidentifyText, ageToRange } from '../features/sync/deidentify';

describe('deidentify', () => {
  it('coarsens ages', () => {
    expect(ageToRange(52)).toBe('50-59');
    expect(ageToRange(7)).toBe('0-9');
    expect(ageToRange(95)).toBe('90+');
    expect(deidentifyText('52 year old male')).toBe('age 50-59 male');
    expect(deidentifyText('patient is a 34-year-old hiker')).toContain('age 30-39');
    expect(deidentifyText('aged 61')).toBe('age 60-69');
  });
  it('strips names after cues and known names', () => {
    expect(deidentifyText('Her name is Jane Doe, fell on the trail')).not.toMatch(/Jane|Doe/);
    expect(deidentifyText('pt states he is called Marcus')).not.toContain('Marcus');
    expect(deidentifyText('Bob said his arm hurts', ['Bob'])).toBe('[NAME] said his arm hurts');
  });
  it('strips phone, email, dob, dates, coordinates, addresses, IDs', () => {
    const s = deidentifyText(
      'Call 408-555-0142 or a@b.com. DOB 03/14/1972. At 37.33821, -121.88633 near 123 Oak Ridge Rd. Employee ID 99812A.',
    );
    for (const bad of ['408', '555', 'a@b.com', '1972', '37.33821', '121.88633', 'Oak Ridge', '99812A']) expect(s).not.toContain(bad);
    expect(s).toContain('[PHONE]');
    expect(s).toContain('[EMAIL]');
    expect(s).toContain('[LOCATION]');
    expect(s).toContain('[ADDRESS]');
  });
  it('keeps clinically useful content', () => {
    expect(deidentifyText('Left forearm deformity, HR 110, tourniquet at 14:32')).toBe('Left forearm deformity, HR 110, tourniquet at 14:32');
  });
  it('walks objects, drops PHI keys, converts numeric age', () => {
    const out = deidentify({ name: 'Jane', age: 52, phone: '1', notes: ['his name is Sam'] }) as Record<string, unknown>;
    expect(out).toEqual({ ageRange: '50-59', notes: ['his name is [NAME]'] });
  });
});
