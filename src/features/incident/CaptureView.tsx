import { useEffect, useRef, useState } from 'react';
import type { IncidentApi } from './useIncident';
import { startListening, installLocalSpeech, type Listener } from '../speech/speech';
import { useStatus } from '../../ui/status';
import { hhmm } from '../report/rules';

const QUICK: Array<{ label: string; text: string } | { label: string; template: string }> = [
  { label: 'Vitals…', template: 'HR  , RR  , BP  /  , SpO2  %' },
  { label: 'Direct pressure', text: 'Direct pressure applied' },
  { label: 'Tourniquet', text: 'Tourniquet applied' },
  { label: 'Wound packed', text: 'Wound packed with gauze' },
  { label: 'Splint', text: 'Splint applied' },
  { label: 'Insulated / warming', text: 'Patient insulated, warming started' },
  { label: 'Cooling', text: 'Active cooling started' },
  { label: 'Alert & oriented', text: 'Patient alert and oriented' },
  { label: 'Unresponsive', text: 'Patient unresponsive' },
  { label: 'Help called', text: 'Help called / radio contact made' },
];

export function CaptureView({ api }: { api: IncidentApi }) {
  const status = useStatus();
  const inc = api.incident!;
  const [text, setText] = useState('');
  const [interim, setInterim] = useState('');
  const [listener, setListener] = useState<Listener | null>(null);
  const [speechMsg, setSpeechMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const ended = !!inc.endedAt;

  const local = status.speech.kind === 'local' && status.speech.avail === 'available';
  const localInstallable = status.speech.kind === 'local' && (status.speech.avail === 'downloadable' || status.speech.avail === 'downloading');
  const cloudSpeechAllowed = inc.allowCloudForPHI && status.online && status.speech.kind !== 'none';
  const canListen = local || cloudSpeechAllowed;

  useEffect(() => {
    listRef.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [inc.timeline.length]);

  useEffect(() => () => listener?.stop(), [listener]);

  const submit = () => {
    if (!text.trim()) return;
    void api.addEntry(text, 'typed');
    setText('');
  };

  const toggleMic = () => {
    if (listener) {
      listener.stop();
      setListener(null);
      setInterim('');
      return;
    }
    setSpeechMsg(null);
    const l = startListening({
      local,
      onInterim: setInterim,
      onFinal: (t) => {
        setInterim('');
        if (t) void api.addEntry(t, 'speech', local ? 'local' : 'cloud');
      },
      onError: (m) => setSpeechMsg(`Speech error: ${m}. Typed input still works.`),
      onEnd: () => setListener(null),
    });
    setListener(l);
  };

  let micHint = '';
  if (!canListen) {
    if (status.speech.kind === 'none') micHint = 'Voice not supported in this browser — use typed input.';
    else if (localInstallable) micHint = 'On-device speech pack not installed.';
    else micHint = 'On-device speech unavailable. Server speech would send audio off the device — allow cloud for this incident to use it.';
  }

  return (
    <section className="panel capture" aria-label="Capture">
      <div className="capture-controls">
        <button
          className={`mic ${listener ? 'mic-on' : ''}`}
          onClick={toggleMic}
          disabled={!canListen || ended}
          aria-pressed={!!listener}
          data-testid="mic"
        >
          <span aria-hidden>{listener ? '■' : '🎙'}</span>
          {listener ? 'Stop listening' : 'Talk'}
          {canListen && <small>{local ? '🔒 on-device speech' : '☁️ server speech (consented)'}</small>}
        </button>
        {micHint && (
          <p className="hint">
            {micHint}{' '}
            {localInstallable && status.online && (
              <button className="btn-small" onClick={() => installLocalSpeech().then(status.refresh)}>
                Install speech pack
              </button>
            )}
          </p>
        )}
        {speechMsg && <p className="hint warn">{speechMsg}</p>}
        {interim && <p className="interim" aria-live="polite">“{interim}”</p>}
      </div>

      <form
        className="typed"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label htmlFor="entry" className="sr-only">
          Type what you see or did
        </label>
        <textarea
          id="entry"
          ref={inputRef}
          value={text}
          rows={2}
          disabled={ended}
          placeholder="Type what you see or did… e.g. “Hiker, about 50, fell 3 metres, left forearm deformity, bleeding”"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          data-testid="entry-input"
        />
        <button type="submit" className="btn-primary" disabled={!text.trim() || ended} data-testid="entry-add">
          Add
        </button>
      </form>

      <div className="quick" role="group" aria-label="Quick insert">
        {QUICK.map((q) => (
          <button
            key={q.label}
            className="chip"
            disabled={ended}
            onClick={() => {
              if ('text' in q) void api.addEntry(q.text, 'quick');
              else {
                setText(q.template);
                inputRef.current?.focus();
              }
            }}
          >
            {q.label}
          </button>
        ))}
      </div>

      <h3>Timeline</h3>
      {inc.timeline.length === 0 ? (
        <p className="empty">Nothing recorded yet. Talk, type, or tap a quick-insert button.</p>
      ) : (
        <ol className="timeline" ref={listRef} data-testid="timeline">
          {inc.timeline.map((e) => (
            <li key={e.id} className={`tl tl-${e.kind}`}>
              <time dateTime={e.ts}>{hhmm(new Date(e.ts))}</time>
              <span>{e.text}</span>
              {e.kind === 'speech' && <small className="tl-src">{e.speechWhere === 'local' ? '🔒🎙' : '☁️🎙'}</small>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
