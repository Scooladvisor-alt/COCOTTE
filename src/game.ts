// Contrôleur : boucle de jeu, entrées, évènements → effets, sauvegarde automatique.
import { AUTOSAVE_SECONDS, EGG_TYPES, FRESHNESS, LEVELS, TIME } from './config/balance';
import { BUILDINGS, COOP_SCALE, STAND_POS, STORAGE_SCALE, sizeOf } from './config/buildings';
import { sound } from './audio/sound';
import { music } from './audio/music';
import { FarmRenderer, type PickResult } from './render/farmRenderer';
import { Vector3 as THREE_V } from 'three';
import { saveGame } from './save/save';
import * as A from './sim/actions';
import { canPlace } from './sim/buildings';
import { buildingCenter, drainEvents, isNightHour, currentHour, parcelCenter } from './sim/core';
import { fmtMoney } from './sim/economy';
import { henStatus } from './sim/hens';
import { announceLevel } from './sim/progression';
import { ROLES } from './config/staff';
import { JOB_LABELS } from './sim/workers';
import { PREDATOR_INFO, livePredators, setPredatorsQuiet, shootPredator } from './sim/predators';
import { getBuilding, lvl, storageCapacity, storedCount } from './sim/queries';
import { deliverOrder } from './sim/market';
import { createShowcase } from './sim/showcase';
import { fertileStock, nextHatchIn } from './sim/breeding';
import { advance, advanceRealtime, canSkipNight, simulateOffline, skipNight, type OfflineSummary } from './sim/simulation';
import type { ActionResult, BuildingType, GameEvent, GameState, NotifyAction, ShowResult } from './sim/types';

export type Selection =
  | { kind: 'hen'; id: number }
  | { kind: 'robot'; id: number }
  | { kind: 'dog' }
  | { kind: 'worker'; id: number }
  | { kind: 'building'; id: number }
  | { kind: 'parcel'; key: string }
  | null;
export type Panel = null | 'shop' | 'market' | 'finance' | 'missions' | 'settings' | 'hens' | 'team';

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'good' | 'warn' | 'bad';
  icon?: string;
  born: number;
  /** Même message reçu plusieurs fois : affiché une seule fois avec « ×N ». */
  count: number;
  /** Bouton d'action (ex. : « Livrer » une commande dont le stock est prêt). */
  action?: NotifyAction;
}

/** Durée d'affichage selon l'importance (ms) : les bonnes nouvelles passent vite, les alertes restent. */
export const TOAST_LIFE: Record<Toast['tone'], number> = { info: 3800, good: 4200, warn: 6000, bad: 7500 };
/** Une notification qui propose une action reste plus longtemps (le temps de cliquer). */
export const toastLife = (t: Pick<Toast, 'tone' | 'action'>) => TOAST_LIFE[t.tone] * (t.action ? 2.6 : 1);


export class Game {
  state: GameState;
  renderer: FarmRenderer;
  selection: Selection = null;
  panel: Panel = null;
  panelTab: string | null = null;
  placing: { type: BuildingType; moveId?: number } | null = null;
  ghost: { x: number; z: number; ok: boolean; reason?: string } | null = null;
  toasts: Toast[] = [];
  levelUp: number | null = null;
  /** Résultat du dernier concours agricole (fenêtre du podium). */
  showResult: ShowResult | null = null;
  offline: OfflineSummary | null = null;
  /** Fondu au noir pendant « Passer la nuit ». */
  skipping = false;
  started = false;
  private listeners = new Set<() => void>();
  private toastId = 1;
  private last = performance.now();
  private uiTimer = 0;
  private saveTimer = 0;
  private hover: PickResult | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private down: { x: number; y: number; moved: boolean; button: number } | null = null;
  private pinchDist = 0;
  private raf = 0;
  lastSaveOk = true;
  /** La caméra suit la sélection (poule ou salarié). */
  follow = false;
  /** false en mode démonstration (?nosave) : aucune écriture de sauvegarde. */
  persist = true;
  /** Dernier instant (horloge réelle) où la simulation a été avancée. */
  private wall = performance.now();

  constructor(container: HTMLElement, state: GameState) {
    this.state = state;
    this.renderer = new FarmRenderer(container);
    this.renderer.onWildlife = (text) => this.toast(text, 'info', '🦌');
    sound.enabled = state.settings.sound;
    music.enabled = state.settings.music;
    music.setVolume(state.settings.musicVolume);
    this.renderer.labels.onClick = (key) => this.onLabelClick(key);
    this.bindInput(this.renderer.renderer.domElement);
    window.addEventListener('resize', () => this.renderer.resize());
    // La ferme vit même onglet caché ou fenêtre réduite : l'affichage s'arrête, pas la simulation.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        // personne pour défendre la ferme à l'écran : pas d'attaque tant que l'onglet est caché
        setPredatorsQuiet(this.state, true);
        this.save();
      } else {
        this.background(true);
        setPredatorsQuiet(this.state, false);
        this.last = performance.now();
        this.changed();
      }
    });
    window.setInterval(() => this.background(), 1000);
    window.addEventListener('beforeunload', () => this.save());
    this.goHome();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ------------------------------------------------------------ Abonnés ----
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  changed() {
    for (const l of this.listeners) l();
  }

  replaceState(s: GameState) {
    this.state = s;
    this.selection = null;
    this.placing = null;
    this.renderer.showGhost(null, 1, 0, 0, false);
    sound.enabled = s.settings.sound;
    music.setVolume(s.settings.musicVolume);
    music.setEnabled(s.settings.music);
    this.changed();
  }

  /**
   * « Passer la nuit » : l'écran s'assombrit, la nuit est simulée d'un coup (mêmes règles que le
   * jeu), puis la ferme se réveille à 6 h 30 avec un petit résumé.
   */
  skipNight() {
    if (!this.started || this.skipping || !canSkipNight(this.state)) return;
    this.skipping = true;
    this.select(null);
    this.changed();
    window.setTimeout(() => {
      const sum = skipNight(this.state);
      // seuls les messages utiles remontent (pas les effets visuels de toute une nuit)
      for (const e of drainEvents(this.state)) if (e.kind === 'notify' || e.kind === 'levelUp' || e.kind === 'mission') this.onEvent(e);
      if (sum) {
        const parts = [`${sum.eggsLaid} œuf${sum.eggsLaid > 1 ? 's' : ''} pondu${sum.eggsLaid > 1 ? 's' : ''}`];
        if (sum.hatched) parts.push(`${sum.hatched} poussin${sum.hatched > 1 ? 's' : ''} né${sum.hatched > 1 ? 's' : ''}`);
        if (sum.hensLost) parts.push(`${sum.hensLost} poule${sum.hensLost > 1 ? 's' : ''} perdue${sum.hensLost > 1 ? 's' : ''}`);
        this.toast(`Bonjour ! La nuit est passée : ${parts.join(' · ')}.`, sum.hensLost ? 'warn' : 'good');
      }
      this.save();
      this.changed();
      window.setTimeout(() => {
        this.skipping = false;
        this.changed();
      }, 650);
    }, 650);
  }

  /**
   * Quand l'affichage est suspendu (onglet caché, fenêtre réduite ou recouverte), le navigateur
   * n'appelle plus la boucle d'animation : une minuterie fait alors avancer la ferme du temps réel
   * écoulé. Seuls les messages utiles sont gardés (pas de sons ni d'effets d'une scène invisible).
   */
  private background(force = false) {
    const now = performance.now();
    if (!this.started || this.skipping) {
      this.wall = now;
      return;
    }
    if (!force && now - this.wall < 600) return; // l'animation tourne : rien à faire
    const secs = (now - this.wall) / 1000;
    this.wall = now;
    this.last = now;
    if (advanceRealtime(this.state, secs) === 0) return;
    for (const e of drainEvents(this.state)) if (e.kind === 'notify' || e.kind === 'levelUp' || e.kind === 'mission' || e.kind === 'showResult') this.onEvent(e);
    this.saveTimer += secs;
    if (this.saveTimer > AUTOSAVE_SECONDS) {
      this.saveTimer = 0;
      this.save();
    }
    this.changed();
  }

  /** Page d'accueil : la ferme vitrine vit derrière le titre, la caméra dérive lentement au-dessus. */
  private showcase: GameState | null = null;
  private landingT = 0;
  private landingFrame(dt: number) {
    const R = this.renderer;
    if (!this.showcase) {
      this.showcase = createShowcase();
      R.resetWorld();
      this.landingT = 0;
    }
    const s = this.showcase;
    advance(s, dt);
    drainEvents(s);
    R.selectedHen = R.selectedBuilding = R.selectedWorker = R.selectedRobot = -1;
    R.selectedDog = false;
    R.hoverParcel = '';
    this.landingT += dt;
    const t = this.landingT;
    R.zoom = (window.innerWidth > 820 || window.innerWidth > window.innerHeight ? 1.8 : 1.4) + Math.sin(t * 0.07) * 0.12;
    // la ferme se place à côté du titre (à droite sur grand écran, en haut sur téléphone)
    const q = R.camera.quaternion;
    const right = new THREE_V(1, 0, 0).applyQuaternion(q).setY(0).normalize();
    const down = new THREE_V(0, -1, 0).applyQuaternion(q).setY(0).normalize();
    const aspect = window.innerWidth / Math.max(1, window.innerHeight);
    const halfH = R.viewHeight / 2 / R.zoom;
    const wide = window.innerWidth > 820 || window.innerWidth > window.innerHeight;
    const cx = 15 + Math.sin(t * 0.05) * 1.8;
    const cz = 25.2 + Math.sin(t * 0.037 + 1) * 1.3;
    const off = wide ? -halfH * aspect * 0.36 : 0;
    const offV = wide ? 0 : halfH * 0.42;
    R.target.set(cx + right.x * off + down.x * offV, 0, cz + right.z * off + down.z * offV);
    R.updateCamera();
    R.update(s, dt);
    R.render(dt);
  }

  /**
   * Recentre la vue sur la ferme. Sur un téléphone à l'horizontale, l'écran est bas : on recule un
   * peu et on vise plus haut, pour voir les bâtiments plutôt que la route.
   */
  goHome(resetZoom = false) {
    const short = window.innerHeight <= 540 && window.innerWidth > window.innerHeight;
    if (resetZoom) this.renderer.zoom = short ? 1.15 : 1.35;
    this.renderer.focusOn(short ? 13 : 15, short ? 23 : 25.5);
  }

  start(offlineSeconds = 0) {
    if (this.showcase) {
      // fin de l'accueil : place à la vraie ferme
      this.showcase = null;
      this.renderer.resetWorld();
      this.goHome(true);
    }
    this.started = true;
    // demande au navigateur de ne pas effacer la sauvegarde pour faire de la place
    if (this.persist) void navigator.storage?.persist?.().catch(() => false);
    sound.unlock();
    music.enabled = this.state.settings.music;
    music.setVolume(this.state.settings.musicVolume);
    music.start();
    if (offlineSeconds > 0) {
      const sum = simulateOffline(this.state, offlineSeconds);
      drainEvents(this.state);
      if (sum && (sum.eggsLaid > 0 || sum.money !== 0)) this.offline = sum;
    }
    this.changed();
  }

  // ------------------------------------------------------------- Boucle ----
  private frame(now: number) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.started) return this.landingFrame(dt);
    const modal = this.levelUp !== null || this.offline !== null || this.showResult !== null;
    if (this.started && !modal && !this.skipping) {
      // images au compte-gouttes (fenêtre recouverte, onglet ralenti par le navigateur) :
      // on rattrape tout le temps réel écoulé au lieu de le perdre
      const gap = (performance.now() - this.wall) / 1000;
      if (gap > 0.3) advanceRealtime(this.state, gap);
      else advance(this.state, dt);
    }
    this.wall = performance.now();
    for (const e of drainEvents(this.state)) this.onEvent(e);
    this.renderer.selectedHen = this.selection?.kind === 'hen' ? this.selection.id : -1;
    this.renderer.selectedBuilding = this.selection?.kind === 'building' ? this.selection.id : -1;
    this.renderer.selectedWorker = this.selection?.kind === 'worker' ? this.selection.id : -1;
    this.renderer.selectedRobot = this.selection?.kind === 'robot' ? this.selection.id : -1;
    this.renderer.selectedDog = this.selection?.kind === 'dog';
    this.renderer.hoverParcel = this.selection?.kind === 'parcel' ? this.selection.key : this.hover?.kind === 'parcel' && !this.state.parcels.includes(this.hover.key) ? this.hover.key : '';
    this.renderer.update(this.state, dt);
    music.setNight(this.isNight());
    this.ambience(dt);
    this.updateLabels();
    this.renderer.render(dt);

    // validation de la sélection (poule vendue/morte, bâtiment démoli)
    if (this.selection?.kind === 'hen' && !this.state.hens.some((h) => h.id === (this.selection as { id: number }).id)) this.selection = null;
    if (this.selection?.kind === 'building' && !getBuilding(this.state, this.selection.id)) this.selection = null;
    if (this.selection?.kind === 'worker') {
      const id = this.selection.id;
      const w = this.state.workers.find((x) => x.id === id);
      if (!w) this.selection = null;
    }
    // caméra qui suit la poule ou le salarié sélectionné
    if (this.follow && this.selection) {
      const p =
        this.selection.kind === 'hen'
          ? this.renderer.henPosition(this.selection.id)
          : this.selection.kind === 'worker'
            ? this.renderer.workerPosition(this.selection.id)
            : this.selection.kind === 'dog'
              ? this.renderer.dogRoot()?.position ?? null
              : this.selection.kind === 'robot'
                ? this.renderer.robotRoot(this.selection.id)?.position ?? null
                : null;
      if (p) {
        this.renderer.target.x += (p.x - this.renderer.target.x) * Math.min(1, dt * 4);
        this.renderer.target.z += (p.z - this.renderer.target.z) * Math.min(1, dt * 4);
        this.renderer.updateCamera();
      }
    } else if (this.follow && !this.selection) this.follow = false;

    this.toasts = this.toasts.filter((t) => now - t.born < toastLife(t));
    this.uiTimer += dt;
    if (this.uiTimer > 0.2) {
      this.uiTimer = 0;
      this.changed();
    }
    this.saveTimer += dt;
    if (this.started && this.saveTimer > AUTOSAVE_SECONDS) {
      this.saveTimer = 0;
      this.save();
    }
  }

  save() {
    if (!this.started || !this.persist) return false;
    this.lastSaveOk = saveGame(this.state);
    return this.lastSaveOk;
  }

  toast(text: string, tone: Toast['tone'] = 'info', icon?: string, action?: NotifyAction) {
    const now = performance.now();
    const dup = this.toasts.find((t) => t.text === text);
    if (dup) {
      // déjà affiché : on le remonte avec un compteur plutôt que de l'empiler
      dup.born = now;
      dup.count++;
      this.toasts = [...this.toasts.filter((t) => t !== dup), dup];
      this.changed();
      return;
    }
    this.toasts.push({ id: this.toastId++, text, tone, icon, born: now, count: 1, action });
    // au-delà de 6 en attente, on oublie d'abord les plus anciennes informations (les alertes restent)
    while (this.toasts.length > 6) {
      const i = this.toasts.findIndex((t) => t.tone === 'info' || t.tone === 'good');
      this.toasts.splice(i >= 0 ? i : 0, 1);
    }
    this.changed();
  }

  /** Bouton d'une notification : livre la commande prête, puis ferme la notification. */
  runToastAction(t: Toast) {
    if (t.action?.kind === 'deliverOrder') {
      const id = t.action.id;
      this.act(() => deliverOrder(this.state, id), 'coin');
    }
    this.dismissToast(t.id);
  }

  dismissToast(id: number) {
    this.toasts = this.toasts.filter((t) => t.id !== id);
    this.changed();
  }

  /** Exécute une action joueur et donne un retour immédiat. */
  act(fn: () => ActionResult, okSound: Parameters<typeof sound.play>[0] = 'click'): boolean {
    sound.unlock();
    const r = fn();
    if (!r.ok) {
      if (r.reason) this.toast(r.reason, 'warn');
      sound.play('error');
    } else sound.play(okSound);
    this.changed();
    return r.ok;
  }

  // ----------------------------------------------------------- Évènements ----
  private onEvent(e: GameEvent) {
    const R = this.renderer;
    switch (e.kind) {
      case 'eggLaid':
        R.particles.burst(e.x, e.ground ? 0.2 : 0.55, e.z, 0xfff1b8, 6, { speed: 0.5, up: 1.6, size: 0.6 });
        sound.play('egg');
        break;
      case 'eggsCollected':
        R.labels.float(e.x, 0.9, e.z, `+${e.count} œuf${e.count > 1 ? 's' : ''}`, 'egg');
        sound.play('pop');
        break;
      case 'sale': {
        const lbl = e.channel === 'etal' ? '' : e.channel === 'cooperative' ? ' coop.' : e.channel === 'commandes' ? ' commande' : ' contrat';
        R.labels.float(e.x, 1.7, e.z, `+${fmtMoney(e.amount)}${lbl}`, 'money');
        R.particles.burst(e.x, 1.2, e.z, 0xf5c542, 6, { speed: 0.6, up: 1.8, size: 0.8 });
        sound.play('coin');
        break;
      }
      case 'money':
        R.labels.float(e.x, 1, e.z, `+${fmtMoney(e.amount)}`, 'money');
        sound.play('coin');
        break;
      case 'purchase':
        sound.play('buy');
        break;
      case 'build':
      case 'upgrade':
        sound.play('build');
        break;
      case 'demolish':
        R.particles.burst(e.x, 0.4, e.z, 0xcdb48a, 26, { speed: 2, up: 2 });
        sound.play('build');
        break;
      case 'parcel':
        sound.play('level');
        break;
      case 'henArrived': {
        const h = this.state.hens.find((x) => x.id === e.henId);
        if (h) R.particles.burst(h.x, 0.5, h.z, 0xffffff, 10, { speed: 0.8, up: 1.5, gravity: 1.5 });
        sound.play('cluck');
        break;
      }
      case 'cluck':
        sound.play('cluck');
        break;
      case 'workerArrived': {
        const w = this.state.workers.find((x) => x.id === e.workerId);
        R.particles.burst(e.x, 0.6, e.z, 0xffffff, 16, { speed: 1.2, up: 1.8, gravity: 2 });
        if (w) R.labels.float(e.x, 1.6, e.z, `${w.name} arrive`, 'egg');
        sound.play('buy');
        break;
      }
      case 'showResult':
        this.showResult = e.result;
        sound.play(e.result.place <= 3 ? 'level' : 'coin');
        break;
      case 'levelUp':
        this.levelUp = e.level;
        announceLevel(this.state, e.level);
        sound.play('level');
        break;
      case 'mission':
        this.toast(`Mission accomplie : ${e.title}`, 'good');
        sound.play('level');
        break;
      case 'notify':
        this.toast(e.text, e.tone, e.icon, e.action);
        break;
      case 'predatorSpawn': {
        sound.play(e.species === 'fox' ? 'alarm' : 'screech');
        if (e.species === 'fox') sound.play('squawk');
        // le joueur doit pouvoir réagir : on repasse en vitesse normale
        if (this.state.settings.predatorSlowdown && this.state.clock.speed > 1) {
          A.setSpeed(this.state, 1);
          this.toast('Attaque ! Le temps repasse en vitesse normale.', 'warn', '⏱️');
        }
        break;
      }
      case 'shot': {
        if (e.by < 0) {
          // tir « divin » du joueur : un trait de lumière tombe du ciel sur la cible
          R.shots.tracer(e.x1 + 0.6, e.y1 + 7, e.z1 + 0.6, e.x1, e.y1, e.z1, 0xfff6c9);
          R.shots.flash(e.x1, e.y1, e.z1, 0xfff1a8, 2.2, 0.16);
          R.shots.shockwave(e.x1, e.z1, 0xffffff, 1.4);
          R.shake(0.22);
          sound.play('shot');
        } else {
          const m = R.muzzleOf(e.by);
          const x0 = m?.x ?? e.x0;
          const y0 = m?.y ?? e.y0;
          const z0 = m?.z ?? e.z0;
          R.shots.flash(x0, y0, z0, 0xffd27a, 0.9, 0.09);
          R.shots.tracer(x0, y0, z0, e.x1, e.y1, e.z1);
          R.particles.burst(x0, y0, z0, 0xd9d4cc, 4, { speed: 0.35, up: 0.5, gravity: -0.4, size: 0.9, life: 0.9 });
          if (!e.hit) R.particles.burst(e.x1, Math.max(0.15, e.y1), e.z1, e.y1 > 1 ? 0xe8e4dc : 0xc8ab7a, 6, { speed: 0.7, up: 1.3, size: 0.7 });
          sound.play('shotFar');
        }
        break;
      }
      case 'predatorHit': {
        const fur = e.species === 'fox' ? 0xd7692a : 0x7d5534;
        R.particles.burst(e.x, e.y + 0.1, e.z, fur, e.killed ? 22 : 12, { speed: 1.4, up: 1.6, size: 0.9, life: 1.1 });
        R.particles.burst(e.x, e.y + 0.1, e.z, 0xffffff, 6, { speed: 1, up: 2, size: 0.6 });
        sound.play(e.species === 'fox' ? 'yelp' : 'screech');
        if (e.killed) R.labels.float(e.x, e.y + 1, e.z, `${PREDATOR_INFO[e.species].name} abattu${PREDATOR_INFO[e.species].female ? 'e' : ''} !`, 'money');
        else R.labels.float(e.x, e.y + 0.9, e.z, 'Touché !', 'egg');
        break;
      }
      case 'henTaken': {
        R.particles.burst(e.x, 0.4, e.z, 0xf6f1e7, 20, { speed: 1.3, up: 1.8, gravity: 1, size: 1, life: 1.6 });
        sound.play('squawk');
        break;
      }
      case 'fence':
        break;
      case 'dogBark':
        if (this.renderer.onScreen(new THREE_V(e.x, 0.3, e.z))) sound.play('bark');
        break;
      case 'hatch':
        R.particles.burst(e.x, 0.75, e.z, 0xf6d548, 22, { speed: 1.1, up: 1.6, gravity: 1.5, life: 1.3 });
        R.particles.burst(e.x, 0.75, e.z, 0xf3ece0, 10, { speed: 0.7, up: 1.2, gravity: 2.5, size: 0.7 });
        R.labels.float(e.x, 1.3, e.z, `${e.count} poussin${e.count > 1 ? 's' : ''} !`, 'egg');
        sound.play('peep');
        break;
      case 'incubated':
        // l'œuf fécondé rejoint la couveuse : on le voit arriver
        R.labels.float(e.x, 1.25, e.z, `+${e.count} œuf${e.count > 1 ? 's' : ''} en couveuse`, 'egg');
        R.particles.burst(e.x, 0.75, e.z, 0xffd28a, 6, { speed: 0.4, up: 0.8, gravity: 1, size: 0.5, life: 0.9 });
        sound.play('pop');
        break;
      case 'crow':
        if (this.renderer.onScreen(new THREE_V(e.x, 0.3, e.z)) || Math.random() < 0.5) sound.play('crow');
        break;
      case 'grownUp': {
        const h = this.state.hens.find((x) => x.id === e.henId);
        if (h) R.particles.burst(h.x, 0.5, h.z, 0xfff1b8, 12, { speed: 0.8, up: 1.4, gravity: 1.5 });
        break;
      }
      case 'eggRotten':
        R.particles.burst(e.x, 0.2, e.z, 0x8f9a5c, 10, { speed: 0.4, up: 0.8, gravity: 0.6, size: 0.7, life: 1.4 });
        break;
      case 'henRescued':
        R.labels.float(e.x, 1, e.z, 'Sauvée !', 'money');
        R.particles.burst(e.x, 0.4, e.z, 0xf6f1e7, 10, { speed: 1, up: 1.6, gravity: 1, life: 1.2 });
        break;
      case 'customerMood': {
        // réaction brève du client, sans bulle permanente
        if (e.mood !== 'expensive' && e.mood !== 'empty' && e.mood !== 'impatient') break;
        const c = this.state.customers.find((x) => x.id === e.customerId);
        if (c) R.labels.float(c.x, 1.55, c.z, e.mood === 'expensive' ? 'Trop cher !' : e.mood === 'impatient' ? 'Trop d’attente !' : 'Rupture !', e.mood === 'empty' ? 'bad' : 'warn');
        break;
      }
      case 'henGone':
      case 'newDay':
        break;
    }
  }

  // ----------------------------------------------------------- Étiquettes ----
  private updateLabels() {
    const L = this.renderer.labels;
    const s = this.state;
    L.begin();
    // Par défaut, aucun texte au-dessus des éléments : la sélection (surbrillance + fiche)
    // donne les informations. Les anciennes étiquettes restent disponibles en option.
    if (!s.settings.labels) {
      // seule exception : un petit écriteau discret quand il y a quelque chose à faire
      this.todoSigns();
      L.end();
      return;
    }
    const show = true;
    const z = this.renderer.zoom;
    const gauge = (r: number) => {
      const v = Math.max(0, Math.min(1, r));
      const tone = v < 0.25 ? 'bad' : v < 0.5 ? 'warn' : 'good';
      return `<span class="lg ${tone}"><i style="width:${Math.round(v * 100)}%"></i></span><em>${Math.round(v * 100)} %</em>`;
    };
    for (const b of s.buildings) {
      if (this.placing?.moveId === b.id) continue;
      const def = BUILDINGS[b.type];
      const c = b.type === 'stand' ? { x: STAND_POS.x + 1, z: STAND_POS.z } : buildingCenter(b);
      const L1 = lvl(b);
      let info = '';
      let cls = '';
      const height = b.type === 'goosehouse' ? 2.2 + b.level * 0.25 : b.type === 'coop' ? (2.3 + b.level * 0.15) * COOP_SCALE : b.type === 'storage' ? 1.9 * STORAGE_SCALE : b.type === 'stand' ? 1.9 : b.type === 'feeder' && b.level === 3 ? 2.2 : 1.1;
      if (b.type === 'nest') {
        if (b.eggIds.length > 0) {
          info = `<em>${b.eggIds.length} œuf${b.eggIds.length > 1 ? 's' : ''}</em>`;
          cls = 'action';
        } else if (!show || z < 1) continue;
        else info = `<em>vide</em>`;
      } else if (!show) continue;
      else if (b.type === 'coop' || b.type === 'goosehouse') {
        const occ = s.hens.filter((h) => h.coopId === b.id).length;
        info = `<em>${occ}/${L1.capacity}</em>`;
        if (b.closed) info += '<em>fermé</em>';
        if (b.cleanliness < 35) (cls = 'alert'), (info += '<em>sale</em>');
      } else if (b.type === 'feeder' || b.type === 'drinker') {
        const r = b.stock / L1.capacity;
        info = gauge(r);
        if (r < 0.15) cls = 'alert';
      } else if (b.type === 'storage') {
        const n = storedCount(s);
        info = gauge(n / Math.max(1, storageCapacity(s))).replace(/<em>.*<\/em>/, `<em>${n}/${storageCapacity(s)}</em>`);
        if (n >= storageCapacity(s)) cls = 'alert';
      } else if (b.type === 'stand') {
        const open = currentHour(s) >= TIME.SHOP_OPEN && currentHour(s) < TIME.SHOP_CLOSE;
        info = `<em>${open ? fmtMoney(s.prices.roux) : 'fermé'}</em>`;
      } else if (b.type === 'dustbath') {
        if (z < 1.2) continue;
      }
      if (z < 0.95 && !cls) continue; // vue éloignée : seulement les alertes et actions
      const name = b.type === 'storage' ? 'Stockage' : b.type === 'stand' ? 'Étal' : def.name;
      L.set(`b${b.id}`, c.x, height, c.z, `<b>${name}</b>${info}`, cls);
    }
    // parcelles à vendre
    if (!this.placing) {
      for (const key of candidateParcels(s)) {
        const [c, r] = key.split(',').map(Number);
        const chk = A.checkBuyParcel(s, key);
        const price = A.parcelPrice(s.parcels.length);
        const locked = chk.reason?.startsWith('Niveau');
        const need = LEVELS.find((l) => l.maxParcels > s.parcels.length)?.level ?? 10;
        const [px, pz] = parcelCenter(c, r);
        L.set(`p${key}`, px, 1.15, pz, locked ? `<b>À vendre</b><em>niveau ${need}</em>` : `<b>À vendre</b><em>${fmtMoney(price)}</em>`, locked ? 'locked' : 'sale');
      }
    }
    // poules en difficulté / sélectionnée
    const selHen = this.selection?.kind === 'hen' ? this.selection.id : -1;
    for (const h of s.hens) {
      const pos = this.renderer.henPosition(h.id);
      if (!pos) continue;
      const st = henStatus(h);
      if (h.id === selHen) L.set(`h${h.id}`, pos.x, pos.y + 0.75, pos.z, `<b>${h.name}</b><em class="${st.tone}">${st.label}</em>`, 'hen');
      else if (FarmRenderer.needsLabel(h)) L.set(`h${h.id}`, pos.x, pos.y + 0.7, pos.z, h.hydration < 30 ? 'Soif' : h.satiety < 30 ? 'Faim' : 'Santé', 'need');
      else if (h.act === 'sleep') continue;
    }
    // salariés : nom et tâche en cours, si sélectionné, survolé ou en pleine chasse
    const selWorker = this.selection?.kind === 'worker' ? this.selection.id : -1;
    const hoverWorker = this.hover?.kind === 'worker' ? this.hover.id : -1;
    for (const w of s.workers) {
      const hunting = w.job?.kind === 'hunt';
      if (!w.onSite || (w.id !== selWorker && w.id !== hoverWorker && !hunting)) continue;
      const pos = this.renderer.workerPosition(w.id);
      if (!pos) continue;
      let task = w.job ? JOB_LABELS[w.job.kind] : ROLES[w.role].title;
      if (hunting) {
        const prey = s.predators.find((p) => p.id === w.job!.targetId);
        task = prey ? `Traque ${PREDATOR_INFO[prey.species].the}` : task;
      }
      L.set(`w${w.id}`, pos.x, 1.35, pos.z, `<b>${w.name}</b><em>${task}</em>`, w.id === selWorker ? 'hen' : hunting ? 'worker hunt' : 'worker');
    }
    // prédateurs : nom et points de vie, l'étiquette se clique aussi pour tirer
    for (const p of s.predators) {
      if (p.state === 'dead') continue;
      const pos = this.renderer.predatorPosition(p.id);
      if (!pos) continue;
      const info = PREDATOR_INFO[p.species];
      const max = p.species === 'fox' ? 2 : 1;
      const pips = Array.from({ length: max }, (_, i) => `<i class="${i < p.hp ? 'on' : ''}"></i>`).join('');
      const what = p.state === 'carry' ? 'emporte sa proie' : p.state === 'flee' ? 'blessé, il fuit' : p.state === 'leave' ? 's’en va' : 'cliquez pour tirer';
      L.set(`x${p.id}`, pos.x, pos.y + (p.species === 'fox' ? 1.0 : 0.6), pos.z, `<b>${info.name}</b><span class="pips">${pips}</span><em>${what}</em>`, 'predator');
    }
    // humeur des clients
    for (const c of s.customers) {
      // dans la file, celui qui commence à trouver le temps long le fait savoir
      if (c.state === 'queue' && (c.counter ?? -1) < 0 && (c.wait ?? 0) > (c.patience ?? 12) * 0.55) {
        L.set(`c${c.id}`, c.x, 1.45, c.z, '…', 'mood waiting');
        continue;
      }
      if (c.mood === 'none' || (c.state === 'leaving' && c.t > 1.6)) continue;
      const txt = c.mood === 'happy' ? `+${c.bought} œuf${c.bought > 1 ? 's' : ''}` : c.mood === 'expensive' ? 'Trop cher !' : c.mood === 'impatient' ? 'Trop d’attente !' : 'Rupture !';
      L.set(`c${c.id}`, c.x, 1.45, c.z, txt, `mood ${c.mood}`);
    }
    // œufs au sol : signalés quand le zoom est faible
    if (z < 1.2) {
      for (const e of s.worldEggs) if (e.where === 'ground') L.set(`e${e.id}`, e.x, 0.5, e.z, '', 'egg-dot');
    }
    L.end();
  }

  /**
   * Ambiance de basse-cour mêlée à la musique : de temps en temps, des poules caquètent
   * doucement (plus souvent quand le troupeau est grand), à gauche ou à droite.
   */
  private ambT = 3;
  private ambience(dt: number) {
    const s = this.state;
    if (!this.started || s.clock.speed === 0 || !s.settings.sound) return;
    this.ambT -= dt;
    if (this.ambT > 0) return;
    const awake = s.hens.filter((h) => h.act !== 'sleep').length;
    if (awake === 0) {
      this.ambT = 4;
      return;
    }
    // des poussins dans la basse-cour : leurs « piou piou » se mêlent aux caquètements
    const chicks = s.hens.filter((h) => h.young && h.act !== 'sleep').length;
    if (chicks && Math.random() < Math.min(0.5, 0.15 + chicks * 0.04)) sound.play('peep');
    else sound.play(Math.random() < 0.72 ? 'murmur' : 'cluck');
    this.ambT = (2.5 + Math.random() * 5) / Math.sqrt(Math.min(awake, 30) / 3 + 0.6);
  }

  /** Écriteaux « à faire » : mangeoire ou abreuvoir à remplir, poulailler sale, pondoir ou stockage plein. */
  private todoSigns() {
    const L = this.renderer.labels;
    const s = this.state;
    const sel = this.selection?.kind === 'building' ? this.selection.id : -1;
    for (const b of s.buildings) {
      if (b.id === sel || this.placing?.moveId === b.id) continue;
      const L1 = lvl(b);
      let text = '';
      let urgent = false;
      if (b.type === 'feeder' || b.type === 'drinker') {
        const r = b.stock / Math.max(1, L1.capacity);
        if (r >= 0.2) continue;
        urgent = r < 0.03;
        // un équipement automatique vide signifie que la réserve elle-même est à sec
        if (L1.auto) text = b.type === 'feeder' ? 'Plus de grain' : 'Plus d’eau';
        else text = urgent ? 'Vide · à remplir' : 'À remplir';
      } else if ((b.type === 'coop' || b.type === 'goosehouse') && b.cleanliness < 35) {
        text = 'À nettoyer';
        urgent = b.cleanliness < 20;
      } else if (b.type === 'nest' && b.eggIds.length >= L1.capacity) text = 'Plein · à ramasser';
      else if (b.type === 'incubator' && (b.hatch?.length || fertileStock(s) > 0)) {
        // couveuse : combien d'œufs couvent et quand ils éclosent (ou des œufs qui attendent d'y entrer)
        const n = b.hatch?.length ?? 0;
        const left = nextHatchIn(s, b);
        if (n) text = `${n} œuf${n > 1 ? 's' : ''} · ${left !== null && left < 1 ? 'éclosion imminente' : `${n > 1 ? '1re éclosion' : 'éclosion'} dans ${Math.ceil(left ?? 0)} j`}`;
        else if (b.auto === false) text = `${fertileStock(s)} œuf${fertileStock(s) > 1 ? 's' : ''} fécondé${fertileStock(s) > 1 ? 's' : ''} à placer`;
        else continue;
        const c = buildingCenter(b);
        L.set(`b${b.id}`, c.x, 1.25, c.z, `<i></i>${text}`, n ? 'todo calm' : 'todo');
        continue;
      }
      else if (b.type === 'storage' && storedCount(s) >= storageCapacity(s)) text = 'Stockage plein';
      else continue;
      const c = buildingCenter(b);
      const y = b.type === 'goosehouse' ? 2.1 + b.level * 0.25 : b.type === 'coop' ? (2.3 + b.level * 0.15) * COOP_SCALE : b.type === 'storage' ? 1.9 * STORAGE_SCALE : b.type === 'feeder' && b.level === 3 ? 2.2 : 1.05;
      L.set(`b${b.id}`, c.x, y, c.z, `<i></i>${text}`, `todo ${urgent ? 'urgent' : ''}`);
    }
    // œufs pondus au sol qui vont bientôt pourrir
    for (const e of s.worldEggs) {
      if (e.where !== 'ground' || s.clock.t - e.laidAt < FRESHNESS.groundWarnDays * TIME.DAY) continue;
      L.set(`e${e.id}`, e.x, 0.55, e.z, '<i></i>Va pourrir', 'todo urgent');
    }
  }

  private onLabelClick(key: string) {
    if (key.startsWith('b')) {
      const id = Number(key.slice(1));
      const b = getBuilding(this.state, id);
      if (b) this.clickBuilding(b.id);
    } else if (key.startsWith('p')) {
      this.select({ kind: 'parcel', key: key.slice(1) });
    } else if (key.startsWith('w')) {
      this.select({ kind: 'worker', id: Number(key.slice(1)) });
    } else if (key.startsWith('h')) {
      this.select({ kind: 'hen', id: Number(key.slice(1)) });
    } else if (key.startsWith('e')) {
      this.act(() => A.collectGroundEgg(this.state, Number(key.slice(1))), 'pop');
    } else if (key.startsWith('x')) {
      this.shoot(Number(key.slice(1)));
    }
  }

  /** Tir du joueur sur un prédateur. */
  shoot(id: number) {
    sound.unlock();
    const r = shootPredator(this.state, id);
    if (!r.ok) sound.play('error');
    this.changed();
  }

  /** Ferme les pages ouvertes et centre la caméra sur le prédateur le plus menaçant. */
  aimAtPredator() {
    const p = livePredators(this.state)[0];
    if (!p) return;
    this.panel = null;
    this.panelTab = null;
    this.selection = null;
    this.follow = false;
    this.renderer.setZoom(Math.max(this.renderer.zoom, 1.7));
    this.renderer.focusOn(p.x, p.z + (p.species === 'hawk' ? -p.y * 0.4 : 0));
    sound.play('click');
    this.changed();
  }

  // ------------------------------------------------------------ Sélection ----
  select(sel: Selection) {
    if (!sel || sel.kind !== this.selection?.kind || (sel as { id?: number }).id !== (this.selection as { id?: number }).id) this.follow = false;
    this.selection = sel;
    if (sel) sound.play('click');
    this.changed();
  }

  openPanel(p: Panel, tab: string | null = null) {
    sound.unlock();
    this.panel = this.panel === p && !tab ? null : p;
    this.panelTab = tab;
    if (p) sound.play('click');
    this.changed();
  }

  clickBuilding(id: number) {
    const b = getBuilding(this.state, id);
    if (!b) return;
    if (b.type === 'nest' && b.eggIds.length > 0) this.act(() => A.collectFromNest(this.state, b.id), 'pop');
    if (b.type === 'stand') {
      // l'étal ouvre directement la page de vente : prix des œufs et amélioration de l'étal
      this.select(null);
      this.openPanel('market', 'stand');
      return;
    }
    this.select({ kind: 'building', id });
  }

  startPlacing(type: BuildingType, moveId?: number) {
    this.placing = { type, moveId };
    this.panel = null;
    this.ghost = null;
    if (moveId !== undefined) this.renderer.hideBuilding(moveId, true);
    this.toast(moveId !== undefined ? 'Choisissez le nouvel emplacement (Échap pour annuler)' : 'Cliquez sur votre terrain pour construire (Échap pour annuler)', 'info');
    this.changed();
  }

  cancelPlacing() {
    if (this.placing?.moveId !== undefined) this.renderer.hideBuilding(this.placing.moveId, false);
    this.placing = null;
    this.ghost = null;
    this.renderer.showGhost(null, 1, 0, 0, false);
    this.changed();
  }

  private updateGhost(clientX: number, clientY: number) {
    if (!this.placing) return;
    const g = this.renderer.groundAt(clientX, clientY);
    if (!g) return;
    const level = this.placing.moveId !== undefined ? getBuilding(this.state, this.placing.moveId)?.level ?? 1 : 1;
    const def = sizeOf(this.placing.type, level);
    const x = Math.round(g.x - def.w / 2);
    const z = Math.round(g.z - def.d / 2);
    const chk = canPlace(this.state, this.placing.type, x, z, this.placing.moveId ?? -1, level);
    this.ghost = { x, z, ok: chk.ok, reason: chk.reason };
    this.renderer.showGhost(this.placing.type, level, x, z, chk.ok);
  }

  private confirmPlacing() {
    if (!this.placing || !this.ghost) return;
    const { type, moveId } = this.placing;
    const { x, z } = this.ghost;
    const ok =
      moveId !== undefined
        ? this.act(() => A.move(this.state, moveId, x, z), 'build')
        : this.act(() => A.build(this.state, type, x, z), 'build');
    if (ok) {
      const id = moveId ?? this.state.buildings[this.state.buildings.length - 1].id;
      this.cancelPlacing();
      this.select({ kind: 'building', id });
    }
  }

  private onClick(clientX: number, clientY: number) {
    sound.unlock();
    if (this.placing) {
      this.updateGhost(clientX, clientY);
      this.confirmPlacing();
      return;
    }
    const p = this.renderer.pick(clientX, clientY);
    if (!p) return this.select(null);
    switch (p.kind) {
      case 'predator':
        this.shoot(p.id);
        break;
      case 'robot':
        this.select({ kind: 'robot', id: p.id });
        break;
      case 'dog':
        this.select({ kind: 'dog' });
        sound.play('bark');
        break;
      case 'egg':
        this.act(() => A.collectGroundEgg(this.state, p.id), 'pop');
        break;
      case 'hen': {
        const hen = this.state.hens.find((h) => h.id === p.id);
        if (hen?.act === 'stray') this.act(() => A.recallStray(this.state, p.id), 'cluck');
        this.select({ kind: 'hen', id: p.id });
        sound.play('cluck');
        break;
      }
      case 'worker':
        this.select({ kind: 'worker', id: p.id });
        break;
      case 'building':
        this.clickBuilding(p.id);
        break;
      case 'parcel':
        this.select({ kind: 'parcel', key: p.key });
        break;
      default:
        this.select(null);
    }
  }

  // --------------------------------------------------------------- Entrées ----
  private bindInput(el: HTMLCanvasElement) {
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
        this.down = null;
      } else {
        this.down = { x: e.clientX, y: e.clientY, moved: false, button: e.button };
      }
    });
    el.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (prev && this.pointers.size === 2) {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0) this.renderer.setZoom(this.renderer.zoom * (d / this.pinchDist));
        this.pinchDist = d;
        return;
      }
      if (prev && this.down) {
        if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) this.down.moved = true;
        if (this.down.moved) {
          this.follow = false;
          const g0 = this.renderer.groundAt(prev.x, prev.y);
          const g1 = this.renderer.groundAt(e.clientX, e.clientY);
          if (g0 && g1) {
            this.renderer.target.x += g0.x - g1.x;
            this.renderer.target.z += g0.z - g1.z;
            this.renderer.updateCamera();
          }
        }
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (this.placing) this.updateGhost(e.clientX, e.clientY);
      else if (!this.down) {
        this.hover = this.renderer.pick(e.clientX, e.clientY);
        const h = this.hover;
        el.style.cursor =
          h?.kind === 'predator'
            ? 'crosshair'
            : h && (h.kind === 'hen' || h.kind === 'worker' || h.kind === 'robot' || h.kind === 'dog' || h.kind === 'egg' || h.kind === 'building' || (h.kind === 'parcel' && !this.state.parcels.includes(h.key)))
              ? 'pointer'
              : 'grab';
      }
    });
    const up = (e: PointerEvent) => {
      const wasDown = this.down;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (wasDown && !wasDown.moved && e.type === 'pointerup') {
        if (wasDown.button === 2 && this.placing) this.cancelPlacing();
        else if (wasDown.button === 0) this.onClick(e.clientX, e.clientY);
      }
      this.down = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const before = this.renderer.groundAt(e.clientX, e.clientY);
        this.renderer.setZoom(this.renderer.zoom * Math.exp(-e.deltaY * 0.0015));
        const after = this.renderer.groundAt(e.clientX, e.clientY);
        if (before && after) {
          this.renderer.target.x += before.x - after.x;
          this.renderer.target.z += before.z - after.z;
          this.renderer.updateCamera();
        }
      },
      { passive: false },
    );
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (!this.started) return;
      if (e.key === 'Escape') {
        if (this.placing) this.cancelPlacing();
        else if (this.panel) this.openPanel(null);
        else this.select(null);
      } else if (e.key === ' ') {
        e.preventDefault();
        this.setSpeed(this.state.clock.speed === 0 ? 1 : 0);
      } else if (e.key === '1') this.setSpeed(1);
      else if (e.key === '2') this.setSpeed(3);
      else if (e.key === '3') this.setSpeed(10);
      else if (e.key.toLowerCase() === 'b') this.openPanel('shop');
      else if (e.key.toLowerCase() === 'v') this.openPanel('market');
      else if (e.key.toLowerCase() === 'r') this.act(() => A.collectAll(this.state), 'pop');
      else if (e.key.toLowerCase() === 'n') this.skipNight();
    });
  }

  setSpeed(v: number) {
    sound.unlock();
    A.setSpeed(this.state, v);
    sound.play('click');
    this.changed();
  }

  isNight() {
    return isNightHour(currentHour(this.state));
  }

  eggName(t: keyof typeof EGG_TYPES) {
    return EGG_TYPES[t].name;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
  }
}


function candidateParcels(s: GameState) {
  const set = new Set<string>();
  for (const p of s.parcels) for (const n of A.parcelNeighbours(p)) if (!s.parcels.includes(n)) set.add(n);
  return [...set];
}
