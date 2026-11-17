import { useMemo, useState } from 'react';
import type { IncidentApi } from '../incident/useIncident';
import { appendAudit } from '../incident/db';
import { buildMist, docToText, type ExportDoc } from './mist';
import { buildOsha301 } from './osha301';
import { docToPdf, downloadBlob } from './pdf';
import { polishHandoff } from './polish';
import { summarizeIncident } from '../sync/summary';
import { syncIncident, deidentifiedRecord } from '../sync/firestoreSync';
import { ModeBadge } from '../../ui/ModeBadge';
import { useStatus } from '../../ui/status';

function DocPreview({ doc, testId }: { doc: ExportDoc; testId: string }) {
  return (
    <article className="doc" data-testid={testId}>
      <h3>{doc.title}</h3>
      <p className="doc-sub">{doc.subtitle}</p>
      <p className="doc-banner">{doc.banner}</p>
      {doc.sections.map((s) => (
        <section key={s.heading}>
          <h4>{s.heading}</h4>
          <ul>
            {s.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      ))}
      <p className="fineprint">{doc.footer}</p>
    </article>
  );
}

export function HandoffView({ api }: { api: IncidentApi }) {
  const inc = api.incident!;
  const status = useStatus();
  const mist = useMemo(() => buildMist(inc), [inc]);
  const osha = useMemo(() => buildOsha301(inc), [inc]);
  const [tab, setTab] = useState<'mist' | 'osha' | 'json'>('mist');
  const [polished, setPolished] = useState<{ text: string; where: 'on_device' | 'in_cloud' } | null>(null);
  const [polishMsg, setPolishMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [summaryMsg, setSummaryMsg] = useState<string | null>(null);
  const [showDeid, setShowDeid] = useState(false);
  const name = (kind: string, ext: string) => `${inc.title}-${kind}.${ext}`;

  const exportPdf = async (doc: ExportDoc, kind: string) => {
    downloadBlob(await docToPdf(doc), name(kind, 'pdf'));
    await appendAudit(inc.id, 'export', { kind, format: 'pdf' });
  };
  const exportBoth = async () => {
    await exportPdf(mist, 'MIST');
    await exportPdf(osha, 'OSHA301-DRAFT');
  };
  const exportJson = async () => {
    const { knownNames: _k, ...rest } = inc;
    downloadBlob(new Blob([JSON.stringify(rest, null, 2)], { type: 'application/json' }), name('record', 'json'));
    await appendAudit(inc.id, 'export', { kind: 'record', format: 'json' });
  };

  const polish = async () => {
    setBusy('polish');
    setPolishMsg(null);
    const res = await polishHandoff(inc, mist, (t) => setPolished({ text: t, where: 'on_device' }));
    if (res.ok) setPolished({ text: res.text, where: res.served });
    else {
      setPolished(null);
      setPolishMsg(`${res.reason}. Using the template handoff (no AI).`);
    }
    setBusy(null);
  };

  const summarize = async () => {
    setBusy('summary');
    setSummaryMsg(null);
    const res = await summarizeIncident(inc);
    if (res.ok) await api.patch({ summary: { text: res.text, where: res.served, at: new Date().toISOString() } });
    else setSummaryMsg(res.reason);
    setBusy(null);
  };

  const sync = async () => {
    setBusy('sync');
    await syncIncident(inc.id, (s) => api.patch({ sync: s }));
    setBusy(null);
  };

  return (
    <div className="handoff">
      <section className="panel">
        <div className="report-head">
          <h2>Handoff</h2>
          {!inc.endedAt && (
            <button className="btn" onClick={api.endIncident}>
              Mark EMS handoff time
            </button>
          )}
        </div>
        <div className="row">
          <button className="btn btn-primary btn-big" onClick={exportBoth} data-testid="export-both">
            ⬇ MIST + OSHA 301 draft (PDF)
          </button>
          <button className="btn" onClick={() => exportPdf(mist, 'MIST')}>
            MIST PDF
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn" onClick={exportJson}>
            JSON
          </button>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(polished?.text ?? docToText(mist))}>
            Copy text
          </button>
        </div>
        <div className="tabs" role="tablist">
          {(['mist', 'osha', 'json'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'tab tab-on' : 'tab'} onClick={() => setTab(t)}>
              {t === 'mist' ? 'MIST handoff' : t === 'osha' ? 'OSHA 301 draft' : 'JSON'}
            </button>
          ))}
        </div>
        <div className="printable">
          {tab === 'mist' && <DocPreview doc={mist} testId="mist-preview" />}
          {tab === 'osha' && <DocPreview doc={osha} testId="osha-preview" />}
          {tab === 'json' && <pre className="json">{JSON.stringify({ ...inc, knownNames: undefined }, null, 2)}</pre>}
        </div>
      </section>

      <div className="handoff-side">
      <section className="panel">
        <h3>Radio-style handoff wording</h3>
        <p className="hint">Optional. Contains patient data → runs <strong>only on-device</strong>; otherwise the template above is used.</p>
        <button className="btn" onClick={polish} disabled={busy === 'polish'}>
          {busy === 'polish' ? 'Writing…' : '✨ Polish wording'}
        </button>
        {polished && (
          <div className="ai-block">
            <ModeBadge where={polished.where} />
            <p>{polished.text}</p>
            <small>Draft — read it back before using it.</small>
          </div>
        )}
        {polishMsg && <p className="hint warn">{polishMsg}</p>}
      </section>

      <section className="panel">
        <h3>Team lead summary (de-identified)</h3>
        <p className="hint">Names, dates, locations and contact details are stripped first, so this may use the cloud if no on-device model is available.</p>
        <button className="btn" onClick={summarize} disabled={busy === 'summary'} data-testid="summary">
          {busy === 'summary' ? 'Summarizing…' : 'Generate summary'}
        </button>
        {inc.summary && (
          <div className="ai-block">
            <ModeBadge where={inc.summary.where} />
            <p>{inc.summary.text}</p>
          </div>
        )}
        {summaryMsg && <p className="hint warn">{summaryMsg}</p>}
      </section>

      <section className="panel">
        <h3>Sync to team (Firestore)</h3>
        <label className="toggle">
          <input type="checkbox" checked={inc.syncPHI} onChange={(e) => {
            if (e.target.checked && !confirm('Sync identifiable patient data for THIS incident? By default only a de-identified record is synced.')) return;
            void api.setConsent({ syncPHI: e.target.checked });
          }} />
          Include identifiable patient data for this incident (off by default)
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={sync} disabled={!status.cloudConfigured || busy === 'sync'} data-testid="sync">
            {status.online ? 'Sync now' : 'Queue for sync (offline)'}
          </button>
          <button className="btn" onClick={() => setShowDeid((s) => !s)}>
            {showDeid ? 'Hide' : 'Preview'} what will be sent
          </button>
          <span className={`pill pill-${inc.sync?.state === 'synced' ? 'ok' : inc.sync?.state === 'error' ? 'warn' : 'muted'}`} data-testid="sync-state">
            {inc.sync?.state === 'synced'
              ? `✓ Synced ${inc.sync.at ? new Date(inc.sync.at).toLocaleTimeString() : ''}`
              : inc.sync?.state === 'pending'
                ? '⏳ Queued — will upload when online'
                : inc.sync?.state === 'error'
                  ? `Sync error: ${inc.sync.error}`
                  : 'Local only'}
          </span>
        </div>
        {!status.cloudConfigured && <p className="hint">Firebase isn't configured in this build, so sync is disabled.</p>}
        {showDeid && <pre className="json">{JSON.stringify(inc.syncPHI ? { note: 'identifiable record (opt-in)' } : deidentifiedRecord(inc), null, 2)}</pre>}
      </section>
      </div>
    </div>
  );
}
