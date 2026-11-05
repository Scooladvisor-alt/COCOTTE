import { useState } from 'preact/hooks';
import type { Game } from '../game';
import { GameCtx, useGame } from './common';
import { Dock, LeftPanel, TopRight } from './Hud';
import { Inspector } from './Inspector';
import { LevelUpModal, NightFade, OfflineModal, PlacementBar, PredatorAlert, TitleScreen, Toasts, Tutorial } from './Overlays';
import { PanelHost } from './Panels';
import { ShowResultModal } from './Show';
import { CloudVeil, GreetingsCard, VisitBar, VisitDock, VisitStats } from './Online';

function Hud() {
  const game = useGame();
  if (!game.started) return <TitleScreen />;
  // visite d'une autre ferme : on regarde, on zoome, on se déplace, rien d'autre
  if (game.visiting)
    return (
      <>
        <VisitBar />
        <VisitStats />
        <VisitDock />
        <PanelHost />
        <Toasts />
      </>
    );
  return (
    <>
      <LeftPanel />
      <TopRight />
      <Dock />
      <Inspector />
      <PlacementBar />
      <Tutorial />
      <PanelHost />
      <PredatorAlert />
      <GreetingsCard />
      <Toasts />
      <LevelUpModal />
      <OfflineModal />
      <NightFade />
      <ShowResultModal />
      {game.state.money < 0 && <div class="debt-banner">Compte à découvert : vendez des œufs pour éviter les agios</div>}
    </>
  );
}

/** Téléphone tenu en hauteur : le jeu se joue à l'horizontale (on peut passer outre). */
function RotateHint() {
  const [skip, setSkip] = useState(false);
  if (skip) return null;
  return (
    <div class="rotate-hint" onClick={() => setSkip(true)}>
      <div class="rh-box">
        <div class="rh-phone" />
        <b>Tournez votre téléphone</b>
        <span>Cocotte se joue à l’horizontale, comme une application. Touchez l’écran pour continuer quand même.</span>
      </div>
    </div>
  );
}

export function App({ game }: { game: Game }) {
  return (
    <GameCtx.Provider value={game}>
      <div class="hud">
        <Hud />
      </div>
      <CloudVeil />
      <RotateHint />
    </GameCtx.Provider>
  );
}
