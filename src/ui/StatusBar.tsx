import { useStatus } from './status';
import { onDeviceStatusLabel } from '../firebase/onDevice';
import { downloadOnDeviceModel } from '../firebase/ai';

export function StatusBar() {
  const s = useStatus();
  const canDownload = (s.onDevice === 'downloadable' || s.onDevice === 'downloading') && s.cloudConfigured;
  const startDownload = async () => {
    s.setDownloadProgress(0);
    try {
      await downloadOnDeviceModel((p) => s.setDownloadProgress(p));
    } catch (e) {
      console.warn(e);
    } finally {
      s.setDownloadProgress(null);
      s.refresh();
    }
  };
  return (
    <div className="statusbar" role="status" aria-live="polite">
      <span className={`pill ${s.online ? 'pill-ok' : 'pill-warn'}`} data-testid="net-status">
        {s.online ? '● Online' : '○ Offline'}
      </span>
      <span className={`pill ${s.onDevice === 'available' ? 'pill-ok' : 'pill-muted'}`} data-testid="device-status">
        🔒 {onDeviceStatusLabel(s.onDevice)}
        {s.downloadProgress != null && ` ${Math.round(s.downloadProgress * 100)}%`}
      </span>
      {canDownload && s.downloadProgress == null && (
        <button className="btn-small" onClick={startDownload}>
          Download model
        </button>
      )}
      <span className={`pill ${s.cloudConfigured ? (s.appCheckActive ? 'pill-ok' : 'pill-warn') : 'pill-muted'}`}>
        ☁️ {s.cloudConfigured ? (s.appCheckActive ? 'Cloud + App Check' : 'Cloud (App Check off)') : 'Cloud not configured'}
      </span>
    </div>
  );
}

export function SafetyBanner() {
  return (
    <div className="safety-banner" role="note">
      <strong>Demo content — to be reviewed by our medical advisor. Not medical advice.</strong> Pinpoint never diagnoses or
      chooses treatment: care steps come only from the fixed protocol cards; AI only structures what you say into a draft
      report that you confirm.
    </div>
  );
}
