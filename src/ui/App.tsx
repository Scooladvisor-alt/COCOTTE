import type { Game } from '../game';
import { hasSave } from '../save/save';
import { GameCtx, useGame } from './common';
import { Dock, LeftPanel, TopRight } from './Hud';
import { Inspector } from './Inspector';
import { LevelUpModal, NightFade, OfflineModal, PlacementBar, PredatorAlert, TitleScreen, Toasts, Tutorial } from './Overlays';
import { PanelHost } from './Panels';
import { ShowResultModal } from './Show';

function Hud({ fromSave }: { fromSave: boolean }) {
  const game = useGame();
  if (!game.started) return <TitleScreen fromSave={fromSave && game.persist && hasSave()} />;
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
      <Toasts />
      <LevelUpModal />
      <OfflineModal />
      <NightFade />
      <ShowResultModal />
      {game.state.money < 0 && <div class="debt-banner">Compte à découvert : vendez des œufs pour éviter les agios</div>}
    </>
  );
}

export function App({ game, fromSave }: { game: Game; fromSave: boolean }) {
  return (
    <GameCtx.Provider value={game}>
      <div class="hud">
        <Hud fromSave={fromSave} />
      </div>
    </GameCtx.Provider>
  );
}
