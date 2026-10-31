import { useEffect, useState } from 'preact/hooks';
import { toastLife } from '../game';
import { buildingThumb } from '../render/thumbs';
import { TIME, LEVEL_GATES, levelAt } from '../config/balance';
import { BUILDINGS } from '../config/buildings';
import { sound } from '../audio/sound';
import { deleteSave, hasSave } from '../save/save';
import { currentDay } from '../sim/core';
import { fmtMoney, fmtSigned } from '../sim/economy';
import { unlocksAt } from '../sim/progression';
import { newFarm } from '../sim/starter';
import type { GameState } from '../sim/types';
import { Btn, Icon, useGame } from './common';
import { PREDATOR_INFO, livePredators } from '../sim/predators';
import { BREEDING } from '../config/balance';

/** Bandeau d'alerte pendant une attaque : quoi, où, et qui le traque. */
export function PredatorAlert() {
  const game = useGame();
  const s = game.state;
  const live = livePredators(s);
  if (!live.length) return null;
  const p = live[0];
  const info = PREDATOR_INFO[p.species];
  const hunters = s.workers.filter((w) => w.job?.kind === 'hunt' && w.job.targetId === p.id).map((w) => w.name);
  const caught = p.state === 'grab' ? s.hens.find((h) => h.id === p.targetHen) : undefined;
  const title =
    p.state === 'carry'
      ? `${info.female ? 'La buse' : 'Le renard'} s’enfuit avec sa proie !`
      : p.state === 'flee'
        ? `${info.female ? 'La buse blessée' : 'Le renard blessé'} détale !`
        : p.state === 'leave'
          ? `${info.female ? 'La buse' : 'Le renard'} renonce et s’en va`
          : caught
            ? `${caught.name} est ${info.female ? 'dans les serres de la buse' : 'dans la gueule du renard'} !`
            : p.species === 'fox'
              ? p.state === 'raid'
                ? 'Le renard se glisse dans un poulailler ouvert !'
                : p.state === 'prowl'
                  ? 'Le renard gratte à la trappe du poulailler…'
                  : 'Un renard rôde près des poules !'
              : p.state === 'dive'
                ? 'La buse pique sur une poule !'
                : 'Une buse tournoie au-dessus de la ferme !';
  const hint = caught
    ? 'Tirez vite pour la sauver !'
    : p.species === 'fox'
      ? `Cliquez dessus pour tirer · ${p.hp > 1 ? '2 balles pour l’abattre' : 'encore 1 balle'}`
      : 'Cliquez dessus pour tirer · 1 balle suffit';
  return (
    <div class={`pred-alert card ${caught ? 'urgent' : ''}`}>
      <span class="pa-ic">
        <Icon name="target" size={20} />
      </span>
      <div class="pa-txt">
        <b>{title}</b>
        <span>{hint}</span>
        {hunters.length > 0 && <small>{hunters.join(' et ')} {hunters.length > 1 ? 'le traquent' : 'le traque'}, fusil en main</small>}
      </div>
      <button class="btn primary" onClick={() => game.aimAtPredator()}>
        Viser
      </button>
    </div>
  );
}

/** Découpe un message en titre + détail (« Mission accomplie : Votre première poule »). */
function splitToast(text: string): [string, string] {
  const colon = text.indexOf(' : ');
  if (colon > 0 && colon < 60) return [text.slice(0, colon), text.slice(colon + 3)];
  const dot = text.search(/[.!?](\s|$)/);
  if (dot > 0 && dot < text.length - 2) return [text.slice(0, dot + 1), text.slice(dot + 2)];
  return [text, ''];
}

/**
 * Une seule notification à l'écran, au même endroit (en haut, entre le panneau de gauche et
 * l'horloge), dans le style de l'horloge. La plus récente passe devant ; quand elle s'en va,
 * celle d'en dessous réapparaît si elle est encore d'actualité. Un clic la ferme.
 */
export function Toasts() {
  const game = useGame();
  const all = game.toasts;
  const t = all[all.length - 1];
  if (!t) return <div class="toasts" />;
  const behind = all.length - 1;
  const left = toastLife(t) - (performance.now() - t.born);
  const [title, detail] = splitToast(t.text);
  return (
    <div class="toasts">
      {behind > 0 && <div class="toast-under card" />}
      <div key={t.id} class={`toast card ${t.tone} ${left < 400 ? 'out' : ''}`} title={`${t.text}\n(cliquer pour fermer)`} onClick={() => game.dismissToast(t.id)}>
        <span class="toast-ic">
          <Icon name={t.tone === 'good' ? 'check' : t.tone === 'info' ? 'info' : 'alert'} size={17} />
        </span>
        <div class="toast-txt">
          <b>{title}</b>
          {detail && <span>{detail}</span>}
        </div>
        {t.action && (
          <button
            class="btn primary small toast-act"
            onClick={(e) => {
              e.stopPropagation();
              game.runToastAction(t);
            }}
          >
            {t.action.label}
          </button>
        )}
        {(t.count > 1 || behind > 0) && (
          <div class="toast-side">
            {t.count > 1 && <em class="toast-n">×{t.count}</em>}
            {behind > 0 && <small>+{behind}</small>}
          </div>
        )}
      </div>
    </div>
  );
}

interface Step {
  done: (s: GameState) => boolean;
  title: string;
  text: string;
  target: (open: string | null) => string | null;
}

const STEPS: Step[] = [
  {
    done: (s) => s.stats.hensBought > 0,
    title: 'Bienvenue à la ferme !',
    text: `Votre terrain clôturé est prêt. Cocotte, ses trois poussins et un coq vous attendent, avec une couveuse : les œufs fécondés par le coq y partent tout seuls et éclosent en ${BREEDING.incubationDays} jours. Achetez une autre poule dans la boutique pour lancer la production.`,
    target: (p) => (p === 'shop' ? 'buy-rousse' : 'shop'),
  },
  {
    done: (s) => s.stats.eggsLaid > 0,
    title: 'Une nouvelle pensionnaire',
    text: 'Elle picore l’herbe, boit à l’abreuvoir et mange le grain de la mangeoire. Bien nourrie, elle pond. Accélérez le temps pour la voir pondre !',
    target: () => 'speed',
  },
  {
    done: (s) => s.stats.eggsCollected > 0,
    title: 'Le premier œuf !',
    text: 'Cliquez sur le pondoir (ou sur l’œuf s’il est au sol) pour le ramasser et le ranger dans votre stockage. Le bouton « Ramasser » du tableau de bord ramasse tout d’un coup.',
    target: () => 'collect',
  },
  {
    done: (s) => s.stats.priceSet,
    title: 'Fixez votre prix',
    text: 'Ouvrez la Vente et réglez le prix de vos œufs. Plus il est bas, plus ils partent vite ; plus il est haut, plus vous gagnez par œuf… si les clients acceptent.',
    target: (p) => (p === 'market' ? 'prices' : 'market'),
  },
  {
    done: (s) => s.stats.customersServed > 0,
    title: 'Place aux clients',
    text: `Les villageois passent à l’étal de ${TIME.SHOP_OPEN} h à ${TIME.SHOP_CLOSE} h. Pendant ce temps, gardez un œil sur le grain, l’eau et la propreté du poulailler.`,
    target: () => null,
  },
];

export function Tutorial() {
  const game = useGame();
  const s = game.state;
  const idx = STEPS.findIndex((st) => !st.done(s));
  const target = idx >= 0 && !s.tutorial.done ? STEPS[idx].target(game.panel) : null;
  useEffect(() => {
    document.querySelectorAll('.tut-glow').forEach((e) => e.classList.remove('tut-glow'));
    if (target) document.querySelectorAll(`[data-tut="${target}"]`).forEach((e) => e.classList.add('tut-glow'));
  });
  if (s.tutorial.done || !game.started || game.placing) return null;
  // sur petit écran, l'inspecteur ouvert a la priorité sur la bulle d'aide
  if (game.selection && typeof window !== 'undefined' && window.innerWidth <= 820) return null;
  if (idx < 0) {
    return (
      <div class="coach card done">
        <b>Bravo, la ferme tourne !</b>
        <p>Suivez les missions (bouton Missions à droite) : elles vous guident pas à pas vers une grande exploitation. Réinvestissez vos bénéfices, mais gardez de la trésorerie pour les charges.</p>
        <Btn
          kind="primary"
          onClick={() => {
            s.tutorial.done = true;
            game.changed();
          }}
        >
          C’est parti !
        </Btn>
      </div>
    );
  }
  const st = STEPS[idx];
  return (
    <div class="coach card">
      <div class="coach-step">
        Étape {idx + 1}/{STEPS.length}
      </div>
      <b>{st.title}</b>
      <p>{st.text}</p>
      <div class="coach-actions">
        <button
          class="link"
          onClick={() => {
            s.tutorial.done = true;
            game.changed();
          }}
        >
          Passer le tutoriel
        </button>
        {idx === 0 && (
          <Btn kind="primary" small onClick={() => game.openPanel('shop', 'hens')}>
            Ouvrir la boutique
          </Btn>
        )}
        {idx === 1 && (
          <Btn kind="primary" small onClick={() => game.setSpeed(3)}>
            Accélérer ×3
          </Btn>
        )}
        {idx === 3 && (
          <Btn kind="primary" small onClick={() => game.openPanel('market', 'stand')}>
            Ouvrir la vente
          </Btn>
        )}
      </div>
    </div>
  );
}

export function PlacementBar() {
  const game = useGame();
  if (!game.placing) return null;
  const def = BUILDINGS[game.placing.type];
  const moving = game.placing.moveId !== undefined;
  return (
    <div class="placement card">
      <img class="pi" src={buildingThumb(game.placing.type, 1)} alt="" />
      <div>
        <b>
          {moving ? 'Déplacer' : 'Construire'} : {def.name}
          {!moving && ` · ${fmtMoney(def.levels[0].cost)}`}
        </b>
        <small class={game.ghost && !game.ghost.ok ? 'neg' : ''}>{game.ghost ? (game.ghost.ok ? 'Emplacement valide : cliquez pour confirmer' : game.ghost.reason) : 'Survolez votre terrain'}</small>
      </div>
      <Btn kind="ghost" small onClick={() => game.rotatePlacing()} title="Pivoter d’un quart de tour (touche R)">
        <Icon name="rotate" size={15} /> <span class="rot-label">Pivoter</span>
      </Btn>
      <Btn kind="ghost" small onClick={() => game.cancelPlacing()}>
        Annuler
      </Btn>
    </div>
  );
}

export function LevelUpModal() {
  const game = useGame();
  const lvl = game.levelUp;
  if (lvl === null) return null;
  const def = levelAt(lvl);
  const list = unlocksAt(lvl);
  return (
    <div class="modal-wrap">
      <div class="modal card levelup">
        <div class="burst">
          <Icon name="star" size={34} />
        </div>
        <h2>Niveau {lvl} !</h2>
        <p class="sub">{def.title}</p>
        <ul class="unlocks">
          {LEVEL_GATES && (
            <li>
              Jusqu’à <b>{def.maxParcels}</b> parcelle{def.maxParcels > 1 ? 's' : ''} et <b>{def.maxCoops}</b> poulailler{def.maxCoops > 1 ? 's' : ''}
            </li>
          )}
          {list.map((u) => (
            <li key={u}>{u}</li>
          ))}
        </ul>
        <Btn
          kind="primary"
          block
          onClick={() => {
            game.levelUp = null;
            game.changed();
          }}
        >
          Continuer
        </Btn>
      </div>
    </div>
  );
}

export function OfflineModal() {
  const game = useGame();
  const o = game.offline;
  if (!o) return null;
  const hours = (o.seconds / TIME.DAY) * 24;
  return (
    <div class="modal-wrap">
      <div class="modal card">
        <h2>Pendant votre absence…</h2>
        <p class="sub">
          {hours >= 24 ? `${(hours / 24).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} jour(s)` : `${Math.round(hours)} heure(s)`} de jeu se sont écoulées
          {o.seconds >= TIME.OFFLINE_MAX_DAYS * TIME.DAY ? ' (plafond atteint)' : ''}.
        </p>
        <ul class="unlocks">
          <li>
            <b>{o.eggsLaid}</b> œufs pondus
          </li>
          <li>
            <b>{o.eggsSold}</b> œufs vendus
          </li>
          <li>
            Trésorerie : <b class={o.money >= 0 ? 'pos' : 'neg'}>{fmtSigned(o.money)}</b>
          </li>
          {o.hensLost > 0 && (
            <li class="neg">
              {o.hensLost} poule{o.hensLost > 1 ? 's' : ''} perdue{o.hensLost > 1 ? 's' : ''}
            </li>
          )}
        </ul>
        <Btn
          kind="primary"
          block
          onClick={() => {
            game.offline = null;
            game.changed();
          }}
        >
          Retour à la ferme
        </Btn>
      </div>
    </div>
  );
}

/**
 * Page d'accueil : la ferme vivante en 3D isométrique derrière, et devant, juste l'essentiel —
 * le nom du jeu, une phrase, un bouton pour jouer.
 */
export function TitleScreen({ fromSave }: { fromSave: boolean }) {
  const game = useGame();
  const s = game.state;
  const [confirm, setConfirm] = useState(false);
  const [saved, setSaved] = useState(fromSave);
  if (game.started) return null;
  const startNew = () => {
    sound.unlock();
    if (saved && !confirm) return setConfirm(true);
    if (game.persist) deleteSave();
    const fresh = newFarm();
    game.replaceState(fresh);
    setSaved(false);
    game.start(0);
    game.save();
  };
  const cont = () => {
    sound.unlock();
    const secs = Math.max(0, (Date.now() - s.savedAt) / 1000);
    game.start(secs);
  };
  const resume = saved && hasSave();
  return (
    <div class="landing">
      <div class="ld-veil" />
      <main class="ld-hero">
        <span class="ld-kicker">
          <i class="ld-egg" /> Un petit jeu de ferme
        </span>
        <h1 class="ld-title">Cocotte</h1>
        <p class="ld-lead">Élevez vos poules, ramassez les œufs, vendez-les au village. Votre ferme vit même quand vous n’êtes pas là.</p>
        <div class="ld-actions">
          {resume ? (
            <>
              <button class="ld-play" onClick={cont}>
                Continuer
                <small>
                  {s.farmName} · jour {currentDay(s)}
                </small>
              </button>
              <button class={`ld-ghost ${confirm ? 'danger' : ''}`} onClick={startNew}>
                {confirm ? 'Effacer et recommencer' : 'Nouvelle partie'}
              </button>
              {confirm && (
                <button class="ld-link" onClick={() => setConfirm(false)}>
                  Annuler
                </button>
              )}
            </>
          ) : (
            <button class="ld-play" onClick={startNew}>
              Jouer
            </button>
          )}
        </div>
        <small class="ld-note">Gratuit · dans le navigateur · sauvegarde automatique</small>
      </main>
      <footer class="ld-feats">
        <span>Élever</span>
        <i />
        <span>Récolter</span>
        <i />
        <span>Vendre</span>
      </footer>
    </div>
  );
}

/** Fondu au noir pendant « Passer la nuit ». */
export function NightFade() {
  const game = useGame();
  return (
    <div class={`night-fade ${game.skipping ? 'on' : ''}`} aria-hidden={!game.skipping}>
      <div>
        <span>
          <Icon name="moon" size={40} />
        </span>
        <b>La nuit passe…</b>
        <small>Les poules dorment au poulailler</small>
      </div>
    </div>
  );
}
