import { useState } from 'preact/hooks';
import { GRAIN_SACKS, TIME, UNLOCKS, sackPrice, waterPrice } from '../config/balance';
import { grainCapacity, grainDays, grainPerDay, waterCapacity, waterDays, waterPerDay } from '../sim/stocks';
import { ROLES } from '../config/staff';
import { startLabel } from '../sim/workers';
import { workerStatus } from './Team';
import { sound } from '../audio/sound';
import { music } from '../audio/music';
import * as A from '../sim/actions';
import { canSkipNight } from '../sim/simulation';
import { dailyDue, totalDebt } from '../sim/bank';
import { season, seasonDay } from '../sim/seasons';
import { ShowLine } from './Show';
import { fertileStock, fertility, incubatingCount, roosterCount, youngCount } from '../sim/breeding';
import { currentDay, currentHour, fmtClock, isNightHour } from '../sim/core';
import { farmLevel, fmtMoney, fmtSigned, levelDef, levelReached, nextLevelDef, sumExpense, sumIncome, today } from '../sim/economy';
import { farmGrass } from '../sim/grass';
import { adultCount, avgOf, buildingsOf, coopCapacity, flockCapacity, landCapacity, lvl, storageCapacity, storedCount } from '../sim/queries';
import { WorkerFace, Bar, Icon, useGame } from './common';

export function LeftPanel() {
  const game = useGame();
  const s = game.state;
  // replié par défaut sur téléphone (en hauteur comme à l'horizontale)
  const [open, setOpen] = useState(() => typeof window === 'undefined' || (window.innerWidth > 820 && window.innerHeight > 540));
  const lv = levelDef(s);
  const next = nextLevelDef(s);
  const xpRatio = next ? (s.xp - lv.xp) / (next.xp - lv.xp) : 1;
  const stock = storedCount(s);
  const cap = storageCapacity(s);
  const waiting = s.worldEggs.length;
  const wellbeing = s.hens.length ? avgOf(s.hens, (h) => h.wellbeing) / 100 : 0;
  const grass = farmGrass(s);
  const d = today(s);
  const net = sumIncome(d) - sumExpense(d);
  const manual = s.buildings.some((b) => (b.type === 'feeder' || b.type === 'drinker') && !lvl(b).auto && b.stock < lvl(b).capacity * 0.6);

  return (
    <aside class={`left-panel card ${open ? '' : 'collapsed'}`}>
      <header class="farm-head" onClick={() => setOpen(!open)} title={open ? 'Réduire le tableau de bord' : 'Ouvrir le tableau de bord'}>
        <div class="logo">
          <Icon name="hen" size={20} />
        </div>
        <div class="farm-title">
          <b>{s.farmName}</b>
          <span>
            Niv. {lv.level} · {lv.title}
          </span>
        </div>
        <div class="rep" title="Réputation : attire les clients et augmente leur budget">
          ★ {Math.round(s.reputation)}
        </div>
        <span class={`lp-toggle ${open ? '' : 'closed'}`} aria-label={open ? 'Replier' : 'Déplier'}>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size={16} />
        </span>
      </header>
      <div class="xp" title={next ? `${s.xp} / ${next.xp} XP` : 'Niveau maximum'}>
        <Bar value={xpRatio} max={1} tone="blue" thin />
        <small>{next ? `${s.xp - lv.xp} / ${next.xp - lv.xp} XP vers le niveau ${next.level}` : 'Niveau maximum atteint'}</small>
      </div>
      {!open && (
        <div class="mini-sum" onClick={() => setOpen(true)}>
          <b class={s.money < 0 ? 'neg' : ''}>{fmtMoney(s.money)}</b>
          <span>
            Poules {adultCount(s)}/{flockCapacity(s)}
          </span>
          <span>Œufs {stock}</span>
          <span class={s.hens.length ? dayTone(grainDays(s)) : ''}>Grain {Math.floor(s.grain)}</span>
          <span class={s.hens.length ? dayTone(waterDays(s)) : ''}>Eau {Math.floor(s.water)} L</span>
          {waiting > 0 && (
            <button class="mini-collect" onClick={(e) => (e.stopPropagation(), game.act(() => A.collectAll(s), 'pop'))}>
              Ramasser {waiting}
            </button>
          )}
        </div>
      )}
      {open && (
        <>
          <section class="lp-cash" title="Ouvrir la banque : comptes et prêts" onClick={() => game.openPanel('finance')}>
            <div>
              <span>Trésorerie</span>
              <b class={s.money < 0 ? 'neg' : ''}>{fmtMoney(s.money)}</b>
            </div>
            <small class={net >= 0 ? 'pos' : 'neg'}>
              {fmtSigned(net)}
              <br />
              aujourd’hui
            </small>
            {s.loans.length > 0 && (
              <div class="lp-debt">
                <span>Prêts : reste {fmtMoney(totalDebt(s))}</span>
                <span>{fmtMoney(dailyDue(s))} / nuit</span>
              </div>
            )}
          </section>
          <section class="lp-sec">
            <div class="row-head">
              <span>Élevage</span>
              <span>Capacité</span>
            </div>
            <Row
              label="Poules"
              value={`${adultCount(s)} / ${flockCapacity(s)}`}
              ratio={adultCount(s) / Math.max(1, flockCapacity(s))}
              tone="blue"
              title={`Poulaillers : ${coopCapacity(s)} places · Terrain : ${landCapacity(s)} poules (les poussins ne prennent pas de place)`}
            />
            <BreedingLine />
            <Row label="Œufs stockés" value={`${stock} / ${cap}`} ratio={stock / Math.max(1, cap)} tone={stock >= cap ? 'bad' : 'blue'} />
            <div class="lp-duo">
              <MiniGauge label="Bien-être" value={wellbeing} />
              <MiniGauge label="Herbe" value={grass} />
            </div>
            <div class="lp-actions">
              <button class={`lp-act ${waiting ? 'hot' : ''}`} data-tut="collect" disabled={!waiting} onClick={() => game.act(() => A.collectAll(s), 'pop')} title="Ramasser tous les œufs (R)">
                <Icon name="basket" size={16} />
                <span>Ramasser</span>
                <b>{waiting}</b>
              </button>
              <button class={`lp-act ${manual ? 'hot' : ''}`} onClick={() => game.act(() => A.refillAll(s), 'water')} title="Remplir mangeoires et abreuvoirs">
                <Icon name="drop" size={16} />
                <span>Tout remplir</span>
              </button>
            </div>
          </section>
          <ShowLine />
          {s.workers.length > 0 && <StaffStrip />}
          <section class="lp-sec journal">
            <div class="row-head">
              <span>Journal</span>
              <button class="link" onClick={() => game.openPanel('finance')}>
                Banque
              </button>
            </div>
            {s.finance.log.slice(0, 2).map((l, i) => (
              <div class="jl" key={i}>
                <span class="jd">J{l.day}</span>
                <span class="jt">{l.label}</span>
                <span class={l.amount >= 0 ? 'pos' : 'neg'}>{fmtSigned(l.amount)}</span>
              </div>
            ))}
            {s.finance.log.length === 0 && <div class="jl muted">Aucune opération pour l’instant</div>}
          </section>
          <section class="lp-sec">
            <div class="row-head">
              <span>Réserves</span>
              <span>Autonomie</span>
            </div>
            <div class="lp-stocks">
              <StockCard kind="grain" />
              <StockCard kind="water" />
            </div>
          </section>
        </>
      )}
    </aside>
  );
}

const dayTone = (d: number) => (d < 1 ? 'bad' : d < 2.5 ? 'warn' : 'good');

/**
 * Réserve et distribution regroupées : la réserve de grain alimente les mangeoires,
 * la cuve alimente les abreuvoirs. Autonomie, consommation et achat rapide au même endroit.
 */
function StockCard({ kind }: { kind: 'grain' | 'water' }) {
  const game = useGame();
  const s = game.state;
  const grain = kind === 'grain';
  const cap = grain ? grainCapacity(s) : waterCapacity(s);
  const have = grain ? s.grain : s.water;
  const days = grain ? grainDays(s) : waterDays(s);
  const perDay = grain ? grainPerDay(s) : waterPerDay(s);
  const dist = buildingsOf(s, grain ? 'feeder' : 'drinker');
  const fill = dist.length ? avgOf(dist, (b) => b.stock / lvl(b).capacity) : 0;
  const auto = grain ? s.settings.autoGrain : s.settings.autoWater;
  let label = '';
  let price = '';
  let title = '';
  let buy: (() => void) | null = null;
  if (grain) {
    // plus gros sac débloqué qui rentre dans la réserve et que l'on peut payer
    const room = cap - s.grain;
    const fitting = GRAIN_SACKS.filter((g) => levelReached(s, g.reqLevel) && g.rations <= room);
    const sack = [...fitting].reverse().find((g) => sackPrice(g, s.market.grainIndex) <= s.money) ?? fitting[0];
    if (sack) {
      label = `+${sack.rations}`;
      price = fmtMoney(sackPrice(sack, s.market.grainIndex));
      title = `Acheter un ${sack.name.toLowerCase()} (${sack.rations} rations)`;
      buy = () => game.act(() => A.buyGrain(s, sack.id), 'grain');
    } else label = 'Plein';
  } else {
    const missing = Math.floor(cap - s.water);
    if (missing >= 1) {
      label = 'Remplir';
      price = fmtMoney(waterPrice(missing));
      title = `Remplir la cuve (${missing} L)`;
      buy = () => game.act(() => A.fillTank(s), 'water');
    } else label = 'Pleine';
  }
  return (
    <div class={`stock ${kind} ${s.hens.length ? dayTone(days) : ''}`} onClick={() => game.openPanel('shop', 'grain')} title={grain ? 'Réserve de grain — cliquer pour gérer' : 'Cuve d’eau — cliquer pour gérer'}>
      <div class="st-top">
        <div class={`vessel ${grain ? 'silo' : 'tank'}`}>
          <i style={{ height: `${Math.min(100, (have / cap) * 100)}%` }} />
        </div>
        <b>{grain ? 'Grain' : 'Eau'}</b>
        {auto && <i class="auto">AUTO</i>}
        <span class="st-days">≈ {daysLabel(days)}</span>
      </div>
      <div class="st-line">
        <strong>{Math.floor(have)}</strong>
        <small>
          / {cap} {grain ? '' : 'L'} · −{rate(perDay)}/j
        </small>
      </div>
      <div class="st-dist" title={grain ? `Mangeoires remplies à ${Math.round(fill * 100)} %` : `Abreuvoirs remplis à ${Math.round(fill * 100)} %`}>
        <span>{grain ? 'Mangeoires' : 'Abreuvoirs'}</span>
        <Bar value={fill} max={1} tone="auto" thin />
      </div>
      <button
        class="st-buy"
        disabled={!buy}
        title={title || (grain ? 'Réserve pleine' : 'Cuve pleine')}
        onClick={(e) => {
          e.stopPropagation();
          buy?.();
        }}
      >
        <b>{label}</b>
        {price && <small>{price}</small>}
      </button>
    </div>
  );
}

function MiniGauge({ label, value }: { label: string; value: number }) {
  return (
    <div class="mg">
      <div class="mg-top">
        <span>{label}</span>
        <b>{Math.round(Math.max(0, Math.min(1, value)) * 100)} %</b>
      </div>
      <Bar value={value} max={1} tone="auto" thin />
    </div>
  );
}

/** Portraits de l'équipe : chacun reste visible, même à la maison ou caché par un bâtiment. */
function StaffStrip() {
  const game = useGame();
  const s = game.state;
  const onSite = s.workers.filter((w) => w.onSite).length;
  return (
    <section class="staff-strip">
      <div class="row-head">
        <span>Équipe</span>
        <span>
          {onSite}/{s.workers.length} sur place
        </span>
      </div>
      <div class="avatars">
        {s.workers.map((w) => {
          const def = ROLES[w.role];
          const st = workerStatus(w);
          const commuting = w.job?.kind === 'commuteIn' || w.job?.kind === 'commuteOut';
          const state = !w.onSite ? 'home' : commuting ? 'road' : w.job?.kind === 'waitCoop' || w.job?.kind === 'closeCoop' ? 'night' : 'work';
          const selected = game.selection?.kind === 'worker' && game.selection.id === w.id;
          return (
            <button
              key={w.id}
              class={`ava ${state} ${selected ? 'sel' : ''}`}
              title={`${w.name} — ${def.title} : ${st.label}`}
              onClick={() => {
                if (!w.onSite) return game.toast(`${w.name} est à la maison : retour à ${startLabel(w.role)}.`, 'info');
                game.select({ kind: 'worker', id: w.id });
                game.follow = true;
                game.renderer.setZoom(Math.max(game.renderer.zoom, 2.2));
              }}
            >
              <span class="ava-ic" style={{ background: '#' + def.outfit.shirt.toString(16).padStart(6, '0') }}>
                <WorkerFace role={w.role} look={w.look} name={w.name} size={16} />
                <i class="dot" />
              </span>
              <small>{w.name}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function Row(props: { label: string; value: string; ratio: number; tone: 'blue' | 'auto' | 'bad'; sub?: string; title?: string }) {
  return (
    <div class="srow" title={props.title}>
      <div class="srow-top">
        <span>{props.label}</span>
        <b>
          {props.value}
          {props.sub && <small> {props.sub}</small>}
        </b>
      </div>
      <Bar value={props.ratio} max={1} tone={props.tone} thin />
    </div>
  );
}

export function TopRight() {
  const game = useGame();
  const s = game.state;
  const h = currentHour(s);
  const night = isNightHour(h);
  const open = h >= TIME.SHOP_OPEN && h < TIME.SHOP_CLOSE;
  const sea = season(s);
  const speeds: Array<[number, string, string]> = [
    [0, 'pause', 'Pause (Espace)'],
    [1, 'play', 'Vitesse normale (1)'],
    [3, 'fast', 'Accéléré ×3 (2)'],
    [10, 'faster', 'Très rapide ×10 (3)'],
  ];
  return (
    <div class="top-right">
      <div class="clock card" data-tut="speed">
        <div class="clock-time">
          <span class={`sunmoon ${night ? 'night' : ''}`}>
            <Icon name={night ? 'moon' : 'sun'} size={18} />
          </span>
          <div>
            <b>
              Jour {currentDay(s)}
              <em class="season-pill" title={`${sea.name} (jour ${seasonDay(s)}/7) — ${sea.intro}`}>
                <i class={`sea-dot ${sea.id}`} />
                {sea.name}
              </em>
            </b>
            <span>
              {fmtClock(s.clock.t)}
              <em class="clock-status"> · {open ? 'Étal ouvert' : night ? 'Nuit' : 'Étal fermé'}</em>
            </span>
          </div>
        </div>
        <div class="speeds">
          {speeds.map(([v, icon, title]) => (
            <button key={v} class={s.clock.speed === v ? 'on' : ''} title={title} onClick={() => game.setSpeed(v)}>
              <Icon name={icon} size={15} />
            </button>
          ))}
        </div>
        {canSkipNight(s) && (
          <button class="skip-night" title="Passer directement au matin, 6 h 30 (N)" disabled={game.skipping} onClick={() => game.skipNight()}>
            <Icon name="moon" size={14} />
            <span>Passer la nuit</span>
          </button>
        )}
      </div>
      <div class="mini-btns">
        <button
          class={`card icon-btn ${s.settings.music ? '' : 'off'}`}
          title={s.settings.music ? 'Couper la musique' : 'Activer la musique'}
          onClick={() => {
            s.settings.music = !s.settings.music;
            music.setEnabled(s.settings.music);
            game.changed();
          }}
        >
          <Icon name={s.settings.music ? 'music' : 'musicOff'} />
        </button>
        <button
          class="card icon-btn"
          title={s.settings.sound ? 'Couper le son' : 'Activer le son'}
          onClick={() => {
            s.settings.sound = !s.settings.sound;
            sound.enabled = s.settings.sound;
            sound.unlock();
            game.changed();
          }}
        >
          <Icon name={s.settings.sound ? 'sound' : 'mute'} />
        </button>
        <button
          class={`card icon-btn fs-btn ${document.fullscreenEnabled ? 'can' : ''}`}
          title="Plein écran"
          onClick={() => {
            if (document.fullscreenElement) void document.exitFullscreen();
            else
              void document.documentElement
                .requestFullscreen({ navigationUI: 'hide' })
                .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape'))
                .catch(() => undefined);
          }}
        >
          <Icon name="fullscreen" />
        </button>
        <button class="card icon-btn" title="Réglages" onClick={() => game.openPanel('settings')}>
          <Icon name="gear" />
        </button>
      </div>
    </div>
  );
}

export function Dock() {
  const game = useGame();
  const s = game.state;
  const lvlN = farmLevel(s);
  const orders = s.orders.filter((o) => o.status === 'offer').length + s.contracts.filter((c) => c.status === 'offer').length;
  const watch = s.hens.filter((h) => h.sick || h.health < 40 || h.satiety < 30 || h.hydration < 30).length;
  const items: Array<{ id: 'shop' | 'market' | 'finance' | 'missions' | 'hens' | 'team'; icon: string; label: string; badge?: number; tut?: string }> = [
    { id: 'shop', icon: 'shop', label: 'Boutique', tut: 'shop' },
    { id: 'market', icon: 'sell', label: 'Vente', badge: lvlN >= UNLOCKS.orders ? orders : 0, tut: 'market' },
    { id: 'hens', icon: 'hen', label: 'Poules', badge: watch },
    { id: 'team', icon: 'team', label: 'Équipe' },
    { id: 'finance', icon: 'bank', label: 'Banque' },
    { id: 'missions', icon: 'flag', label: 'Missions' },
  ];
  return (
    <nav class="dock card">
      {items.map((it) => (
        <button key={it.id} class={game.panel === it.id ? 'on' : ''} data-tut={it.tut} title={it.label} onClick={() => game.openPanel(it.id)}>
          <Icon name={it.icon} size={20} />
          <span>{it.label}</span>
          {!!it.badge && <i class="badge">{it.badge}</i>}
        </button>
      ))}
      <div class="dock-sep" />
      <button title="Zoom avant" onClick={() => game.renderer.setZoom(game.renderer.zoom * 1.25)}>
        <Icon name="zoomin" size={18} />
      </button>
      <button title="Zoom arrière" onClick={() => game.renderer.setZoom(game.renderer.zoom / 1.25)}>
        <Icon name="zoomout" size={18} />
      </button>
      <button title="Recentrer sur la ferme" onClick={() => game.goHome()}>
        <Icon name="home" size={18} />
      </button>
    </nav>
  );
}

function daysLabel(d: number) {
  if (!Number.isFinite(d)) return '—';
  if (d >= 30) return '30 j +';
  return `${d.toLocaleString('fr-FR', { maximumFractionDigits: d < 10 ? 1 : 0 })} j`;
}

const rate = (v: number) => v.toLocaleString('fr-FR', { maximumFractionDigits: v < 10 ? 1 : 0 });

/** Coqs, jeunes et œufs en couvaison (affiché seulement quand la ferme fait naître des poussins). */
function BreedingLine() {
  const game = useGame();
  const s = game.state;
  const roosters = roosterCount(s);
  const young = youngCount(s);
  const hatching = incubatingCount(s);
  const fertile = fertileStock(s);
  if (!roosters && !young && !hatching && !fertile) return null;
  const parts: string[] = [];
  if (roosters) parts.push(`${roosters} coq${roosters > 1 ? 's' : ''}`);
  if (young) parts.push(`${young} jeune${young > 1 ? 's' : ''}`);
  if (fertile) parts.push(`${fertile} œuf${fertile > 1 ? 's' : ''} fécondé${fertile > 1 ? 's' : ''} au stockage`);
  if (hatching) parts.push(`${hatching} en couveuse`);
  return (
    <div class="lp-note" title={`${Math.round(fertility(s) * 100)} % des œufs pondus sont fécondés`}>
      {parts.join(' · ')}
    </div>
  );
}

