import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useReducer } from 'preact/hooks';
import { EGG_TYPES } from '../config/balance';
import type { Game } from '../game';
import type { EggType } from '../sim/types';

export const GameCtx = createContext<Game>(null as unknown as Game);

/** Accès au jeu + rafraîchissement à chaque changement notifié. */
export function useGame() {
  const game = useContext(GameCtx);
  const [, force] = useReducer((x: number) => x + 1, 0);
  useEffect(() => {
    const off = game.subscribe(() => force(0));
    return () => {
      off();
    };
  }, [game]);
  return game;
}

export function Bar({ value, max = 100, tone, thin }: { value: number; max?: number; tone?: 'good' | 'warn' | 'bad' | 'blue' | 'auto'; thin?: boolean }) {
  const r = Math.max(0, Math.min(1, max > 0 ? value / max : 0));
  const t = tone === 'auto' || !tone ? (r < 0.25 ? 'bad' : r < 0.5 ? 'warn' : 'good') : tone;
  return (
    <div class={`bar ${thin ? 'thin' : ''}`}>
      <i class={t} style={{ width: `${(r * 100).toFixed(1)}%` }} />
    </div>
  );
}

export function Btn(props: {
  children: ComponentChildren;
  onClick?: () => void;
  kind?: 'primary' | 'ghost' | 'danger' | 'soft' | 'good';
  disabled?: boolean;
  title?: string;
  small?: boolean;
  block?: boolean;
  tut?: string;
}) {
  return (
    <button
      class={`btn ${props.kind ?? 'soft'} ${props.small ? 'small' : ''} ${props.block ? 'block' : ''}`}
      disabled={props.disabled}
      title={props.title}
      data-tut={props.tut}
      onClick={(e) => {
        e.stopPropagation();
        props.onClick?.();
      }}
    >
      {props.children}
    </button>
  );
}

export function Chip({ children, tone = 'neutral' }: { children: ComponentChildren; tone?: string }) {
  return <span class={`chip ${tone}`}>{children}</span>;
}

export function EggDot({ type, size = 12 }: { type: EggType; size?: number }) {
  const c = '#' + EGG_TYPES[type].color.toString(16).padStart(6, '0');
  return <span class="eggdot" style={{ background: c, width: `${size * 0.8}px`, height: `${size}px` }} />;
}

export function Ring({ value, size = 54, stroke = 6, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  return (
    <div class="ring" style={{ width: `${size}px`, height: `${size}px` }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--line)" stroke-width={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke="var(--blue)"
          stroke-width={stroke}
          fill="none"
          stroke-linecap="round"
          stroke-dasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <span>{label ?? `${Math.round(v * 100)} %`}</span>
    </div>
  );
}

export function Meter({ value, label }: { value: number; label: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div class="meter">
      <div class="meter-val">{Math.round(v * 100)} %</div>
      <div class="meter-tube">
        <i style={{ height: `${v * 100}%` }} class={v < 0.3 ? 'bad' : v < 0.55 ? 'warn' : 'good'} />
      </div>
      <div class="meter-label">{label}</div>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ComponentChildren; sub?: ComponentChildren }) {
  return (
    <div class="stat">
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: Array<{ id: string; label: string; badge?: number; locked?: boolean }>; active: string; onChange: (id: string) => void }) {
  return (
    <div class="tabs">
      {tabs.map((t) => (
        <button key={t.id} class={`tab ${active === t.id ? 'on' : ''} ${t.locked ? 'locked' : ''}`} onClick={() => onChange(t.id)}>
          {t.locked && <Icon name="lock" size={12} />}
          {t.label}
          {!!t.badge && <i class="badge">{t.badge}</i>}
        </button>
      ))}
    </div>
  );
}

/** Icônes vectorielles de l'interface (style trait). */
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;
  switch (name) {
    case 'pause':
      return (
        <svg {...p}>
          <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
          <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'play':
      return (
        <svg {...p}>
          <path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'fast':
      return (
        <svg {...p}>
          <path d="M3 6l9 6-9 6zM12 6l9 6-9 6z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'faster':
      return (
        <svg {...p}>
          <path d="M2 6l7 6-7 6zM9 6l7 6-7 6zM16 6l6 6-6 6z" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'shop':
      return (
        <svg {...p}>
          <path d="M4 9l1.5-5h13L20 9M4 9h16v10a1 1 0 01-1 1H5a1 1 0 01-1-1zM9 13h6" />
        </svg>
      );
    case 'sell':
      return (
        <svg {...p}>
          <path d="M3 11l8-8h7l3 3v7l-8 8z" />
          <circle cx="16" cy="8" r="1.5" />
        </svg>
      );
    case 'alert':
      return (
        <svg {...p}>
          <path d="M12 3l9.5 17h-19z" />
          <path d="M12 10v4.5M12 17.5v.01" />
        </svg>
      );
    case 'info':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v6M12 7.5v.01" />
        </svg>
      );
    case 'trophy':
      return (
        <svg {...p}>
          <path d="M7 4h10v5a5 5 0 0 1-10 0z" />
          <path d="M7 6H4v1.5A3.5 3.5 0 0 0 7.5 11M17 6h3v1.5A3.5 3.5 0 0 1 16.5 11M12 14v4M8.5 21h7M9.5 18h5" />
        </svg>
      );
    case 'egg':
      return (
        <svg {...p}>
          <path d="M12 3c3.6 0 6.5 5.4 6.5 10a6.5 6.5 0 0 1-13 0C5.5 8.4 8.4 3 12 3z" />
        </svg>
      );
    case 'broom':
      return (
        <svg {...p}>
          <path d="M19 3l-7.5 7.5M9 10l5 5-2.5 6.5c-2.5-.5-6-2.5-8.5-6z" />
          <path d="M7 16l2.5-2.5" />
        </svg>
      );
    case 'move':
      return (
        <svg {...p}>
          <path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3" />
        </svg>
      );
    case 'sprout':
      return (
        <svg {...p}>
          <path d="M12 21v-9M12 12C12 7 8.5 5 4 5c0 4.5 3 7 8 7zM12 14c0-4 3-6.5 8-6.5 0 4-3 6.5-8 6.5z" />
        </svg>
      );
    case 'star':
      return (
        <svg {...p}>
          <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
        </svg>
      );
    case 'pauseCircle':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 9v6M14 9v6" />
        </svg>
      );
    case 'heart':
      return (
        <svg {...p}>
          <path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />
        </svg>
      );
    case 'bank':
      return (
        <svg {...p}>
          <path d="M3 10l9-6 9 6M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M2.5 18h19" />
        </svg>
      );
    case 'chart':
      return (
        <svg {...p}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      );
    case 'target':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v5M12 18v5M1 12h5M18 12h5" />
        </svg>
      );
    case 'lock':
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 018 0v4" />
        </svg>
      );
    case 'unlock':
      return (
        <svg {...p}>
          <rect x="5" y="11" width="14" height="10" rx="2" />
          <path d="M8 11V7a4 4 0 017.6-1.8" />
        </svg>
      );
    case 'flag':
      return (
        <svg {...p}>
          <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
        </svg>
      );
    case 'gear':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
        </svg>
      );
    case 'sound':
      return (
        <svg {...p}>
          <path d="M11 5L6 9H2v6h4l5 4zM15.5 8.5a5 5 0 010 7M19 5a10 10 0 010 14" />
        </svg>
      );
    case 'mute':
      return (
        <svg {...p}>
          <path d="M11 5L6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6" />
        </svg>
      );
    case 'close':
      return (
        <svg {...p}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    case 'basket':
      return (
        <svg {...p}>
          <path d="M3 10h18l-2 9H5zM8 10l4-6 4 6" />
        </svg>
      );
    case 'drop':
      return (
        <svg {...p}>
          <path d="M12 3s6 7 6 11a6 6 0 01-12 0c0-4 6-11 6-11z" />
        </svg>
      );
    case 'check':
      return (
        <svg {...p}>
          <path d="M5 12l5 5 9-10" />
        </svg>
      );
    case 'fence':
      return (
        <svg {...p}>
          <path d="M4 21V6l2-3 2 3v15M16 21V6l2-3 2 3v15M4 10h16M4 16h16" />
        </svg>
      );
    case 'bot':
      return (
        <svg {...p}>
          <ellipse cx="12" cy="15" rx="9" ry="5" />
          <path d="M3 15v1.5c0 2.8 4 5 9 5s9-2.2 9-5V15M12 10V6M10 4h4" />
        </svg>
      );
    case 'wheat':
      return (
        <svg {...p}>
          <path d="M12 21V9M12 13c-3 0-5-2-5-5 3 0 5 2 5 5zM12 13c3 0 5-2 5-5-3 0-5 2-5 5zM12 9c-2 0-3.5-1.5-3.5-4C10.5 5 12 6.5 12 9zM12 9c2 0 3.5-1.5 3.5-4-2 0-3.5 1.5-3.5 4z" />
        </svg>
      );
    case 'map':
      return (
        <svg {...p}>
          <path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
        </svg>
      );
    case 'hammer':
      return (
        <svg {...p}>
          <path d="M14 6l4 4M3 21l9-9M12 4l5-1 4 4-1 5-3-3-4 4-4-4 4-4z" />
        </svg>
      );
    case 'sun':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      );
    case 'moon':
      return (
        <svg {...p}>
          <path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z" />
        </svg>
      );
    case 'zoomin':
      return (
        <svg {...p}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case 'zoomout':
      return (
        <svg {...p}>
          <path d="M5 12h14" />
        </svg>
      );
    case 'music':
      return (
        <svg {...p}>
          <path d="M9 18V5l11-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="17" cy="16" r="3" />
        </svg>
      );
    case 'musicOff':
      return (
        <svg {...p}>
          <path d="M9 18V5l11-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="17" cy="16" r="3" />
          <path d="M3 3l18 18" />
        </svg>
      );
    case 'hen':
      return (
        <svg {...p}>
          <path d="M7 19c-2.5-1-4-3.6-3.5-6.5L5 9l2.5 1.5C8 8 9.5 6 12 6c1.2 0 2.2.4 3 1l1-2 1 2.5h2l-1.5 2c.4.7.5 1.5.5 2.3 0 4.2-3.4 7.2-7.6 7.2H7z" />
          <circle cx="14.5" cy="10" r=".6" fill="currentColor" />
          <path d="M9 19v2M12 19v2" />
        </svg>
      );
    case 'team':
      return (
        <svg {...p}>
          <circle cx="9" cy="8" r="3" />
          <path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6" />
          <circle cx="17" cy="9" r="2.4" />
          <path d="M16 14c2.8 0 5 2.2 5 5" />
        </svg>
      );
    case 'follow':
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
        </svg>
      );
    case 'home':
      return (
        <svg {...p}>
          <path d="M3 11l9-7 9 7M5 10v10h14V10" />
        </svg>
      );
    case 'chevronUp':
      return (
        <svg {...p}>
          <path d="M6 15l6-6 6 6" />
        </svg>
      );
    case 'chevronDown':
      return (
        <svg {...p}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      );
    default:
      return null;
  }
}

export const pct = (v: number) => `${Math.round(v * 100)} %`;
export const n1 = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 });

/** Pictogramme d'un métier (dessiné, pas d'emoji). */
const ROLE_ICON: Record<string, string> = { farmhand: 'basket', seller: 'sell', caretaker: 'heart', gardener: 'sprout' };
export function RoleIcon({ role, size = 18 }: { role: string; size?: number }) {
  return <Icon name={ROLE_ICON[role] ?? 'team'} size={size} />;
}
