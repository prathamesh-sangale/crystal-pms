import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { GATE_PHOTO_SLOTS, type GateLogEntry } from '../../lib/mockV2';
import { Icon } from '../crystal/Icon';

/** Drive file ids are opaque, but every link this app ever stores is the
 * same `webViewLink` shape (`.../file/d/{id}/view...`) `uploadToDrive`
 * returns — this is the one place that shape gets parsed back apart,
 * shared by every caller that needs the bare id (the photo proxy, the
 * remove-photo confirm). */
export function extractDriveFileId(url: string): string | null {
  const m = url.match(/\/file\/d\/([^/]+)/);
  return m ? m[1]! : null;
}

/** One photo from a Gate In/Out submission or the ready-to-move set, shown
 * as an actual thumbnail. Shared by the printed Container Report and the
 * drawer's own "Photos" review dialog, so both ever only render a photo one
 * way.
 *
 * A real Drive link (https://drive.google.com/...) is a sign-in-walled
 * viewer *page*, not raw image bytes, and confirmed live that Drive's usual
 * public-embed URL tricks don't work for this Shared Drive's files either
 * (they redirect to accounts.google.com) — so the only way to actually show
 * one is to fetch it, authenticated, through this app's own proxy route and
 * turn the response into an object URL. A `blob:` URL (still used for a
 * locally-picked, not-yet-uploaded file) is already a real image and skips
 * the fetch entirely. */
export function PhotoThumb({ url, label }: { url: string; label: string }): React.ReactElement {
  const [blobUrl, setBlobUrl] = useState<string | null>(url.startsWith('blob:') ? url : null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (url.startsWith('blob:')) {
      setBlobUrl(url);
      return;
    }
    const fileId = extractDriveFileId(url);
    if (!fileId) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setBlobUrl(null);
    let cancelled = false;
    let objectUrl: string | null = null;
    api
      .v2PhotoBlob(fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);

  if (blobUrl) return <img src={blobUrl} alt={label} className="photo-thumb" />;

  if (failed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="photo-thumb"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 'var(--s-1)', color: 'var(--text-2)', textDecoration: 'none' }}
      >
        <Icon name="external" size="md" />
        <span style={{ fontSize: '10.5px', fontWeight: 600 }}>View photo</span>
      </a>
    );
  }

  return (
    <div
      className="photo-thumb"
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)', background: 'var(--surface-2)' }}
    >
      <Icon name="clock" size="md" />
    </div>
  );
}

/** The nine required inspection photos (whichever are actually filled in)
 * plus any additional ones, in display order — the same list a Gate In/Out
 * submission's photo grid always shows. */
export function gateLogPhotoEntries(entry: GateLogEntry): Array<{ label: string; url: string }> {
  return [
    ...GATE_PHOTO_SLOTS.map((slot) => ({ label: slot.label, url: entry.photos[slot.key] })).filter((p) => p.url),
    ...entry.photos.additional.map((url, i) => ({ label: `Additional ${i + 1}`, url })),
  ];
}
