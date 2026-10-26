// polices hébergées avec le jeu (aucun appel à des serveurs tiers)
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/500.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/800.css';
import '@fontsource/nunito/900.css';
import '@fontsource/fredoka/500.css';
import '@fontsource/fredoka/600.css';
import './ui/styles.css';
import { h, render } from 'preact';
import { Game } from './game';
import { loadGame } from './save/save';
import { newFarm } from './sim/starter';
import { App } from './ui/App';

// ?nosave : partie de démonstration qui ne lit ni n'écrit la sauvegarde du navigateur
const noSave = new URLSearchParams(location.search).has('nosave');
const loaded = noSave ? null : loadGame();
const state = loaded?.state ?? newFarm();
const world = document.getElementById('world')!;
const game = new Game(world, state);
game.persist = !noSave;
if (loaded?.source === 'backup') game.toast('Sauvegarde principale illisible : la copie de secours a été restaurée.', 'warn', '💾');

render(h(App, { game, fromSave: !!loaded }), document.getElementById('ui')!);

// aperçu de développement : ?nosave&dev=jours,panneau[,onglet] → partie simulée N jours, panneau ouvert
// (ex. ?nosave&dev=10,hens ou ?nosave&dev=8,market,stand), sans passer par l'accueil
if (import.meta.env.DEV && noSave && new URLSearchParams(location.search).get('dev')) {
  const [days, panel, tab] = new URLSearchParams(location.search).get('dev')!.split(',');
  void Promise.all([import('./sim/simulation'), import('./sim/core'), import('./config/balance')]).then(([sim, core, bal]) => {
    state.tutorial.done = true;
    state.settings.predators = false;
    for (let t = 0; t < bal.TIME.DAY * Number(days || 0); t += bal.TIME.STEP) {
      sim.step(state, bal.TIME.STEP);
      core.drainEvents(state);
      // de quoi nourrir et abreuver le troupeau pendant la simulation
      if (state.grain < 40) state.grain = 200;
      if (state.water < 40) state.water = 300;
    }
    game.start();
    if (panel) game.openPanel(panel as never, tab ?? null);
  });
}

// accès console pour le débogage (développement uniquement)
if (import.meta.env.DEV) {
  void import('./sim/simulation').then((sim) => {
    Object.assign(window, { game, sim });
  });
}
