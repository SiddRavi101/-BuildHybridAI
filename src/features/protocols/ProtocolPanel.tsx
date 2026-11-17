import { useEffect, useState } from 'react';
import type { IncidentApi } from '../incident/useIncident';
import { speak, stopSpeaking } from '../speech/speech';
import { useStatus } from '../../ui/status';

export interface Protocol {
  id: string;
  title: string;
  icon: string;
  source: { name: string; url: string };
  steps: string[];
  callForHelp: string[];
  reviewStatus: string;
}
export interface ProtocolIndexItem {
  id: string;
  title: string;
  icon: string;
}

const BASE = import.meta.env.BASE_URL;
export const loadIndex = (): Promise<ProtocolIndexItem[]> => fetch(`${BASE}protocols/index.json`).then((r) => r.json());
export const loadProtocol = (id: string): Promise<Protocol> => fetch(`${BASE}protocols/${id}.json`).then((r) => r.json());

/** Static, user-selected protocol cards. No AI is involved in choosing or wording care steps. */
export function ProtocolPanel({ api }: { api: IncidentApi }) {
  const { settings } = useStatus();
  const [index, setIndex] = useState<ProtocolIndexItem[]>([]);
  const [loadErr, setLoadErr] = useState(false);
  const [open, setOpen] = useState<Protocol | null>(null);
  const [current, setCurrent] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const inc = api.incident!;

  useEffect(() => {
    loadIndex().then(setIndex).catch(() => setLoadErr(true));
    return stopSpeaking;
  }, []);

  const read = (p: Protocol, i: number) => {
    if (!settings.readStepsAloud) return;
    setSpeaking(true);
    speak(`Step ${i + 1}. ${p.steps[i]}`, () => setSpeaking(false));
  };

  const choose = async (id: string) => {
    const p = await loadProtocol(id);
    setOpen(p);
    setCurrent(0);
    await api.openProtocol(id);
    read(p, 0);
  };

  if (!open) {
    return (
      <section className="panel protocols" aria-label="Protocol cards">
        <h2>Protocol cards</h2>
        <p className="hint">Pick the card that matches what you see. Steps come from a fixed library and are read aloud.</p>
        {loadErr && <div className="notice notice-warn">Protocol library not cached yet — open the app once while online so it can be stored for offline use.</div>}
        <div className="cards">
          {index.map((p) => (
            <button key={p.id} className="card" onClick={() => choose(p.id)} data-testid={`protocol-${p.id}`}>
              <span className="card-icon" aria-hidden>
                {p.icon}
              </span>
              <span>{p.title}</span>
              {inc.protocols.some((x) => x.protocolId === p.id) && <small>in use</small>}
            </button>
          ))}
        </div>
      </section>
    );
  }

  const checked = inc.protocols.find((x) => x.protocolId === open.id)?.checked ?? [];
  return (
    <section className="panel protocols" aria-label={`Protocol: ${open.title}`} data-testid="protocol-walkthrough">
      <div className="report-head">
        <button className="btn-small" onClick={() => { stopSpeaking(); setOpen(null); }}>
          ← All cards
        </button>
        <h2>
          {open.icon} {open.title}
        </h2>
      </div>
      <div className="notice notice-help">
        <strong>Call for help if:</strong> {open.callForHelp.join(' · ')}
      </div>
      <ol className="steps">
        {open.steps.map((s, i) => (
          <li key={i} className={`step ${i === current ? 'step-current' : ''} ${checked.includes(i) ? 'step-done' : ''}`}>
            <button
              className="step-check"
              aria-pressed={checked.includes(i)}
              aria-label={`Mark step ${i + 1} ${checked.includes(i) ? 'not done' : 'done'}`}
              onClick={async () => {
                await api.toggleStep(open.id, open.title, i, s);
                if (!checked.includes(i) && i === current && i < open.steps.length - 1) {
                  setCurrent(i + 1);
                  read(open, i + 1);
                }
              }}
              data-testid={`step-${i}`}
            >
              {checked.includes(i) ? '✓' : i + 1}
            </button>
            <span
              onClick={() => {
                setCurrent(i);
                read(open, i);
              }}
            >
              {s}
            </span>
          </li>
        ))}
      </ol>
      <div className="row">
        <button className="btn" onClick={() => read(open, current)} disabled={!settings.readStepsAloud}>
          {speaking ? '🔊 Reading…' : '🔊 Repeat step'}
        </button>
        <button className="btn" onClick={() => { const n = Math.max(0, current - 1); setCurrent(n); read(open, n); }}>
          ◀ Prev
        </button>
        <button className="btn" onClick={() => { const n = Math.min(open.steps.length - 1, current + 1); setCurrent(n); read(open, n); }}>
          Next ▶
        </button>
      </div>
      <p className="fineprint">
        Source: <a href={open.source.url} target="_blank" rel="noreferrer">{open.source.name}</a>. {open.reviewStatus}
      </p>
    </section>
  );
}
