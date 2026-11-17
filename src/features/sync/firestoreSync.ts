import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { getFirebase, ensureSignedIn } from '../../firebase/init';
import type { Incident } from '../incident/db';
import { appendAudit, saveIncident, getIncident } from '../incident/db';
import { deidentifyText } from './deidentify';

/**
 * De-identified projection that is safe to leave the device by default.
 * Follows a conservative, Safe-Harbor-style approach: no free-text transcript,
 * dates reduced to year + duration, every string passed through deidentify().
 */
export function deidentifiedRecord(inc: Incident) {
  const r = inc.report;
  const start = new Date(inc.startedAt);
  const end = inc.endedAt ? new Date(inc.endedAt) : undefined;
  const names = inc.knownNames ?? [];
  const t = (s: string) => deidentifyText(s, names);
  return {
    schema: 'pinpoint.deidentified.v1',
    year: start.getFullYear(),
    durationMinutes: end ? Math.round((end.getTime() - start.getTime()) / 60000) : null,
    patient: { ageRange: r.patient.ageRange.value || null, sex: r.patient.sex.value || null, chiefComplaint: t(r.patient.chiefComplaint.value) || null },
    mechanismOfInjury: t(r.mechanismOfInjury.value) || null,
    injuries: r.injuries.map((i) => ({ bodyRegion: i.data.bodyRegion, side: i.data.side ?? '', type: t(i.data.type), confirmed: i.status === 'confirmed' })),
    interventions: r.interventions.map((i) => ({ type: t(i.data.type), confirmed: i.status === 'confirmed' })),
    vitalsCount: r.vitals.length,
    protocols: inc.protocols.map((p) => p.protocolId),
    summary: inc.summary ? t(inc.summary.text) : null,
    containsPHI: false,
  };
}

export function identifiableRecord(inc: Incident) {
  // Explicit per-incident opt-in only. Still strip the de-identification helper list.
  const { knownNames: _k, ...rest } = inc;
  return { schema: 'pinpoint.full.v1', ...rest, containsPHI: true };
}

/**
 * Write the incident to Firestore. With persistent local cache, this write is
 * queued in IndexedDB while offline and flushed automatically when back online;
 * the returned promise resolves when the server acknowledges it.
 */
export async function syncIncident(incidentId: string, onState?: (s: NonNullable<Incident['sync']>) => void): Promise<void> {
  const fb = getFirebase();
  const inc = await getIncident(incidentId);
  if (!fb || !inc) return;
  const setState = async (s: NonNullable<Incident['sync']>) => {
    const latest = await getIncident(incidentId);
    if (latest) await saveIncident({ ...latest, sync: s });
    onState?.(s);
  };
  const user = await ensureSignedIn();
  if (!user) {
    await setState({ state: 'pending', error: 'Not signed in yet (offline?) — will retry when online.' });
    return;
  }
  const payload = inc.syncPHI ? identifiableRecord(inc) : deidentifiedRecord(inc);
  await appendAudit(incidentId, 'sync', { mode: inc.syncPHI ? 'identifiable (opt-in)' : 'de-identified', online: navigator.onLine });
  await setState({ state: 'pending' });
  try {
    await setDoc(doc(fb.db, 'users', user.uid, 'incidents', incidentId), {
      ...JSON.parse(JSON.stringify(payload)),
      ownerUid: user.uid,
      updatedAt: serverTimestamp(),
    });
    await setState({ state: 'synced', at: new Date().toISOString() });
  } catch (e) {
    await setState({ state: 'error', error: e instanceof Error ? e.message : String(e) });
  }
}
