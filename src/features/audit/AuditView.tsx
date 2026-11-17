import { useCallback, useEffect, useState } from 'react';
import { getAudit, tamperAuditEntry } from '../incident/db';
import { verifyChain, type AuditEntry, type VerifyResult } from './hashChain';

function describe(e: AuditEntry): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.type) {
    case 'ai.route':
      return `AI ${p.task}: requested ${p.modeRequested} → used ${p.modeUsed}${p.blocked ? ' (blocked)' : ''}${p.consentUsed ? ' (with consent)' : ''}`;
    case 'timeline.entry':
      return `${p.kind}: ${String(p.text ?? '').slice(0, 80)}`;
    case 'report.ai_update':
      return `Report updated (${p.where})`;
    case 'report.user_edit':
      return `Edited ${p.path ?? p.key}`;
    case 'report.confirm':
      return `Confirmed ${p.path ?? p.key}`;
    default:
      return JSON.stringify(p).slice(0, 90);
  }
}

export function AuditView({ incidentId }: { incidentId: string }) {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const load = useCallback(() => getAudit(incidentId).then(setEntries), [incidentId]);
  useEffect(() => {
    load();
  }, [load]);

  const verify = async () => {
    const fresh = await getAudit(incidentId);
    setEntries(fresh);
    setResult(await verifyChain(fresh));
  };

  return (
    <section className="panel audit" aria-label="Audit log">
      <div className="report-head">
        <h2>Audit log</h2>
        <span className="tag">{entries.length} entries · SHA-256 chained</span>
      </div>
      <div className="row">
        <button className="btn btn-primary" onClick={verify} data-testid="verify">
          Verify integrity
        </button>
        <button className="btn" onClick={load}>
          Refresh
        </button>
        <button
          className="btn btn-danger"
          title="Demo: silently edit one stored entry, then verify again"
          onClick={async () => {
            if (entries.length > 1) await tamperAuditEntry(incidentId, Math.floor(entries.length / 2));
            setResult(null);
            load();
          }}
        >
          Simulate tampering
        </button>
      </div>
      {result && (
        <div className={`notice ${result.ok ? 'notice-ok' : 'notice-warn'}`} role="status" data-testid="verify-result">
          {result.ok ? `Integrity verified ✓ — ${result.checked} entries, unbroken chain.` : `Integrity FAILED ✗ — ${result.reason}.`}
        </div>
      )}
      <ol className="audit-list">
        {entries.map((e) => (
          <li key={e.seq} className={result && !result.ok && result.brokenAt === e.seq ? 'audit-broken' : ''}>
            <code>#{e.seq}</code>
            <time>{new Date(e.ts).toLocaleTimeString()}</time>
            <span className="audit-type">{e.type}</span>
            <span className="audit-desc">{describe(e)}</span>
            <code className="hash" title={`hash ${e.hash}\nprev ${e.prevHash}`}>
              {e.hash.slice(0, 10)}…
            </code>
          </li>
        ))}
      </ol>
    </section>
  );
}
