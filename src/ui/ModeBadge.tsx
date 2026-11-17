import type { Where } from '../features/report/schema';

const LABELS: Record<Where, { icon: string; text: string; cls: string; title: string }> = {
  on_device: { icon: '🔒', text: 'On-device', cls: 'badge-device', title: 'Processed by Gemini Nano on this laptop. Nothing left the device.' },
  in_cloud: { icon: '☁️', text: 'Cloud', cls: 'badge-cloud', title: 'Processed by Gemini in the cloud via Firebase AI Logic.' },
  local_rules: { icon: '⚙️', text: 'Local rules (no AI)', cls: 'badge-rules', title: 'Deterministic on-device parser. No model involved.' },
  user: { icon: '✍️', text: 'Responder', cls: 'badge-user', title: 'Entered or edited by the responder.' },
};

/** Truthful provenance badge. `where` comes from the SDK's response.inferenceSource. */
export function ModeBadge({ where, compact }: { where?: Where; compact?: boolean }) {
  if (!where) return null;
  const l = LABELS[where];
  return (
    <span className={`badge ${l.cls}`} title={l.title} aria-label={`${l.text}: ${l.title}`}>
      <span aria-hidden>{l.icon}</span>
      {!compact && <span>{l.text}</span>}
    </span>
  );
}
