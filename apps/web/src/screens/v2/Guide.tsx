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

      {/* The map — tap a screen instead of reading about it. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 'var(--s-3)' }}>
        {screens.map((item) => (
          <button
            key={item.to}
            type="button"
            className="card hoverable"
            style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 'var(--s-2)' }}
            onClick={() => navigate(item.to)}
          >
            <StepIcon icon={item.icon} size={36} />
            <span style={{ fontWeight: 700, fontSize: '13px' }}>{item.label}</span>
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
