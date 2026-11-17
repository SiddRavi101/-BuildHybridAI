/**
 * Speech capture strategy (plan §4.3):
 *  1. Chrome on-device speech recognition (Web Speech API with processLocally) — audio never leaves the laptop.
 *  2. Gemini Nano audio via Firebase AI Logic — NOT viable in firebase@13.4: the SDK's Chrome adapter only
 *     routes image/jpeg and image/png inline data on-device, so audio parts would be sent to the cloud.
 *  3. Typed input + quick-insert buttons (always available).
 *
 * Classic (server-based) Web Speech sends audio to Google's servers. Because voice notes ARE patient data,
 * we only use it when the user has explicitly allowed cloud processing for the incident, and label it ☁️.
 */

type Avail = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface SRStatic {
  new (): SR;
  available?: (o: { langs: string[]; processLocally: boolean }) => Promise<Avail>;
  install?: (o: { langs: string[]; processLocally: boolean }) => Promise<boolean>;
  // older shape (Chrome origin trial)
  availableOnDevice?: (lang: string) => Promise<Avail>;
  installOnDevice?: (lang: string) => Promise<boolean>;
}
interface SR extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  processLocally?: boolean;
  mode?: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SREvent) => void) | null;
  onerror: ((e: { error: string; message?: string }) => void) | null;
  onend: (() => void) | null;
}
interface SREvent {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
}

export type SpeechStatus =
  | { kind: 'local'; avail: Avail }
  | { kind: 'server-only' }
  | { kind: 'none' };

const LANG = 'en-US';

function ctor(): SRStatic | undefined {
  const g = globalThis as unknown as { SpeechRecognition?: SRStatic; webkitSpeechRecognition?: SRStatic };
  return g.SpeechRecognition ?? g.webkitSpeechRecognition;
}

export async function getSpeechStatus(): Promise<SpeechStatus> {
  const C = ctor();
  if (!C) return { kind: 'none' };
  try {
    if (C.available) return { kind: 'local', avail: await C.available({ langs: [LANG], processLocally: true }) };
    if (C.availableOnDevice) return { kind: 'local', avail: await C.availableOnDevice(LANG) };
  } catch {
    /* ignore */
  }
  return { kind: 'server-only' };
}

/** Download the on-device speech pack (needs network once, then works offline). */
export async function installLocalSpeech(): Promise<boolean> {
  const C = ctor();
  if (!C) return false;
  try {
    if (C.install) return await C.install({ langs: [LANG], processLocally: true });
    if (C.installOnDevice) return await C.installOnDevice(LANG);
  } catch {
    /* ignore */
  }
  return false;
}

export interface Listener {
  stop(): void;
  where: 'local' | 'cloud';
}

export function startListening(opts: {
  local: boolean;
  onInterim: (t: string) => void;
  onFinal: (t: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}): Listener | null {
  const C = ctor();
  if (!C) return null;
  const r = new C();
  r.lang = LANG;
  r.continuous = true;
  r.interimResults = true;
  if (opts.local) {
    if ('processLocally' in r || C.available) r.processLocally = true;
    else r.mode = 'ondevice-only';
  }
  let stopped = false;
  r.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) opts.onFinal(res[0].transcript.trim());
      else interim += res[0].transcript;
    }
    opts.onInterim(interim);
  };
  r.onerror = (e) => {
    if (e.error !== 'no-speech' && e.error !== 'aborted') opts.onError(e.message || e.error);
  };
  // Chrome ends continuous sessions after silence; restart until the user stops.
  r.onend = () => {
    if (!stopped) {
      try {
        r.start();
        return;
      } catch {
        /* fall through */
      }
    }
    opts.onEnd();
  };
  r.start();
  return {
    where: opts.local ? 'local' : 'cloud',
    stop() {
      stopped = true;
      r.stop();
    },
  };
}

// ---------------- text-to-speech (protocol steps) ----------------

export function speak(text: string, onEnd?: () => void) {
  if (!('speechSynthesis' in globalThis)) {
    onEnd?.();
    return;
  }
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 0.95;
  // Prefer a local voice so TTS works offline.
  const local = speechSynthesis.getVoices().find((v) => v.localService && v.lang.startsWith('en'));
  if (local) u.voice = local;
  u.onend = () => onEnd?.();
  speechSynthesis.speak(u);
}

export function stopSpeaking() {
  if ('speechSynthesis' in globalThis) speechSynthesis.cancel();
}
