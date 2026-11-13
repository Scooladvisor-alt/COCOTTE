import { useEffect, useState } from 'preact/hooks';
import { ShowPanel } from './Show';
import { BankPanel } from './Bank';
import { music } from '../audio/music';
import { LEGAL, LEVELS, LEVEL_GATES, levelAt } from '../config/balance';
import { MISSIONS } from '../config/missions';
import { deleteSave, saveGame } from '../save/save';
import { farmLevel, fmtMoney } from '../sim/economy';
import { unlocksAt } from '../sim/progression';
import { newFarm } from '../sim/starter';
import { Bar, Btn, Icon, Tabs, useGame } from './common';
import { MarketPanel } from './Market';
import { ShopPanel } from './Shop';
import { HenListPanel } from './HenList';
import { TeamPanel } from './Team';
import { OnlineSettings, RankingPanel } from './Online';
import { CrestPicker } from './FarmLogo';
import { identity, pushFarm } from '../online/farms';

export function PanelHost() {
  const game = useGame();
  const p = game.panel;
  if (!p) return null;
  const titles: Record<string, string> = {
    shop: 'Boutique',
    market: 'Ventes',
    finance: 'Banque',
    missions: 'Missions & progression',
    settings: 'Réglages',
    hens: 'Mes poules',
    team: 'Équipe de la ferme',
    ranking: 'Classement des éleveurs',
  };
  return (
    <div class="panel-wrap" onPointerDown={(e) => e.target === e.currentTarget && game.openPanel(null)}>
      <div class={`panel card panel-${p}`}>
        <header>
          <h2>{titles[p]}</h2>
          <span class="money-pill">{fmtMoney(game.state.money)}</span>
          <button class="close" onClick={() => game.openPanel(null)}>
            <Icon name="close" />
          </button>
        </header>
        {p === 'shop' && <ShopPanel />}
        {p === 'market' && <MarketPanel />}
        {p === 'finance' && <BankPanel />}
        {p === 'missions' && <MissionsPanel />}
        {p === 'settings' && <SettingsPanel />}
        {p === 'hens' && <HenListPanel />}
        {p === 'team' && <TeamPanel />}
        {p === 'ranking' && <RankingPanel />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Missions ----
function MissionsPanel() {
  const game = useGame();
  const s = game.state;
  const [tab, setTab] = useState(game.panelTab === 'show' || game.panelTab === 'levels' ? game.panelTab : 'missions');
  // ouverture directe sur l'onglet du concours (ligne du panneau de gauche)
  useEffect(() => {
    if (game.panelTab === 'show' && tab !== 'show') setTab('show');
  }, [game.panelTab]);
  const lvl = farmLevel(s);
  return (
    <>
      <Tabs
        tabs={[
          { id: 'missions', label: 'Missions' },
          { id: 'show', label: 'Concours agricole' },
          { id: 'levels', label: 'Niveaux & déblocages' },
        ]}
        active={tab}
        onChange={setTab}
      />
      <div class="panel-body">
        {tab === 'show' && <ShowPanel />}
        {tab === 'missions' && (
          <div class="missions">
            {MISSIONS.map((m, i) => {
              const done = s.missionsDone.includes(m.id);
              const current = i === s.missionIndex;
              const p = m.progress(s);
              if (i > s.missionIndex + 3) return null;
              return (
                <div key={m.id} class={`mission ${done ? 'done' : ''} ${current ? 'current' : ''} ${i > s.missionIndex ? 'next' : ''}`}>
                  <div class="m-dot">{done ? <Icon name="check" size={14} /> : i + 1}</div>
                  <div class="m-body">
                    <b>{m.title}</b>
                    <span>{m.desc}</span>
                    {current && (
                      <>
                        <Bar value={p.cur} max={p.target} tone="blue" thin />
                        <small>
                          {p.cur} / {p.target}
                          {m.hint ? ` · ${m.hint}` : ''}
                        </small>
                      </>
                    )}
                  </div>
                  <div class="m-reward">
                    {m.money > 0 && <span>{fmtMoney(m.money)}</span>}
                    <small>{m.xp} XP</small>
                  </div>
                </div>
              );
            })}
            <p class="hint">
              {s.missionsDone.filter((id) => MISSIONS.some((m) => m.id === id)).length} / {MISSIONS.length} missions accomplies
            </p>
          </div>
        )}
        {tab === 'levels' && (
          <div class="levels">
            {Array.from({ length: Math.max(LEVELS.length, lvl) + 3 }, (_, i) => levelAt(i + 1)).map((l) => {
              const list = unlocksAt(l.level);
              return (
                <div key={l.level} class={`lvl ${l.level <= lvl ? 'done' : ''} ${l.level === lvl ? 'current' : ''}`}>
                  <div class="m-dot">{l.level}</div>
                  <div class="m-body">
                    <b>
                      {l.title} <small>· {l.xp} XP</small>
                    </b>
                    {LEVEL_GATES && (
                      <span>
                        {l.maxParcels} parcelle{l.maxParcels > 1 ? 's' : ''} · {l.maxCoops} poulailler{l.maxCoops > 1 ? 's' : ''}
                      </span>
                    )}
                    {list.length > 0 && <small>{list.join(' · ')}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------- Réglages ----
function SettingsPanel() {
  const game = useGame();
  const s = game.state;
  const [confirm, setConfirm] = useState(0);
  const toggle = (k: 'labels' | 'offline' | 'sound' | 'predators' | 'predatorSlowdown', label: string) => (
    <label class="toggle">
      <input
        type="checkbox"
        checked={s.settings[k]}
        onChange={(e) => {
          s.settings[k] = (e.target as HTMLInputElement).checked;
          game.changed();
        }}
      />
      {label}
    </label>
  );
  return (
    <div class="panel-body settings">
      <h5>Ma ferme</h5>
      <div class="auto-row">
        <span>Nom</span>
        <input
          type="text"
          value={s.farmName}
          maxLength={32}
          readOnly={!!identity()}
          title={identity() ? 'Le nom de la ferme est celui du classement en ligne' : undefined}
          onChange={(e) => {
            s.farmName = (e.target as HTMLInputElement).value.trim().slice(0, 32) || s.farmName;
            game.changed();
          }}
        />
      </div>
      <div class="crest-block">
        <p class="crest-label">Blason</p>
        <CrestPicker
          value={s.logo}
          onPick={(id) => {
            s.logo = id;
            game.changed();
            game.save();
            if (game.persist && identity()) void pushFarm(s, true);
          }}
        />
      </div>
      <h5>Affichage & son</h5>
      {toggle('labels', 'Étiquettes au-dessus des éléments (sinon : seulement à la sélection)')}
      <label class="toggle">
        <input
          type="checkbox"
          checked={!!s.settings.lowGraphics}
          onChange={(e) => {
            s.settings.lowGraphics = (e.target as HTMLInputElement).checked;
            game.changed();
          }}
        />
        <span>Graphismes allégés (seulement si le jeu rame sur votre appareil)</span>
      </label>
      {toggle('sound', 'Effets sonores')}
      <label class="toggle">
        <input
          type="checkbox"
          checked={s.settings.music}
          onChange={(e) => {
            s.settings.music = (e.target as HTMLInputElement).checked;
            music.setEnabled(s.settings.music);
            game.changed();
          }}
        />
        Musique d’ambiance
      </label>
      <div class="auto-row">
        <span>Volume de la musique</span>
        <input
          type="range"
          class="vol"
          min={0}
          max={100}
          value={Math.round(s.settings.musicVolume * 100)}
          onInput={(e) => {
            s.settings.musicVolume = Number((e.target as HTMLInputElement).value) / 100;
            music.setVolume(s.settings.musicVolume);
            game.changed();
          }}
        />
        <b>{Math.round(s.settings.musicVolume * 100)} %</b>
      </div>
      <h5>Prédateurs</h5>
      {toggle('predators', 'Renards et buses attaquent de temps en temps')}
      <p class="hint">
        Cliquez sur un prédateur pour lui tirer dessus. Le commis et le jardinier sont armés : ils le traquent d’eux-mêmes. Le soir, des trappes fermées
        protègent les poules endormies. Aucune attaque pendant votre absence.
      </p>
      <OnlineSettings />
      <h5>Mentions légales et confidentialité</h5>
      <details class="legal">
        <summary>Afficher</summary>
        <p>
          <b>Éditeur.</b> {LEGAL.editor} Contact : {LEGAL.contact}.
        </p>
        <p>
          <b>Hébergeur.</b> {LEGAL.host}.
        </p>
        <p>
          <b>Vos données.</b> Votre partie est enregistrée dans votre navigateur et, sous le nom de votre ferme, dans notre base de données (Supabase) où le code secret est conservé chiffré. Le nom de votre ferme et ses chiffres sont visibles des autres joueurs. Aucune adresse e-mail n’est demandée. Le jeu est financé par des publicités Google : avec votre accord, Google peut utiliser des cookies pour les adapter à vos visites.
        </p>
        <p class="legal-links">
          <a href="/mentions-legales.html" target="_blank" rel="noopener">
            Mentions légales
          </a>
          {' · '}
          <a href="/cgu.html" target="_blank" rel="noopener">
            Conditions d’utilisation
          </a>
          {' · '}
          <a href="/confidentialite.html" target="_blank" rel="noopener">
            Confidentialité
          </a>
        </p>
      </details>
      <h5>Nouvelle partie</h5>
      <p class="hint">Efface définitivement la partie en cours, sur cet appareil et en ligne. Votre nom de ferme reste à vous.</p>
      <Btn
        kind="danger"
        onClick={() => {
          if (confirm === 0) return setConfirm(1);
          if (game.persist) deleteSave();
          const fresh = newFarm();
          const id = identity();
          if (id) fresh.farmName = id.name;
          game.replaceState(fresh);
          // la nouvelle ferme est aussitôt la sauvegarde de référence, ici et en ligne
          if (game.persist && id) {
            saveGame(fresh);
            void pushFarm(fresh, true);
          }
          game.started = false;
          game.openPanel(null);
          setConfirm(0);
        }}
      >
        {confirm ? 'Confirmer : tout effacer et recommencer' : 'Recommencer une nouvelle partie'}
      </Btn>
      <h5>Commandes</h5>
      <ul class="keys">
        <li>
          <kbd>Clic</kbd> sélectionner · <kbd>Glisser</kbd> déplacer la vue · <kbd>Molette</kbd> zoom
        </li>
        <li>
          <kbd>Espace</kbd> pause · <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd> vitesses · <kbd>R</kbd> ramasser tout · <kbd>B</kbd> boutique · <kbd>V</kbd> vente · <kbd>Échap</kbd> annuler
        </li>
      </ul>
    </div>
  );
}
