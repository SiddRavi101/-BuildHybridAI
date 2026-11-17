import { useEffect, useState } from 'react';
import { StatusProvider, useStatus } from './ui/status';
import { StatusBar, SafetyBanner } from './ui/StatusBar';
import { createIncident, useIncident } from './features/incident/useIncident';
import { listIncidents, deleteIncident, type Incident } from './features/incident/db';
import { CaptureView } from './features/incident/CaptureView';
import { ReportView } from './features/report/ReportView';
import { ProtocolPanel } from './features/protocols/ProtocolPanel';
import { HandoffView } from './features/export/HandoffView';
import { AuditView } from './features/audit/AuditView';
import { TrainingView } from './features/training/TrainingView';
import { SettingsView } from './ui/SettingsView';
import { syncIncident } from './features/sync/firestoreSync';

type View = 'home' | 'live' | 'protocols' | 'handoff' | 'audit' | 'training' | 'settings';

function Elapsed({ since, until }: { since: string; until?: string }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (until) return;
    const t = setInterval(() => tick((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, [until]);
  const ms = (until ? new Date(until).getTime() : Date.now()) - new Date(since).getTime();
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return <span className="elapsed">{`${m}:${String(s).padStart(2, '0')}`}</span>;
}

function Home({ onOpen, onNew, onTraining }: { onOpen: (id: string) => void; onNew: () => void; onTraining: () => void }) {
  const [list, setList] = useState<Incident[]>([]);
  useEffect(() => {
    listIncidents().then(setList);
  }, []);
  return (
    <div className="home">
      <section className="panel hero">
        <h1>
          <span aria-hidden>📍</span> Pinpoint Field
        </h1>
        <p>Talk while you work. Pinpoint reads protocol steps aloud and builds the care report — on this device.</p>
        <button className="btn btn-primary btn-huge" onClick={onNew} data-testid="start-incident">
          ＋ Start incident
        </button>
        <button className="btn btn-big" onClick={onTraining}>
          🎓 Training Mode
        </button>
      </section>
      <section className="panel">
        <h2>Incidents on this device</h2>
        {list.length === 0 ? (
          <p className="empty">No incidents yet. Everything you record stays on this laptop until you sync.</p>
        ) : (
          <ul className="incident-list">
            {list.map((i) => (
              <li key={i.id}>
                <button className="linkish" onClick={() => onOpen(i.id)}>
                  <strong>{i.title}</strong> · {new Date(i.startedAt).toLocaleString()} · {i.timeline.length} entries{' '}
                  {i.endedAt ? '· handed off' : '· active'}
                </button>
                <span className="pill pill-muted">{i.sync?.state ?? 'local'}</span>
                <button
                  className="btn-small btn-danger"
                  onClick={async () => {
                    if (!confirm(`Delete ${i.title} from this device? This cannot be undone.`)) return;
                    await deleteIncident(i.id);
                    setList(await listIncidents());
                  }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Shell() {
  const status = useStatus();
  const [view, setView] = useState<View>('home');
  const [incidentId, setIncidentId] = useState<string | null>(null);
  const api = useIncident(incidentId, { autoStructure: status.settings.autoStructure, onDeviceReady: status.onDevice === 'available' });
  const inc = api.incident;

  // Re-sync anything queued while offline once we're back online.
  useEffect(() => {
    if (!status.online || !status.cloudConfigured) return;
    listIncidents().then((all) => all.filter((i) => i.sync?.state === 'pending').forEach((i) => syncIncident(i.id)));
  }, [status.online, status.cloudConfigured]);

  const startNew = async () => {
    const i = await createIncident(status.settings.allowCloudForPHIDefault);
    setIncidentId(i.id);
    setView('live');
  };

  const tabs: Array<[View, string]> = inc
    ? [
        ['live', '🎙 Capture & report'],
        ['protocols', '📋 Protocols'],
        ['handoff', '🚑 Handoff'],
        ['audit', '🔗 Audit'],
      ]
    : [];

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" onClick={() => setView('home')} aria-label="Home">
          📍 Pinpoint <span>Field</span>
        </button>
        <StatusBar />
        <nav className="nav-right">
          <button className={view === 'training' ? 'tab tab-on' : 'tab'} onClick={() => setView('training')}>
            🎓 Training
          </button>
          <button className={view === 'settings' ? 'tab tab-on' : 'tab'} onClick={() => setView('settings')} data-testid="nav-settings">
            ⚙ Settings
          </button>
        </nav>
      </header>
      {!status.online && (
        <div className="offline-banner" role="status">
          Offline — everything keeps working. Patient data is processed on this device; sync resumes when you reconnect.
        </div>
      )}
      <SafetyBanner />

      {inc && view !== 'home' && view !== 'training' && view !== 'settings' && (
        <div className="incident-bar">
          <strong>{inc.title}</strong>
          <Elapsed since={inc.startedAt} until={inc.endedAt} />
          <nav className="tabs" aria-label="Incident">
            {tabs.map(([v, label]) => (
              <button key={v} className={view === v ? 'tab tab-on' : 'tab'} onClick={() => setView(v)} data-testid={`tab-${v}`}>
                {label}
              </button>
            ))}
          </nav>
          <label className="toggle toggle-inline" title="Per-incident consent. Off = patient data never leaves this device.">
            <input
              type="checkbox"
              checked={inc.allowCloudForPHI}
              onChange={(e) => {
                if (e.target.checked && !confirm('Allow cloud processing of patient data for THIS incident? Only do this if the on-device model is unavailable and the patient (or your policy) permits it.')) return;
                void api.setConsent({ allowCloudForPHI: e.target.checked });
              }}
              data-testid="incident-cloud-consent"
            />
            Cloud OK for this patient
          </label>
        </div>
      )}

      <main>
        {view === 'home' && (
          <Home
            onNew={startNew}
            onOpen={(id) => {
              setIncidentId(id);
              setView('live');
            }}
            onTraining={() => setView('training')}
          />
        )}
        {view === 'training' && <TrainingView />}
        {view === 'settings' && <SettingsView />}
        {inc && view === 'live' && (
          <div className="live-grid">
            <CaptureView api={api} />
            <ReportView api={api} onDeviceReady={status.onDevice === 'available'} />
          </div>
        )}
        {inc && view === 'protocols' && (
          <div className="live-grid">
            <ProtocolPanel api={api} />
            <ReportView api={api} onDeviceReady={status.onDevice === 'available'} />
          </div>
        )}
        {inc && view === 'handoff' && <HandoffView api={api} />}
        {inc && view === 'audit' && <AuditView incidentId={inc.id} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StatusProvider>
      <Shell />
    </StatusProvider>
  );
}
