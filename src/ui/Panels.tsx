import { useEffect, useState } from 'preact/hooks';
import { ShowPanel } from './Show';
import { BankPanel } from './Bank';
import { music } from '../audio/music';
import { LEGAL, LEVELS, LEVEL_GATES } from '../config/balance';
import { MISSIONS } from '../config/missions';
import { deleteSave, deserialize, saveGame, serialize } from '../save/save';
import { farmLevel, fmtMoney } from '../sim/economy';
import { unlocksAt } from '../sim/progression';
import { newFarm } from '../sim/starter';
import { Bar, Btn, Icon, Tabs, useGame } from './common';
import { MarketPanel } from './Market';
import { ShopPanel } from './Shop';
import { HenListPanel } from './HenList';
import { TeamPanel } from './Team';

export function PanelHost() {
  const game = useGame();
  const p = game.panel;
  if (!p) return null;
  const titles: Record<string, string> = {
    shop: 'Boutique',
    market: 'Vente des œufs',
    finance: 'Banque',
    missions: 'Missions & progression',
    settings: 'Réglages',
    hens: 'Mes poules',
    team: 'Équipe de la ferme',
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
            {LEVELS.map((l) => {
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
  const [io, setIo] = useState('');
  const [msg, setMsg] = useState('');
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
          onChange={(e) => {
            s.farmName = (e.target as HTMLInputElement).value.trim().slice(0, 32) || s.farmName;
            game.changed();
          }}
        />
      </div>
      <h5>Affichage & son</h5>
      {toggle('labels', 'Étiquettes au-dessus des éléments (sinon : seulement à la sélection)')}
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
      {toggle('offline', 'Progression hors ligne (2 jours de jeu maximum)')}
      <h5>Prédateurs</h5>
      {toggle('predators', 'Renards et buses attaquent de temps en temps')}
      {toggle('predatorSlowdown', 'Repasser en vitesse normale pendant une attaque')}
      <p class="hint">
        Cliquez sur un prédateur pour lui tirer dessus. Le commis et le jardinier sont armés : ils le traquent d’eux-mêmes. Le soir, des trappes fermées
        protègent les poules endormies. Aucune attaque pendant votre absence.
      </p>
      <h5>Sauvegarde</h5>
      <p class="hint">
        Sauvegarde automatique toutes les 15 secondes et à la fermeture de l’onglet, dans ce navigateur (avec une copie de secours). Pour jouer sur un autre
        appareil, ou par précaution, téléchargez votre sauvegarde : un fichier à recharger ici à tout moment. En navigation privée, la partie est perdue à la
        fermeture.
      </p>
      <div class="actions">
        <Btn
          kind="primary"
          onClick={() => {
            const blob = new Blob([serialize(s)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `cocotte-${s.farmName.replace(/[^\w-]+/g, '-').toLowerCase() || 'ferme'}-jour-${Math.floor(s.clock.t / 180) + 1}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 2000);
            setMsg('Sauvegarde téléchargée ✓');
          }}
        >
          Télécharger ma sauvegarde
        </Btn>
        <label class="btn soft file-btn">
          Charger un fichier
          <input
            type="file"
            accept=".json,application/json,text/plain"
            onChange={async (e) => {
              const f = (e.target as HTMLInputElement).files?.[0];
              (e.target as HTMLInputElement).value = '';
              if (!f) return;
              const st = deserialize(await f.text());
              if (!st) return setMsg('Fichier invalide : chargement annulé');
              game.replaceState(st);
              if (game.persist) saveGame(st);
              setMsg('Partie chargée ✓');
            }}
          />
        </label>
      </div>
      <div class="actions">
        <Btn
          kind="soft"
          onClick={() => {
            const ok = game.persist && saveGame(s);
            setMsg(ok ? 'Partie sauvegardée ✓' : 'Échec de la sauvegarde');
          }}
        >
          Sauvegarder maintenant
        </Btn>
        <Btn kind="ghost" onClick={() => setIo(serialize(s))}>
          Exporter
        </Btn>
        <Btn
          kind="ghost"
          disabled={!io}
          onClick={() => {
            const st = deserialize(io);
            if (!st) return setMsg('Données invalides : import annulé');
            game.replaceState(st);
            if (game.persist) saveGame(st);
            setMsg('Partie importée ✓');
          }}
        >
          Importer le texte
        </Btn>
      </div>
      <textarea class="io" placeholder="Collez ici une sauvegarde exportée pour l’importer…" value={io} onInput={(e) => setIo((e.target as HTMLTextAreaElement).value)} />
      {msg && <p class="hint good">{msg}</p>}
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
          <b>Vos données.</b> Aucun compte, aucun cookie, aucune publicité, aucun outil de mesure d’audience. Votre partie est enregistrée uniquement dans votre
          navigateur (stockage local) et n’est jamais envoyée à un serveur. Les polices de caractères sont fournies avec le jeu. Effacer les données du site dans
          votre navigateur, ou le bouton « Recommencer » ci-dessous, supprime la partie.
        </p>
      </details>
      <h5>Nouvelle partie</h5>
      <p class="hint">Efface définitivement la partie en cours.</p>
      <Btn
        kind="danger"
        onClick={() => {
          if (confirm === 0) return setConfirm(1);
          if (game.persist) deleteSave();
          const fresh = newFarm();
          game.replaceState(fresh);
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
