import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { getOnDeviceStatus } from '../firebase/onDevice';
import type { OnDeviceStatus } from '../firebase/privacyRouter';
import { getSpeechStatus, type SpeechStatus } from '../features/speech/speech';
import { isFirebaseConfigured, getFirebase, ensureSignedIn } from '../firebase/init';
import { getKV, setKV } from '../features/incident/db';

export interface Settings {
  /** Default for new incidents. OFF by default — patient data stays on device. */
  allowCloudForPHIDefault: boolean;
  autoStructure: boolean;
  readStepsAloud: boolean;
}
const DEFAULT_SETTINGS: Settings = { allowCloudForPHIDefault: false, autoStructure: true, readStepsAloud: true };

interface AppStatus {
  online: boolean;
  onDevice: OnDeviceStatus;
  speech: SpeechStatus;
  cloudConfigured: boolean;
  appCheckActive: boolean;
  uid: string | null;
  settings: Settings;
  setSettings: (s: Partial<Settings>) => void;
  refresh: () => Promise<void>;
  downloadProgress: number | null;
  setDownloadProgress: (p: number | null) => void;
}

const Ctx = createContext<AppStatus | null>(null);

export function StatusProvider({ children }: { children: ReactNode }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [onDevice, setOnDevice] = useState<OnDeviceStatus>('no-api');
  const [speech, setSpeech] = useState<SpeechStatus>({ kind: 'none' });
  const [uid, setUid] = useState<string | null>(null);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setOnDevice(await getOnDeviceStatus());
    setSpeech(await getSpeechStatus());
  }, []);

  useEffect(() => {
    getKV('settings', DEFAULT_SETTINGS).then((s) => setSettingsState({ ...DEFAULT_SETTINGS, ...s }));
    refresh();
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    addEventListener('online', on);
    addEventListener('offline', off);
    const t = setInterval(refresh, 5000);
    if (isFirebaseConfigured) {
      getFirebase();
      ensureSignedIn().then((u) => setUid(u?.uid ?? null));
    }
    return () => {
      removeEventListener('online', on);
      removeEventListener('offline', off);
      clearInterval(t);
    };
  }, [refresh]);

  useEffect(() => {
    if (online && isFirebaseConfigured && !uid) ensureSignedIn().then((u) => setUid(u?.uid ?? null));
  }, [online, uid]);

  const setSettings = useCallback((s: Partial<Settings>) => {
    setSettingsState((prev) => {
      const next = { ...prev, ...s };
      setKV('settings', next);
      return next;
    });
  }, []);

  return (
    <Ctx.Provider
      value={{
        online,
        onDevice,
        speech,
        cloudConfigured: isFirebaseConfigured,
        appCheckActive: !!getFirebase()?.appCheck,
        uid,
        settings,
        setSettings,
        refresh,
        downloadProgress,
        setDownloadProgress,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useStatus(): AppStatus {
  const c = useContext(Ctx);
  if (!c) throw new Error('StatusProvider missing');
  return c;
}
