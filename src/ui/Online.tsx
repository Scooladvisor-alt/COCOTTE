// Interface du registre en ligne : nom de ferme unique, classement, visites.
import { useEffect, useState } from 'preact/hooks';
import { deserialize } from '../save/save';
import { NAME_RE, OnlineError, SECRET_MIN, claimFarm, farmStats, identity, lastPushOk, loadBoard, pushFarm, restoreFarm, sendGreeting, setIdentity, type BoardRow, type BoardSort } from '../online/farms';
import { ROLES, ROLE_ORDER } from '../config/staff';
import { currentDay } from '../sim/core';
import { adultCount } from '../sim/queries';
import { fmtMoney, fmtSigned, levelDef, nextLevelDef, sumExpense, sumIncome, today } from '../sim/economy';
import { season } from '../sim/seasons';
import type { GameState } from '../sim/types';
import { Btn, Icon, Tabs, useGame } from './common';

export type FormMode = 'create' | 'join' | 'restore';

interface FormDone {
  name: string;
  /** Ferme retrouvée en ligne (mode « restore », si elle a déjà été sauvegardée). */
  state?: GameState;
}

/**
 * Formulaire nom de ferme + code secret. Créer / inscrire : le nom doit être libre (personne d'autre
 * ne peut le prendre). Retrouver : nom + code redonnent sa ferme sur n'importe quel appareil.
 */
export function OnlineForm({ mode, initialName = '', onDone, onCancel, cancelLabel = 'Retour' }: { mode: FormMode; initialName?: string; onDone: (r: FormDone) => void; onCancel?: () => void; cancelLabel?: string }) {
  const [name, setName] = useState(initialName);
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const restore = mode === 'restore';

  const submit = async (e: Event) => {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    setError('');
    if (!NAME_RE.test(n)) return setError('Le nom de la ferme doit faire 3 à 24 caractères (lettres, chiffres, espaces, - . _ ’).');
    if (secret.length < SECRET_MIN) return setError(`Le code secret doit faire au moins ${SECRET_MIN} caractères.`);
    setBusy(true);
    try {
      if (restore) {
        const save = await restoreFarm(n, secret);
        const state = save ? deserialize(save) : null;
        // le nom tapé peut différer par les majuscules : on garde l'orthographe de la ferme
        const exact = state && state.farmName.toLowerCase() === n.toLowerCase() ? state.farmName : n;
        setIdentity({ name: exact, secret });
        onDone({ name: exact, state: state ?? undefined });
      } else {
        const r = await claimFarm(n, secret);
        if (r === 'taken') return setError('Ce nom de ferme est déjà pris : choisissez-en un autre.');
        if (r !== 'ok') return setError('Nom ou code refusé : vérifiez les caractères utilisés.');
        setIdentity({ name: n, secret });
        onDone({ name: n });
      }
    } catch (err) {
      const msg = err instanceof OnlineError ? err.message : '';
      if (msg === 'unknown') setError('Aucune ferme à ce nom.');
      else if (msg === 'denied') setError('Code secret incorrect.');
      else setError('Pas de connexion au serveur : impossible de continuer pour l’instant. Vérifiez votre réseau et réessayez.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form class="ofarm" onSubmit={submit}>
      <label>
        <span>{restore ? 'Nom de votre ferme' : 'Nom de votre ferme (unique)'}</span>
        <input type="text" value={name} maxLength={24} autoFocus placeholder="Ferme des Coquelicots" autocomplete="off" onInput={(e) => setName((e.target as HTMLInputElement).value)} />
      </label>
      <label>
        <span>{restore ? 'Votre code secret' : `Code secret (${SECRET_MIN} caractères minimum)`}</span>
        <input type="password" value={secret} maxLength={64} placeholder="••••" autocomplete="off" onInput={(e) => setSecret((e.target as HTMLInputElement).value)} />
      </label>
      {!restore && <small class="ofarm-hint">Ce nom et ce code sont vos seuls accès à votre ferme : notez-les bien, sans eux elle est perdue. N’utilisez pas un vrai mot de passe.</small>}
      {error && <p class="ofarm-err">{error}</p>}
      <div class="ofarm-actions">
        <Btn kind="primary" disabled={busy} type="submit">
          {busy ? 'Un instant…' : restore ? 'Retrouver ma ferme' : mode === 'join' ? 'Inscrire ma ferme' : 'Créer ma ferme'}
        </Btn>
        {onCancel && (
          <Btn kind="ghost" onClick={onCancel}>
            {cancelLabel}
          </Btn>
        )}
      </div>
    </form>
  );
}

/** Réglages : la sauvegarde en ligne de la ferme. */
export function OnlineSettings() {
  const game = useGame();
  const id = identity();
  const [msg, setMsg] = useState('');
  const last = lastPushOk();
  const ago = last ? Math.round((Date.now() - last) / 60000) : -1;
  return (
    <>
      <h5>Sauvegarde</h5>
      <p class="hint">
        {id ? (
          <>
            Ferme inscrite sous le nom <b>{id.name}</b>.{' '}
          </>
        ) : null}
        Elle se sauvegarde toute seule, dans ce navigateur et en ligne. Pour la retrouver sur un autre appareil : « J’ai déjà une ferme en ligne » sur l’écran d’accueil, avec son nom et son code secret. Sans ce code, impossible de la récupérer : notez-le bien.
      </p>
      <div class="actions">
        <Btn
          kind="soft"
          onClick={async () => {
            if (!game.persist) return setMsg('Partie de démonstration : rien n’est sauvegardé.');
            setMsg('Sauvegarde…');
            game.save();
            const r = await pushFarm(game.state, true);
            setMsg(r === 'ok' ? 'Ferme sauvegardée en ligne ✓' : r === 'denied' ? 'Code secret refusé par le serveur.' : r === 'skipped' ? 'Sauvegardée sur cet appareil ; l’envoi en ligne repart dans un instant.' : 'Pas de connexion : sauvegardée sur cet appareil, l’envoi en ligne attendra.');
          }}
        >
          Sauvegarder maintenant
        </Btn>
        <small class="muted">{msg || (ago < 0 ? 'Prochain envoi en ligne dans un instant.' : ago < 1 ? 'Dernier envoi en ligne : à l’instant.' : `Dernier envoi en ligne : il y a ${ago} min.`)}</small>
      </div>
    </>
  );
}

// ------------------------------------------------------------ Classement ----
const SORTS: Array<{ id: BoardSort; label: string }> = [
  { id: 'level', label: 'Niveau' },
  { id: 'laying', label: 'Taux de ponte' },
  { id: 'wellbeing', label: 'Bien-être' },
];

const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1));

function metric(sort: BoardSort, r: BoardRow) {
  if (sort === 'laying') return `${Math.round(r.laying_rate * 100)} %`;
  if (sort === 'wellbeing') return `${Math.round(r.wellbeing)} %`;
  return `Niv. ${r.level}`;
}

export function RankingPanel() {
  const game = useGame();
  const [sort, setSort] = useState<BoardSort>('level');
  const [rows, setRows] = useState<BoardRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState('');
  const me = identity()?.name.toLowerCase();
  const here = game.visiting?.name.toLowerCase();

  const load = () => {
    setRows(null);
    setFailed(false);
    loadBoard(sort, 50)
      .then(setRows)
      .catch(() => setFailed(true));
  };
  useEffect(load, [sort]);

  const visit = async (name: string) => {
    setBusy(name);
    const ok = await game.visitFarm(name);
    setBusy('');
    if (ok) game.openPanel(null);
  };

  return (
    <div class="panel-body ranking">
      <Tabs tabs={SORTS} active={sort} onChange={(id) => setSort(id as BoardSort)} />
      <p class="hint">
        {sort === 'level' ? 'Les meilleurs éleveurs, par niveau.' : sort === 'laying' ? 'Taux de ponte moyen des pondeuses (fermes d’au moins 10 volailles).' : 'Bien-être moyen du troupeau (fermes d’au moins 10 volailles).'} Cliquez sur « Visiter » pour vous promener dans une ferme.
      </p>
      {failed && (
        <div class="empty">
          <p>Impossible de charger le classement : vérifiez votre connexion.</p>
          <Btn kind="soft" onClick={load}>
            Réessayer
          </Btn>
        </div>
      )}
      {!failed && !rows && <p class="empty">Chargement…</p>}
      {rows && rows.length === 0 && <p class="empty">Personne au classement pour l’instant : soyez le premier !</p>}
      {rows && rows.length > 0 && (
        <ol class="rank-list">
          {rows.map((r, i) => {
            const mine = r.name.toLowerCase() === me;
            const there = r.name.toLowerCase() === here;
            // sa propre ferme : les chiffres du moment, ceux du tableau de bord (le serveur peut avoir une minute de retard)
            const live = mine && !game.visiting;
            const birds = live ? adultCount(game.state) : r.hens;
            return (
              <li key={r.name} class={`${mine ? 'mine' : ''} ${there ? 'there' : ''}`}>
                <span class="rk">{medal(i)}</span>
                <div class="rk-name">
                  <b>{r.name}</b>
                  <small>
                    {birds.toLocaleString('fr-FR')} volaille{birds > 1 ? 's' : ''} adulte{birds > 1 ? 's' : ''} · jour {live ? currentDay(game.state) : r.game_day}
                    {mine ? ' · vous' : ''}
                  </small>
                </div>
                <span class="rk-val">{metric(sort, r)}</span>
                {mine && !game.visiting ? (
                  <span class="rk-act muted">Ma ferme</span>
                ) : there ? (
                  <span class="rk-act muted">Vous êtes ici</span>
                ) : (
                  <Btn kind="soft" small disabled={!!busy} onClick={() => visit(r.name)}>
                    {busy === r.name ? '…' : 'Visiter'}
                  </Btn>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Visite ----
/** Nuages en bordure et au centre : [haut %, largeur vw, côté, retard ms, échelle]. */
const CLOUDS: Array<[number, number, 'l' | 'r', number, number]> = [
  [-6, 70, 'l', 0, 1],
  [12, 60, 'r', 80, 0.9],
  [28, 75, 'l', 160, 1.1],
  [44, 65, 'r', 40, 1],
  [58, 80, 'l', 120, 1.05],
  [72, 62, 'r', 200, 0.95],
  [86, 70, 'l', 60, 1],
  [34, 55, 'r', 260, 0.8],
  [62, 50, 'r', 300, 0.85],
];

/** Transition entre deux fermes : des nuages traversent l'écran, la nouvelle ferme apparaît derrière. */
export function CloudVeil() {
  const game = useGame();
  return (
    <div class={`cloud-veil ${game.cloud}`} aria-hidden="true">
      <i class="cv-haze" />
      {CLOUDS.map(([top, w, side, delay, sc], i) => (
        <b key={i} class={`cloud ${side}`} style={{ top: `${top}%`, width: `${w}vw`, height: `${w * 0.42}vw`, '--d': `${delay}ms`, '--s': sc } as never} />
      ))}
    </div>
  );
}

/** Bouton du visiteur : passer le coucou à la ferme qu'on regarde. */
function CoucouButton({ name }: { name: string }) {
  const game = useGame();
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const send = async () => {
    setState('busy');
    try {
      const r = await sendGreeting(name);
      if (r === 'ok' || r === 'wait') {
        setState('sent');
        game.toast(r === 'ok' ? `Coucou passé à ${name} : la ferme le verra à son retour !` : `Vous avez déjà passé le coucou à ${name} il y a peu.`, r === 'ok' ? 'good' : 'info');
        return;
      }
      setState('idle');
      game.toast(r === 'denied' ? 'Votre code secret n’est plus reconnu : impossible de passer le coucou.' : 'Cette ferme ne peut pas recevoir de coucou.', 'warn');
    } catch (e) {
      setState('idle');
      const offline = e instanceof OnlineError && e.message === 'network';
      game.toast(offline ? 'Impossible de joindre le serveur. Vérifiez votre connexion.' : 'Le coucou n’est pas encore disponible sur le serveur.', 'warn');
    }
  };
  return (
    <Btn kind={state === 'sent' ? 'ghost' : 'soft'} small disabled={state !== 'idle'} onClick={() => void send()} title="La ferme verra votre coucou à son retour">
      {state === 'sent' ? '✓ Coucou passé' : state === 'busy' ? 'Envoi…' : 'Passer le coucou'}
    </Btn>
  );
}

/** Bandeau du mode visiteur : où l'on est, le coucou et le retour vers sa ferme. */
export function VisitBar() {
  const game = useGame();
  const v = game.visiting;
  if (!v) return null;
  const mine = identity()?.name.toLowerCase() === v.name.toLowerCase();
  return (
    <div class="visit-bar card">
      <span class="visit-tag">Mode visiteur</span>
      <div class="visit-txt">
        <b>{v.name}</b>
        <small>Vous regardez, rien ne se touche</small>
      </div>
      {!mine && <CoucouButton key={v.name} name={v.name} />}
      <Btn kind="primary" small onClick={() => void game.leaveVisit()}>
        Retour à ma ferme
      </Btn>
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('fr-FR')} ${n > 1 ? many : one}`;

/** Petit widget du visiteur, en haut à gauche : la journée et la force de la ferme visitée. */
export function VisitStats() {
  const game = useGame();
  const s = game.state;
  // replié par défaut sur téléphone, pour laisser voir la ferme
  const [open, setOpen] = useState(() => typeof window === 'undefined' || (window.innerWidth > 820 && window.innerHeight > 540));
  const lv = levelDef(s);
  const next = nextLevelDef(s);
  const xpRatio = next ? (s.xp - lv.xp) / Math.max(1, next.xp - lv.xp) : 1;
  const d = today(s);
  const inc = sumIncome(d);
  const exp = sumExpense(d);
  const st = farmStats(s);
  const adults = s.hens.filter((h) => !h.young);
  const layers = adults.filter((h) => !h.rooster).length;
  const males = adults.length - layers;
  const young = s.hens.length - adults.length;
  const staff = ROLE_ORDER.map((r) => ({ n: s.workers.filter((w) => w.role === r).length, title: ROLES[r].title })).filter((x) => x.n > 0);
  const rare = [
    { n: s.hens.filter((h) => h.legendary).length, one: 'légendaire', many: 'légendaires' },
    { n: s.hens.filter((h) => h.golden).length, one: 'poule d’or', many: 'poules d’or' },
    { n: s.hens.filter((h) => h.black).length, one: 'volaille noire', many: 'volailles noires' },
  ].filter((x) => x.n > 0);
  return (
    <aside class={`visit-stats card ${open ? '' : 'closed'}`}>
      <button class="vs-head" onClick={() => setOpen(!open)} title={open ? 'Réduire' : 'Voir les statistiques de la ferme'}>
        <span class="vs-level">{lv.level}</span>
        <span class="vs-title">
          <b>{lv.title}</b>
          <small>
            Jour {currentDay(s).toLocaleString('fr-FR')} · {season(s).name} · ★ {Math.round(s.reputation)}
          </small>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={15} />
      </button>
      <div class="vs-xp">
        <i style={{ width: `${Math.round(Math.min(1, xpRatio) * 100)}%` }} />
      </div>
      {open && (
        <div class="vs-body">
          <div class="vs-money">
            <span>Trésorerie</span>
            <b class={s.money < 0 ? 'neg' : ''}>{fmtMoney(s.money)}</b>
          </div>
          <h6>Aujourd’hui</h6>
          <div class="vs-grid">
            <div>
              <span>Recettes</span>
              <b class="pos">{fmtMoney(inc)}</b>
            </div>
            <div>
              <span>Dépenses</span>
              <b>{fmtMoney(exp)}</b>
            </div>
            <div>
              <span>Bilan</span>
              <b class={inc - exp < 0 ? 'neg' : 'pos'}>{fmtSigned(inc - exp)}</b>
            </div>
            <div>
              <span>Œufs pondus</span>
              <b>{(d.eggs ?? 0).toLocaleString('fr-FR')}</b>
            </div>
          </div>
          <h6>Sa force</h6>
          <div class="vs-grid">
            <div>
              <span>Volailles adultes</span>
              <b>{adults.length.toLocaleString('fr-FR')}</b>
            </div>
            <div>
              <span>Employés</span>
              <b>{s.workers.length}</b>
            </div>
            <div>
              <span>Taux de ponte</span>
              <b>{Math.round(st.laying * 100)} %</b>
            </div>
            <div>
              <span>Bien-être</span>
              <b>{Math.round(st.wellbeing)} %</b>
            </div>
            <div>
              <span>Bâtiments</span>
              <b>{s.buildings.length}</b>
            </div>
            <div>
              <span>Parcelles</span>
              <b>{s.parcels.length}</b>
            </div>
          </div>
          <p class="vs-line">
            {plural(layers, 'pondeuse')} · {plural(males, 'mâle')}
            {young > 0 && ` · ${plural(young, 'jeune')}`}
          </p>
          {staff.length > 0 && <p class="vs-line">{staff.map((x) => `${x.n} ${x.title.toLowerCase()}`).join(' · ')}</p>}
          {rare.length > 0 && <p class="vs-line vs-rare">{rare.map((x) => (x.n > 1 ? `${x.n} ${x.many}` : `1 ${x.one}`)).join(' · ')}</p>}
          <h6>Depuis le début</h6>
          <div class="vs-grid">
            <div>
              <span>Œufs vendus</span>
              <b>{s.stats.eggsSold.toLocaleString('fr-FR')}</b>
            </div>
            <div>
              <span>Chiffre d’affaires</span>
              <b>{fmtMoney(s.stats.totalIncome)}</b>
            </div>
            <div>
              <span>Clients servis</span>
              <b>{s.stats.customersServed.toLocaleString('fr-FR')}</b>
            </div>
            <div>
              <span>Poussins nés</span>
              <b>{s.stats.chicksHatched.toLocaleString('fr-FR')}</b>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

/** « La ferme X vous passe le coucou » : à son retour, le joueur voit qui est passé et peut rendre la visite. */
export function GreetingsCard() {
  const game = useGame();
  const list = game.greetings;
  if (!list.length || game.visiting) return null;
  const shown = list.slice(0, 4);
  const more = list.length - shown.length;
  const close = () => {
    game.greetings = [];
    game.changed();
  };
  return (
    <div class="greet-card card" role="status">
      <div class="greet-head">
        <b>{list.length > 1 ? 'Des voisins sont passés !' : 'Un voisin est passé !'}</b>
        <button class="greet-x" onClick={close} aria-label="Fermer">
          <Icon name="close" size={15} />
        </button>
      </div>
      <ul>
        {shown.map((g) => (
          <li key={g.name}>
            <span class="greet-name">
              <b>{g.name}</b> vous passe le coucou{g.count > 1 ? ` (${g.count} fois)` : ''}
            </span>
            <Btn
              kind="soft"
              small
              onClick={() => {
                game.greetings = game.greetings.filter((x) => x !== g);
                void game.visitFarm(g.name);
              }}
            >
              Rendre la visite
            </Btn>
          </li>
        ))}
      </ul>
      {more > 0 && <small>et {plural(more, 'autre ferme', 'autres fermes')}</small>}
      <Btn kind="primary" small block onClick={close}>
        Merci !
      </Btn>
    </div>
  );
}

/** Barre d'outils réduite du visiteur : classement, zoom, recentrage. */
export function VisitDock() {
  const game = useGame();
  return (
    <nav class="dock card visit-dock">
      <button class={game.panel === 'ranking' ? 'on' : ''} title="Classement" onClick={() => game.openPanel('ranking')}>
        <Icon name="trophy" size={20} />
        <span>Classement</span>
      </button>
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
