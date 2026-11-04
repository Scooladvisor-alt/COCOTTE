// Interface du registre en ligne : nom de ferme unique, classement, visites.
import { useEffect, useState } from 'preact/hooks';
import { deserialize } from '../save/save';
import { NAME_RE, OnlineError, SECRET_MIN, alreadyAsked, claimFarm, identity, loadBoard, markAsked, pushFarm, restoreFarm, setIdentity, type BoardRow, type BoardSort } from '../online/farms';
import type { GameState } from '../sim/types';
import { Btn, Icon, Tabs, useGame } from './common';

export type FormMode = 'create' | 'join' | 'restore';

interface FormDone {
  name: string;
  /** Ferme retrouvée en ligne (mode « restore »). */
  state?: GameState;
}

/**
 * Formulaire nom de ferme + code secret. Créer / rejoindre : le nom doit être libre (personne
 * d'autre ne peut le prendre). Retrouver : nom + code redonnent sa ferme sur un autre appareil.
 */
export function OnlineForm({ mode, onDone, onOffline, onCancel, cancelLabel = 'Retour' }: { mode: FormMode; onDone: (r: FormDone) => void; onOffline?: () => void; onCancel?: () => void; cancelLabel?: string }) {
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [offline, setOffline] = useState(false);
  const restore = mode === 'restore';

  const submit = async (e: Event) => {
    e.preventDefault();
    const n = name.trim().replace(/\s+/g, ' ');
    setError('');
    setOffline(false);
    if (!NAME_RE.test(n)) return setError('Le nom de la ferme doit faire 3 à 24 caractères (lettres, chiffres, espaces, - . _ ’).');
    if (secret.length < SECRET_MIN) return setError(`Le code secret doit faire au moins ${SECRET_MIN} caractères.`);
    setBusy(true);
    try {
      if (restore) {
        const save = await restoreFarm(n, secret);
        const state = save ? deserialize(save) : null;
        if (!state) return setError('Cette ferme n’a pas encore de sauvegarde en ligne.');
        setIdentity({ name: n, secret });
        onDone({ name: n, state });
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
      else {
        setError('Pas de connexion au serveur : impossible de vérifier le nom pour l’instant.');
        setOffline(true);
      }
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
      {!restore && <small class="ofarm-hint">Le nom identifie votre ferme dans le classement. Le code secret vous permet de la retrouver sur un autre appareil : notez-le bien.</small>}
      {error && <p class="ofarm-err">{error}</p>}
      <div class="ofarm-actions">
        <Btn kind="primary" disabled={busy} onClick={() => undefined} type="submit">
          {busy ? 'Un instant…' : restore ? 'Retrouver ma ferme' : mode === 'join' ? 'Rejoindre le classement' : 'Créer ma ferme'}
        </Btn>
        {offline && onOffline && (
          <Btn kind="ghost" onClick={onOffline}>
            Jouer hors ligne
          </Btn>
        )}
        {onCancel && (
          <Btn kind="ghost" onClick={onCancel}>
            {cancelLabel}
          </Btn>
        )}
      </div>
    </form>
  );
}

/** Rejoint le registre avec la ferme en cours (le nom devient celui de la ferme). */
export function useJoin() {
  const game = useGame();
  return (name: string) => {
    game.state.farmName = name;
    markAsked();
    void pushFarm(game.state, true);
    game.toast(`Bienvenue dans le classement, ${name} !`, 'good', '🏆');
    game.changed();
  };
}

/** Une seule fois, aux joueurs qui ont déjà une ferme sans être au classement. */
export function JoinPrompt() {
  const game = useGame();
  const join = useJoin();
  const [hidden, setHidden] = useState(false);
  if (hidden || !game.persist || game.visiting || identity() || alreadyAsked() || !game.state.tutorial.done) return null;
  const later = () => {
    markAsked();
    setHidden(true);
  };
  return (
    <div class="modal-wrap">
      <div class="modal card ofarm-modal">
        <h2>Rejoignez le classement des éleveurs</h2>
        <p class="sub">Choisissez le nom de votre ferme (personne d’autre ne pourra le prendre) : elle apparaîtra dans le classement et les autres joueurs pourront la visiter.</p>
        <OnlineForm
          mode="join"
          onDone={({ name }) => {
            join(name);
            setHidden(true);
          }}
          onCancel={later}
          cancelLabel="Plus tard"
        />
      </div>
    </div>
  );
}

/** Réglages : état du profil en ligne, ou formulaire pour le créer. */
export function OnlineSettings() {
  const game = useGame();
  const join = useJoin();
  const id = identity();
  const [msg, setMsg] = useState('');
  if (id) {
    return (
      <>
        <h5>Classement en ligne</h5>
        <p class="hint">
          Ferme inscrite sous le nom <b>{id.name}</b>. Elle est envoyée automatiquement au classement toutes les quelques minutes.
        </p>
        <div class="actions">
          <Btn
            kind="soft"
            onClick={async () => {
              setMsg('Envoi…');
              const r = await pushFarm(game.state, true);
              setMsg(r === 'ok' ? 'Ferme envoyée !' : r === 'denied' ? 'Code secret refusé.' : r === 'skipped' ? 'Ferme trop volumineuse ou envoi déjà en cours.' : 'Pas de connexion.');
            }}
          >
            <Icon name="trophy" size={15} /> Envoyer ma ferme maintenant
          </Btn>
          {msg && <small class="muted">{msg}</small>}
        </div>
      </>
    );
  }
  return (
    <>
      <h5>Classement en ligne</h5>
      <p class="hint">Rejoignez le classement : votre ferme aura un nom unique et les autres joueurs pourront la visiter.</p>
      <OnlineForm mode="join" onDone={({ name }) => join(name)} />
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
            return (
              <li key={r.name} class={`${mine ? 'mine' : ''} ${there ? 'there' : ''}`}>
                <span class="rk">{medal(i)}</span>
                <div class="rk-name">
                  <b>{r.name}</b>
                  <small>
                    {r.hens.toLocaleString('fr-FR')} volaille{r.hens > 1 ? 's' : ''} · jour {r.game_day}
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
/** Bandeau du mode visiteur : où l'on est, et le retour vers sa ferme. */
export function VisitBar() {
  const game = useGame();
  const v = game.visiting;
  if (!v) return null;
  return (
    <div class="visit-bar card">
      <span class="visit-tag">Mode visiteur</span>
      <div class="visit-txt">
        <b>{v.name}</b>
        <small>
          Niveau {v.level} · {v.hens.toLocaleString('fr-FR')} volaille{v.hens > 1 ? 's' : ''} · vous regardez, rien ne se touche
        </small>
      </div>
      <Btn kind="primary" small onClick={() => game.leaveVisit()}>
        Retour à ma ferme
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
