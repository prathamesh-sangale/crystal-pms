import { GATE_PHOTO_SLOTS, type GateLogEntry } from '../../lib/mockV2';
import { Icon } from '../crystal/Icon';

/** One photo from a Gate In/Out submission or the ready-to-move set, shown
 * as an actual thumbnail where possible. Shared by the printed Container
 * Report and the drawer's own "Photos" review dialog, so both ever only
 * render a photo one way.
 *
 * A real Drive link (https://drive.google.com/...) is a viewer *page*, not
 * raw image bytes — embedding it directly as an <img src> shows a broken
 * image, not the photo. Only a `blob:` URL (the old, pre-upload, in-tab-only
 * representation — shouldn't occur going forward, kept only so an
 * already-open draft from before this change doesn't render broken) can
 * actually be inlined; anything else opens in Drive instead. */
export function PhotoThumb({ url, label }: { url: string; label: string }): React.ReactElement {
  if (url.startsWith('blob:')) {
    return <img src={url} alt={label} className="photo-thumb" />;
  }
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

/** The nine required inspection photos (whichever are actually filled in)
 * plus any additional ones, in display order — the same list a Gate In/Out
 * submission's photo grid always shows. */
export function gateLogPhotoEntries(entry: GateLogEntry): Array<{ label: string; url: string }> {
  return [
    ...GATE_PHOTO_SLOTS.map((slot) => ({ label: slot.label, url: entry.photos[slot.key] })).filter((p) => p.url),
    ...entry.photos.additional.map((url, i) => ({ label: `Additional ${i + 1}`, url })),
  ];
}
