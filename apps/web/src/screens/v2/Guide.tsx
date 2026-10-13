import { useNavigate } from 'react-router-dom';
import { NAV_ITEMS } from '../../lib/nav';
import { Icon, type IconName } from '../../components/crystal/Icon';

interface Step {
  icon: IconName;
  label: string;
}

/** A flow, not a document — icon + 2-4 words each, read in one glance, no
 * sentences to parse. Replaces the earlier paragraph/FAQ versions entirely
 * after direct feedback that text-and-scroll wasn't the right shape for
 * this at all. */
const STEPS: Step[] = [
  { icon: 'truck', label: 'New container' },
  { icon: 'grid', label: 'Sections created' },
  { icon: 'pulse', label: 'Assign & run tasks' },
  { icon: 'upload', label: 'Ready photo' },
  { icon: 'door', label: 'Gate out' },
];

/** One punchy line per screen — the first one (Live Board) gets the most
 * personality on purpose, since it's the one everyone opens first every day. */
const BLURB: Record<string, string> = {
  '/live': "The yard's pulse, live",
  '/yard': 'One container, full picture',
  '/workers': 'Your crew, on record',
  '/dashboards': "Today's numbers, at a glance",
  '/hydra': 'Loading, unloading, shifting — logged',
  '/ims-stock': "What's ready to go, from IMS",
};

const TIPS: Array<{ icon: IconName; text: string }> = [
  { icon: 'search', text: 'Ctrl+K jumps anywhere' },
  { icon: 'shield', text: 'IMS is read-only, always' },
  { icon: 'refresh', text: 'PMS Sheet sync is manual' },
];

function StepIcon({ icon, size = 52 }: { icon: IconName; size?: number }): React.ReactElement {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: 'var(--r-lg)',
        background: 'var(--accent-soft)',
        color: 'var(--accent)',
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
      }}
    >
      <Icon name={icon} size={size > 40 ? 'md' : 'sm'} />
    </span>
  );
}

export function Guide(): React.ReactElement {
  const navigate = useNavigate();
  const screens = NAV_ITEMS.filter((item) => item.to !== '/guide');

  return (
    <div className="stack stack-loose">
      {/* The flow — a glance, not a read. */}
      <div
        className="cluster"
        style={{ gap: 'var(--s-2)', flexWrap: 'wrap', justifyContent: 'center', padding: 'var(--s-4) 0' }}
      >
        {STEPS.map((step, i) => (
          <span key={step.label} className="cluster" style={{ gap: 'var(--s-2)' }}>
            <span className="stack" style={{ alignItems: 'center', gap: '6px', width: '96px' }}>
              <StepIcon icon={step.icon} />
              <span style={{ fontSize: '11.5px', fontWeight: 700, textAlign: 'center', lineHeight: 1.2 }}>
                {step.label}
              </span>
            </span>
            {i < STEPS.length - 1 && (
              <span style={{ color: 'var(--text-3)', opacity: 0.6 }}>
                <Icon name="arrow-right" size="sm" />
              </span>
            )}
          </span>
        ))}
      </div>

      {/* The map — tap a screen instead of reading about it. .stack (not a
          bare inline flex column) on purpose: it's the exact layout utility
          already proven to render icon+label correctly in the flow strip
          above, and it carries min-width:0 — a plain inline flex column on a
          CSS Grid item was leaving these labels unreadably clipped. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--s-3)' }}>
        {screens.map((item) => (
          <button
            key={item.to}
            type="button"
            className="card hoverable stack stack-tight"
            style={{ textAlign: 'left', color: 'var(--text)' }}
            onClick={() => navigate(item.to)}
          >
            <StepIcon icon={item.icon} size={36} />
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text)' }}>{item.label}</span>
            {BLURB[item.to] && (
              <span style={{ fontSize: '11.5px', color: 'var(--text-3)' }}>{BLURB[item.to]}</span>
            )}
          </button>
        ))}
      </div>

      <div className="cluster" style={{ gap: 'var(--s-3)', flexWrap: 'wrap', justifyContent: 'center' }}>
        {TIPS.map((tip) => (
          <span
            key={tip.text}
            className="cluster"
            style={{
              gap: '6px',
              fontSize: '11.5px',
              color: 'var(--text-3)',
              padding: '6px 12px',
              background: 'var(--surface)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--r-full)',
            }}
          >
            <Icon name={tip.icon} size="sm" />
            {tip.text}
          </span>
        ))}
      </div>
    </div>
  );
}
