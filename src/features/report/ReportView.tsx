import { useState } from 'react';
import type { IncidentApi, ListKey, ScalarPath } from '../incident/useIncident';
import type { Field, Injury, Intervention, Item, Vitals } from './schema';
import { ModeBadge } from '../../ui/ModeBadge';
import { vitalsLine, countUnconfirmed } from '../export/mist';
import { hhmm } from './rules';

function StatusTag({ status }: { status: Field['status'] | Item<unknown>['status'] }) {
  if (status === 'empty') return null;
  return <span className={`tag tag-${status}`}>{status === 'draft' ? 'Draft' : 'Confirmed ✓'}</span>;
}

function ScalarRow({ api, path, label, placeholder }: { api: IncidentApi; path: ScalarPath; label: string; placeholder?: string }) {
  const f = api.getScalar(path);
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState('');
  return (
    <div className={`field field-${f.status}`} data-testid={`field-${path}`}>
      <div className="field-head">
        <span className="field-label">{label}</span>
        <ModeBadge where={f.where} compact />
        <StatusTag status={f.status} />
      </div>
      {editing ? (
        <form
          className="field-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void api.editScalar(path, v);
            setEditing(false);
          }}
        >
          <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={placeholder} aria-label={label} />
          <button className="btn-small btn-primary" type="submit">
            Save
          </button>
          <button className="btn-small" type="button" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <div className="field-body">
          <span className={f.value ? 'field-value' : 'field-empty'}>{f.value || '—'}</span>
          <span className="field-actions">
            {f.status === 'draft' && (
              <button className="btn-small btn-confirm" onClick={() => api.confirmScalar(path)} aria-label={`Confirm ${label}`}>
                Confirm
              </button>
            )}
            <button
              className="btn-small"
              onClick={() => {
                setV(f.value);
                setEditing(true);
              }}
              aria-label={`Edit ${label}`}
            >
              Edit
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

function ItemList<T>({
  api,
  k,
  label,
  items,
  render,
  toEditString,
  fromEditString,
  addPlaceholder,
}: {
  api: IncidentApi;
  k: ListKey;
  label: string;
  items: Item<T>[];
  render: (t: T) => string;
  toEditString: (t: T) => string;
  fromEditString: (s: string, prev?: T) => T;
  addPlaceholder: string;
}) {
  const [editId, setEditId] = useState<string | null>(null);
  const [v, setV] = useState('');
  const [adding, setAdding] = useState(false);
  return (
    <div className="list" data-testid={`list-${k}`}>
      <div className="field-head">
        <span className="field-label">{label}</span>
        <button className="btn-small" onClick={() => { setAdding(true); setV(''); }}>
          + Add
        </button>
      </div>
      {items.length === 0 && !adding && <p className="field-empty">None recorded</p>}
      <ul>
        {items.map((i) => (
          <li key={i.id} className={`item item-${i.status}`}>
            {editId === i.id ? (
              <form
                className="field-edit"
                onSubmit={(e) => {
                  e.preventDefault();
                  void api.editItem(k, i.id, fromEditString(v, i.data));
                  setEditId(null);
                }}
              >
                <input autoFocus value={v} onChange={(e) => setV(e.target.value)} aria-label={`Edit ${label}`} />
                <button className="btn-small btn-primary">Save</button>
                <button type="button" className="btn-small" onClick={() => setEditId(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="item-text">{render(i.data)}</span>
                <ModeBadge where={i.where} compact />
                <StatusTag status={i.status} />
                <span className="field-actions">
                  {i.status === 'draft' && (
                    <button className="btn-small btn-confirm" onClick={() => api.confirmItem(k, i.id)}>
                      Confirm
                    </button>
                  )}
                  <button className="btn-small" onClick={() => { setEditId(i.id); setV(toEditString(i.data)); }}>
                    Edit
                  </button>
                  <button className="btn-small btn-danger" onClick={() => api.removeItem(k, i.id)} aria-label="Remove">
                    ✕
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {adding && (
          <li className="item">
            <form
              className="field-edit"
              onSubmit={(e) => {
                e.preventDefault();
                if (v.trim()) void api.addItem(k, fromEditString(v) as never);
                setAdding(false);
              }}
            >
              <input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder={addPlaceholder} aria-label={`Add ${label}`} />
              <button className="btn-small btn-primary">Add</button>
              <button type="button" className="btn-small" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </form>
          </li>
        )}
      </ul>
    </div>
  );
}

const now = () => hhmm(new Date());

function parseVitalsEdit(s: string, prev?: Vitals): Vitals {
  const n = (re: RegExp) => {
    const m = s.match(re);
    return m ? Number(m[1]) : null;
  };
  const bp = s.match(/bp\s*(\d{2,3}\s*\/\s*\d{2,3})/i);
  const time = s.match(/^(\d{1,2}:\d{2})/)?.[1] ?? prev?.time ?? now();
  return {
    time,
    hr: n(/hr\s*(\d+)/i),
    rr: n(/rr\s*(\d+)/i),
    bp: bp ? bp[1].replace(/\s/g, '') : undefined,
    spo2: n(/spo2\s*(\d+)/i),
    gcs: n(/gcs\s*(\d+)/i),
    temp: n(/temp\s*([\d.]+)/i),
  };
}

export function ReportView({ api, onDeviceReady }: { api: IncidentApi; onDeviceReady: boolean }) {
  const inc = api.incident!;
  const r = inc.report;
  const ex = api.extraction;
  const pending = inc.pendingExtractionFrom != null;
  const unconfirmed = countUnconfirmed(r);

  return (
    <section className="panel report" aria-label="Care report" data-testid="report">
      <div className="report-head">
        <h2>Care report</h2>
        <ModeBadge where={r.lastExtractedWhere} />
        {unconfirmed > 0 && <span className="tag tag-draft">{unconfirmed} to confirm</span>}
        <button className="btn-small" onClick={() => api.runExtraction()} disabled={ex.state === 'running'} data-testid="structure-now">
          {ex.state === 'running' ? 'Structuring…' : 'Structure now'}
        </button>
      </div>

      {ex.state === 'running' && (
        <p className="hint" aria-live="polite">
          {onDeviceReady ? '🔒 Structuring on-device with Gemini Nano…' : 'Structuring…'}
          {ex.streaming ? ` (${ex.streaming.length} chars)` : ''}
        </p>
      )}
      {(ex.state === 'blocked' || pending) && ex.state !== 'running' && (
        <div className="notice notice-privacy" data-testid="privacy-blocked">
          <strong>🔒 Patient data kept on this device.</strong>{' '}
          {ex.message ?? 'Will structure when the on-device model is ready.'} Vitals and named interventions are still recorded by local
          rules (⚙️). Your notes are safe in the timeline.
          {!inc.allowCloudForPHI && (
            <div>
              <button className="btn-small" onClick={() => {
                  if (confirm('Send this incident\'s patient notes to the cloud for structuring? Only if the on-device model is unavailable and your policy permits.')) void api.setConsent({ allowCloudForPHI: true });
                }} data-testid="allow-cloud-incident">
                Allow cloud for this incident…
              </button>
            </div>
          )}
        </div>
      )}
      {ex.state === 'error' && <div className="notice notice-warn">{ex.message} Kept the previous report.</div>}

      <div className="fields">
        <ScalarRow api={api} path="patient.ageRange" label="Age range" placeholder="e.g. 50-59" />
        <ScalarRow api={api} path="patient.sex" label="Sex" />
        <ScalarRow api={api} path="patient.chiefComplaint" label="Chief complaint" />
        <ScalarRow api={api} path="mechanismOfInjury" label="Mechanism of injury" />
      </div>
      <ItemList<Injury>
        api={api}
        k="injuries"
        label="Injuries observed"
        items={r.injuries}
        render={(i) => `${[i.side, i.bodyRegion].filter(Boolean).join(' ')}: ${i.type}${i.notes ? ` — ${i.notes}` : ''}`}
        toEditString={(i) => `${[i.side, i.bodyRegion].filter(Boolean).join(' ')}: ${i.type}`}
        fromEditString={(s) => {
          const [where, type] = s.includes(':') ? s.split(/:(.*)/) : ['', s];
          const side = where.match(/\b(left|right|bilateral)\b/i)?.[1]?.toLowerCase() ?? '';
          return { bodyRegion: where.replace(/\b(left|right|bilateral)\b/i, '').trim(), side, type: type.trim(), notes: '' };
        }}
        addPlaceholder="left forearm: deformity"
      />
      <ItemList<Intervention>
        api={api}
        k="interventions"
        label="Care given (interventions)"
        items={r.interventions}
        render={(i) => `${i.time || '--:--'}  ${i.type}${i.notes ? ` — ${i.notes}` : ''}`}
        toEditString={(i) => `${i.time} ${i.type}`}
        fromEditString={(s, prev) => {
          const m = s.match(/^(\d{1,2}:\d{2})\s+(.*)$/);
          return { time: m?.[1] ?? prev?.time ?? now(), type: (m?.[2] ?? s).trim(), notes: prev?.notes ?? '' };
        }}
        addPlaceholder="14:32 Tourniquet applied"
      />
      <ItemList<Vitals>
        api={api}
        k="vitals"
        label="Vitals"
        items={r.vitals}
        render={vitalsLine}
        toEditString={(v) => vitalsLine(v).replace(/·/g, '').replace(/%/g, '').replace(/\s+/g, ' ')}
        fromEditString={parseVitalsEdit}
        addPlaceholder="14:35 HR 110 RR 20 BP 128/84 SpO2 96"
      />
      <ScalarRow api={api} path="handoffNotes" label="Handoff notes" />
      <p className="fineprint">
        AI fills <em>drafts</em> only from what you said. Nothing is final until you confirm it. No diagnosis, no treatment advice.
      </p>
    </section>
  );
}
