import { describe, it, expect } from 'vitest';
import { createEntry, verifyChain, canonicalJSON, GENESIS_HASH, type AuditEntry } from '../features/audit/hashChain';

async function chain(n: number) {
  const out: AuditEntry[] = [];
  for (let i = 0; i < n; i++) out.push(await createEntry(out.at(-1), 'inc1', 'timeline.entry', { text: `entry ${i}` }, new Date(2026, 0, 1, 10, i)));
  return out;
}

describe('hash chain', () => {
  it('canonical JSON is key-order independent', () => {
    expect(canonicalJSON({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } })).toBe(canonicalJSON({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });
  it('links entries and starts from genesis', async () => {
    const c = await chain(3);
    expect(c[0].prevHash).toBe(GENESIS_HASH);
    expect(c[1].prevHash).toBe(c[0].hash);
    expect(c[2].seq).toBe(2);
    expect(c[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });
  it('verifies an intact chain', async () => {
    expect(await verifyChain(await chain(5))).toEqual({ ok: true, checked: 5 });
  });
  it('detects modified payload', async () => {
    const c = await chain(5);
    c[2] = { ...c[2], payload: { text: 'edited' } };
    const r = await verifyChain(c);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
  });
  it('detects deletion', async () => {
    const c = await chain(5);
    c.splice(3, 1);
    expect((await verifyChain(c)).ok).toBe(false);
  });
  it('detects a recomputed hash that no longer links', async () => {
    const c = await chain(4);
    const forged = await createEntry(c[0], 'inc1', 'timeline.entry', { text: 'forged' });
    c[1] = forged;
    const r = await verifyChain(c);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(2);
  });
});
