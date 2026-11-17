import { useState } from 'react';
import { useStatus } from './status';
import { privacyRouter } from '../firebase/runTask';
import { TASK_POLICY, decideRoute, type Task } from '../firebase/privacyRouter';
import { ModeBadge } from './ModeBadge';
import { installLocalSpeech } from '../features/speech/speech';
import { onDeviceStatusLabel } from '../firebase/onDevice';

export function SettingsView() {
  const s = useStatus();
  const [hello, setHello] = useState<{ text: string; where?: 'on_device' | 'in_cloud'; err?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const ctx = { onDevice: s.onDevice, online: s.online, cloudConfigured: s.cloudConfigured, allowCloudForPHI: s.settings.allowCloudForPHIDefault };

  const sayHello = async () => {
    setBusy(true);
    const r = await privacyRouter.run('hello', {
      system: 'You are a terse assistant.',
      prompt: 'Reply with one short friendly sentence confirming you are working. No more than 12 words.',
    });
    setHello(r.ok ? { text: r.text, where: r.served } : { text: r.reason, err: true });
    setBusy(false);
  };

  return (
    <section className="panel settings" aria-label="Settings">
      <h2>Settings & privacy</h2>

      <h3>Patient data</h3>
      <label className="toggle">
        <input
          type="checkbox"
          checked={s.settings.allowCloudForPHIDefault}
          onChange={(e) => {
            if (e.target.checked && !confirm('Allow cloud fallback for patient data by default on NEW incidents? Off is recommended: patient data then never leaves this device.')) return;
            s.setSettings({ allowCloudForPHIDefault: e.target.checked });
          }}
          data-testid="allow-cloud-default"
        />
        Allow cloud fallback for patient data (off by default)
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.settings.autoStructure} onChange={(e) => s.setSettings({ autoStructure: e.target.checked })} />
        Auto-structure the report as I talk
      </label>
      <label className="toggle">
        <input type="checkbox" checked={s.settings.readStepsAloud} onChange={(e) => s.setSettings({ readStepsAloud: e.target.checked })} />
        Read protocol steps aloud
      </label>

      <h3>Privacy Router — live decisions</h3>
      <table className="router-table">
        <thead>
          <tr>
            <th>Task</th>
            <th>Patient data?</th>
            <th>Mode</th>
            <th>Right now</th>
          </tr>
        </thead>
        <tbody>
          {(Object.keys(TASK_POLICY) as Task[]).filter((t) => t !== 'hello').map((t) => {
            const p = TASK_POLICY[t];
            const d = decideRoute(t, ctx);
            return (
              <tr key={t}>
                <td>{p.label}</td>
                <td>{p.containsPHI ? 'Yes' : p.deidentifyInput ? 'No (de-identified)' : 'No'}</td>
                <td><code>{p.mode}</code></td>
                <td>{d.kind === 'run' ? <ModeBadge where={d.expected === 'either' ? 'in_cloud' : d.expected} /> : <span className="tag tag-blocked">Blocked — {d.reason}</span>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h3>On-device AI</h3>
      <p>Status: <strong>{onDeviceStatusLabel(s.onDevice)}</strong> · Speech: <strong>{s.speech.kind === 'local' ? `on-device (${s.speech.avail})` : s.speech.kind === 'server-only' ? 'server only' : 'not supported'}</strong></p>
      <div className="row">
        <button className="btn" onClick={sayHello} disabled={busy || !s.cloudConfigured} data-testid="hello">
          {busy ? 'Calling…' : 'Test hybrid call (PREFER_ON_DEVICE)'}
        </button>
        {s.speech.kind === 'local' && s.speech.avail !== 'available' && (
          <button className="btn" onClick={() => installLocalSpeech().then(s.refresh)} disabled={!s.online}>
            Install on-device speech
          </button>
        )}
      </div>
      {hello && (
        <div className={`ai-block ${hello.err ? 'notice-warn' : ''}`} data-testid="hello-result">
          <ModeBadge where={hello.where} /> {hello.text}
        </div>
      )}
      {!s.cloudConfigured && <p className="hint warn">Firebase isn't configured in this build (no .env.local). Local features still work.</p>}

      <h3>Connection</h3>
      <ul className="plain">
        <li>Network: {s.online ? 'online' : 'offline'}</li>
        <li>Firebase: {s.cloudConfigured ? 'configured' : 'not configured'}</li>
        <li>App Check: {s.appCheckActive ? 'active (reCAPTCHA Enterprise / debug token)' : 'inactive'}</li>
        <li>Anonymous user: {s.uid ? s.uid.slice(0, 8) + '…' : '—'}</li>
      </ul>
    </section>
  );
}
