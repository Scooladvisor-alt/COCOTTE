import { useState } from 'preact/hooks';
import { AUTO_DOOR, BIRD_ORDERS, BREEDING, CLEARING, COMPOST, EGG_TYPES, TIME, GRADES, HEALTH, LAYING, NATURE, PARCELS, ROBOT, WORKER_SKILLS, parcelPrice, WORLD } from '../config/balance';
import { season, seasonIndex } from '../sim/seasons';
import { hopperCount, nextUpgradePrice, robotCapacity, sellRobot, upgradeRobot } from '../sim/robots';
import { crowdedChicks, crowdedGoslings, dadCount, eggHatchIn, fertileStock, fertility, hatchesGeese, isIncubator, growthLabel, growthStage, incubatable, incubateAll, incubatingCount, loadIncubator, nextHatchIn, roosterCount, toggleIncubatorAuto } from '../sim/breeding';
import { birdThumb, buildingThumb, dogThumb, robotThumb } from '../render/thumbs';
import { parcelPerks } from '../sim/perks';
import { wildPlants } from '../sim/wild';
import { parcelKeyOfCell } from '../sim/core';
import { buyDog, checkBuyDog } from '../sim/dog';
import { DOG } from '../config/balance';
import { BREEDS, isGoose, skinName } from '../config/breeds';
import { BUILDINGS, type BuildingLevel } from '../config/buildings';
import * as A from '../sim/actions';
import { cleaningCost } from '../sim/buildings';
import { farmLevel, fmtMoney, maxParcelsOf } from '../sim/economy';
import { parcelGrass } from '../sim/grass';
import { actLabel, eggsPerDayOf, henStatus, henValue, productivity } from '../sim/hens';
import { hostedIncubators, incubatorSeat, nurseryCount, nurseryPlan, readyToLeave } from '../sim/nursery';
import { birdPrice, birdWord, petRoom, petShopOf, sellable, stockBird, unstockBird } from '../sim/petshop';
import { customersPerDay, lostToday, queueLength, standCounters } from '../sim/market';
import { buildingsOf, coopOccupancy, getBuilding, getHen, lvl, storageCapacity, storedCount } from '../sim/queries';
import { GRASS } from '../config/balance';
import type { Building, Hen, Robot, Worker, WorkerSkill } from '../sim/types';
import { ROLES } from '../config/staff';
import { SHOW_HOUR, eligible, enterShow, nextShowDay, showScore } from '../sim/show';
import { GeneStars } from './Show';
import { basketCount, buyWorkerSkill, endLabel, fire, startLabel } from '../sim/workers';
import { RestockToggle, workerStats, workerStatus } from './Team';
import { Bar, Btn, Chip, EggDot, Icon, WorkerFace, n1, useGame } from './common';
import { SellerCard } from './PetShop';

export function Inspector() {
  const game = useGame();
  const sel = game.selection;
  if (!sel || game.placing) return null;
  let body = null;
  if (sel.kind === 'hen') {
    const h = getHen(game.state, sel.id);
    if (h) body = <HenCard h={h} />;
  } else if (sel.kind === 'building') {
    const b = getBuilding(game.state, sel.id);
    if (b) body = <BuildingCard b={b} />;
  } else if (sel.kind === 'worker') {
    const w = game.state.workers.find((x) => x.id === sel.id);
    if (w) body = <WorkerCard w={w} />;
  } else if (sel.kind === 'dog') {
    body = game.state.dog ? <DogCard /> : <HouseDogCard />;
  } else if (sel.kind === 'robot') {
    const r = game.state.robots.find((x) => x.id === sel.id);
    if (r) body = <RobotCard r={r} />;
  } else if (sel.kind === 'parcel') body = <ParcelCard keyId={sel.key} />;
  else if (sel.kind === 'petbird') {
    const h = game.state.petShop.birds.find((x) => x.id === sel.id);
    if (h) body = <PetBirdCard h={h} />;
  } else if (sel.kind === 'petplot') body = petShopOf(game.state) ? null : <PetPlotCard />;
  if (!body) return null;
  return (
    <div class={`inspector card ${sel.kind === 'parcel' ? 'compact' : ''}`}>
      <button class="close" onClick={() => game.select(null)} title="Fermer">
        <Icon name="close" size={16} />
      </button>
      {body}
    </div>
  );
}

/** Le chien de la maison, pas encore adopté comme chien de garde. */
function HouseDogCard() {
  const game = useGame();
  const s = game.state;
  const chk = checkBuyDog(s);
  return (
    <div class="insp">
      <div class="insp-head">
        <img class="insp-pic" src={dogThumb()} alt="" />
        <div>
          <h3>Le chien de la maison</h3>
          <div class="chips">
            <Chip>Somnole devant le perron</Chip>
          </div>
        </div>
      </div>
      <p class="desc">Adoptez-le comme chien de garde : il fera sa ronde tout autour de l’enclos, à l’extérieur, et chassera les renards et les buses avant qu’ils n’approchent des poules.</p>
      <ul class="boosts">
        <li>Renards et buses ne s’approchent presque plus</li>
        <li>S’il en surgit un, il fonce en aboyant et le fait détaler</li>
        <li>Croquettes : {fmtMoney(DOG.upkeepPerDay)} par jour</li>
      </ul>
      <div class="actions">
        <Btn kind="primary" disabled={!chk.ok} title={chk.reason} onClick={() => game.act(() => buyDog(s), 'buy')}>
          Adopter · {fmtMoney(DOG.price)}
        </Btn>
      </div>
      {!chk.ok && chk.reason && <p class="hint">{chk.reason}</p>}
    </div>
  );
}

function DogCard() {
  const game = useGame();
  const s = game.state;
  const d = s.dog!;
  const what = d.act === 'chase' ? 'Fonce sur le prédateur en aboyant !' : d.act === 'sleep' ? 'Dort devant sa niche' : d.act === 'sit' ? 'Assis, il surveille les abords' : 'Fait sa ronde autour de l’enclos';
  return (
    <div class="insp">
      <div class="insp-head">
        <img class="insp-pic" src={dogThumb()} alt="" />
        <div>
          <h3>{d.name}</h3>
          <div class="chips">
            <Chip tone="blue">Chien de garde</Chip>
            <Chip>Croquettes {fmtMoney(DOG.upkeepPerDay)}/j</Chip>
          </div>
        </div>
      </div>
      <div class="activity">
        <span>{what}</span>
        <FollowBtn />
      </div>
      <ul class="boosts">
        <li>Renards et buses ne s’approchent presque plus de la ferme</li>
        <li>Il fait sa ronde autour de l’enclos, toujours à l’extérieur</li>
        <li>S’il en surgit un, il fonce en aboyant et le fait détaler (il lâche sa proie)</li>
        <li>Adopté le jour {d.boughtDay}</li>
      </ul>
    </div>
  );
}

const ROBOT_TASKS: Record<Robot['task'], string> = {
  idle: 'En attente',
  egg: 'Va ramasser un œuf au sol',
  nest: 'Vide un pondoir',
  unload: 'Décharge au stockage',
  dock: 'Retour à la borne',
};

function RobotCard({ r }: { r: Robot }) {
  const game = useGame();
  const s = game.state;
  const [confirm, setConfirm] = useState(false);
  const n = hopperCount(r);
  const up = nextUpgradePrice(r);
  const charging = r.task === 'dock' && !r.path.length;
  return (
    <div class="insp">
      <div class="insp-head">
        <img class="insp-pic" src={robotThumb()} alt="" />
        <div>
          <h3>Robot ramasseur</h3>
          <div class="chips">
            <Chip tone="blue">{r.level === 3 ? 'Niveau 3 · avale au vol' : r.level === 2 ? 'Niveau 2 · rapide' : 'Niveau 1'}</Chip>
            <Chip>Électricité {fmtMoney(ROBOT.upkeepPerDay)}/j</Chip>
          </div>
        </div>
      </div>
      <div class="activity">
        <span>{charging ? (r.battery >= 99 ? 'Sur sa borne, prêt à repartir' : 'En charge sur sa borne') : ROBOT_TASKS[r.task]}</span>
      </div>
      <Need label="Batterie" value={r.battery} />
      <div class="kv">
        <span>Bac</span>
        <b>
          {n} / {robotCapacity(r)} œufs
        </b>
      </div>
      <div class="kv">
        <span>Ramassés depuis l’achat (jour {r.boughtDay})</span>
        <b>{r.total} œufs</b>
      </div>
      <p class="hint">Il ramasse d’abord les œufs pondus au sol (avant qu’ils ne pourrissent), puis vide les pondoirs et décharge au stockage. Il reste à l’intérieur des clôtures, ne touche jamais une poule (il s’arrête, elle s’écarte, ou il la contourne) et retourne se recharger seul.</p>
      {up !== null && (
        <div class="actions">
          <Btn kind="primary" disabled={s.money < up} title={s.money < up ? 'Fonds insuffisants' : undefined} onClick={() => game.act(() => upgradeRobot(s, r.id), 'build')}>
            Niveau {r.level === 2 ? 3 : 2} · {fmtMoney(up)}
          </Btn>
          <small class="hint">
            {r.level === 2
              ? `Niveau 3 : il fonce à travers les œufs et les avale tous au vol, plusieurs à la fois, sans quasiment jamais s’arrêter ; encore plus rapide, il porte ${ROBOT.capacity3} œufs.`
              : `Niveau 2 : il file droit vers les œufs en virant sans s’arrêter, roule presque deux fois plus vite, avale les œufs deux fois plus vite et porte ${ROBOT.capacity2} œufs.`}
          </small>
        </div>
      )}
      <div class="actions small">
        {confirm ? (
          <>
            <Btn kind="danger" onClick={() => game.act(() => sellRobot(s, r.id), 'coin')}>
              Confirmer · +{fmtMoney(Math.round(ROBOT.price * ROBOT.resale))}
            </Btn>
            <Btn kind="ghost" onClick={() => setConfirm(false)}>
              Annuler
            </Btn>
          </>
        ) : (
          <Btn kind="ghost" onClick={() => setConfirm(true)}>
            Revendre
          </Btn>
        )}
      </div>
    </div>
  );
}

function FollowBtn() {
  const game = useGame();
  return (
    <button
      class={`follow ${game.follow ? 'on' : ''}`}
      title="La caméra suit la sélection"
      onClick={() => {
        game.follow = !game.follow;
        game.changed();
      }}
    >
      <Icon name="follow" size={14} /> {game.follow ? 'Suivie' : 'Suivre'}
    </button>
  );
}

/** Une volaille dans son parc, à la vente de poules pondeuses. */
function PetBirdCard({ h }: { h: Hen }) {
  const game = useGame();
  const s = game.state;
  const def = BREEDS[h.breed];
  const goose = isGoose(h.breed);
  const who = `${h.rooster ? 'Ce' : 'Cette'} ${birdWord(goose, 1, !!h.rooster)}`;
  return (
    <div class="insp">
      <div class="insp-head">
        <img class="avatar bld pic" src={birdThumb(h)} alt="" />
        <div>
          <h3>{h.name}</h3>
          <div class="chips">
            <Chip tone="blue">{def.name}</Chip>
            <Chip>À vendre</Chip>
          </div>
        </div>
      </div>
      {h.genes && <GeneStars h={h} />}
      <div class="kv">
        <span>{h.black ? 'Valeur, pour un revendeur' : 'Prix en boutique'}</span>
        <b>{fmtMoney(birdPrice(s, h))}</b>
      </div>
      <p class="hint">{h.ship ? `${who} part avec le camion du revendeur.` : h.black ? 'Ce coq noir attend le camion d’un revendeur, le seul à payer ce qu’il vaut. Vous pouvez encore changer d’avis.' : `${who} attend un client dans son parc. Vous pouvez encore changer d’avis.`}</p>
      <div class="actions">
        <Btn
          kind="primary"
          disabled={!!h.ship}
          onClick={() => {
            if (game.act(() => unstockBird(s, h.id), 'pop')) game.select(null);
          }}
        >
          <Icon name="close" size={15} /> Reprendre à la ferme
        </Btn>
        <Btn kind="soft" onClick={() => game.openPanel('market', 'pets')}>
          Gérer les prix
        </Btn>
      </div>
    </div>
  );
}

/** L'emplacement à droite du parking : on y fait construire la vente de poules, au niveau 15 et une fois la parcelle D3 achetée. */
function PetPlotCard() {
  const game = useGame();
  const s = game.state;
  const L = BUILDINGS.petshop.levels[0];
  const chk = A.checkBuild(s, 'petshop');
  const lv = farmLevel(s);
  return (
    <div class="insp">
      <div class="insp-head">
        <img class="avatar bld pic" src={buildingThumb('petshop', 1)} alt="" />
        <div>
          <h3>Emplacement de la vente de poules pondeuses</h3>
          <div class="chips">
            <Chip tone={chk.ok ? 'good' : 'warn'}>{lv < L.reqLevel ? `Niveau ${L.reqLevel} requis` : !s.parcels.includes(BIRD_ORDERS.parcel) ? `Parcelle ${BIRD_ORDERS.parcelName} à acheter` : 'Disponible'}</Chip>
          </div>
        </div>
      </div>
      <p class="hint">{BUILDINGS.petshop.description}</p>
      <div class="kv">
        <span>Pour commencer</span>
        <b>{L.capacity} volailles</b>
      </div>
      <div class="kv">
        <span>Au dernier niveau</span>
        <b>{BUILDINGS.petshop.levels[BUILDINGS.petshop.levels.length - 1].capacity} volailles</b>
      </div>
      <div class="actions">
        <Btn
          kind="primary"
          disabled={!chk.ok}
          title={chk.reason}
          onClick={() => {
            if (game.act(() => A.openPetShop(s), 'build')) {
              const b = petShopOf(s);
              if (b) game.select({ kind: 'building', id: b.id });
              game.toast('La vente de poules pondeuses est construite : embauchez un vendeur pour l’ouvrir, puis mettez-y des volailles.', 'good', '🐔');
            }
          }}
        >
          <Icon name="hammer" size={15} /> Construire · {fmtMoney(L.cost)}
        </Btn>
      </div>
      {!chk.ok && chk.reason && <small class="hint warn">{chk.reason}</small>}
      {!s.parcels.includes(BIRD_ORDERS.parcel) && (
        <div class="actions">
          <Btn
            kind="soft"
            onClick={() => {
              game.select({ kind: 'parcel', key: BIRD_ORDERS.parcel });
              game.renderer.focusOn(70, 20);
            }}
          >
            Voir la parcelle {BIRD_ORDERS.parcelName}
          </Btn>
        </div>
      )}
    </div>
  );
}

/** Les droits qu'on peut acheter pour un commis : une fois pour toutes, il s'en occupe ensuite tout seul. */
function WorkerSkills({ w }: { w: Worker }) {
  const game = useGame();
  const s = game.state;
  return (
    <div class="worker-skills">
      <h5>Options</h5>
      {(Object.keys(WORKER_SKILLS) as WorkerSkill[]).map((k) => {
        const d = WORKER_SKILLS[k];
        const has = !!w.skills?.includes(k);
        return (
          <div class={`worker-skill ${has ? 'on' : ''}`} key={k}>
            <span>
              <b>{d.name}</b>
              <small>{d.desc}</small>
            </span>
            {has ? (
              <Chip tone="good">Acquise</Chip>
            ) : (
              <Btn kind="primary" small disabled={s.money < d.price} title={s.money < d.price ? 'Fonds insuffisants' : undefined} onClick={() => game.act(() => buyWorkerSkill(s, w.id, k), 'coin')}>
                {fmtMoney(d.price)}
              </Btn>
            )}
          </div>
        );
      })}
    </div>
  );
}

function WorkerCard({ w }: { w: Worker }) {
  const game = useGame();
  const s = game.state;
  const def = ROLES[w.role];
  const st = workerStatus(w);
  const [confirm, setConfirm] = useState(false);
  const carried = basketCount(w);
  return (
    <div class="insp">
      <div class="insp-head">
        <div class="avatar bld" style={{ background: '#' + def.outfit.shirt.toString(16).padStart(6, '0') + '40' }}>
          <WorkerFace role={w.role} look={w.look} name={w.name} size={22} />
        </div>
        <div>
          <h3>{w.name}</h3>
          <div class="chips">
            <Chip tone="blue">{def.title}</Chip>
            <Chip>{fmtMoney(def.wage)}/j</Chip>
          </div>
        </div>
      </div>
      <div class="activity">
        <span>{st.label}</span>
        <FollowBtn />
      </div>
      {carried > 0 && (
        <div class="kv">
          <span>Panier</span>
          <b>{carried} œufs</b>
        </div>
      )}
      <div class="kv">
        <span>Aujourd’hui</span>
        <b>{workerStats(w, 'today') || '—'}</b>
      </div>
      <div class="kv">
        <span>Depuis l’embauche (jour {w.hiredDay})</span>
        <b>{workerStats(w, 'total') || '—'}</b>
      </div>
      <ul class="boosts">
        {def.boosts.map((b) => (
          <li key={b}>{b}</li>
        ))}
      </ul>
      <p class="hint">
        Horaires : {startLabel(w.role)} – {endLabel(w.role)}.
        {w.role === 'farmhand' ? ' Il ouvre les trappes à l’aube et ne rentre qu’après avoir enfermé les poules.' : ' Le soir, retour à la maison.'}
      </p>
      {w.role === 'farmhand' && <RestockToggle />}
      {w.role === 'farmhand' && <WorkerSkills w={w} />}
      <div class="actions small">
        {!confirm ? (
          <Btn kind="ghost" small onClick={() => setConfirm(true)}>
            Licencier
          </Btn>
        ) : (
          <Btn kind="danger" small onClick={() => game.act(() => fire(s, w.id))}>
            Confirmer le licenciement
          </Btn>
        )}
        <Btn kind="soft" small onClick={() => game.openPanel('team')}>
          Toute l’équipe
        </Btn>
      </div>
    </div>
  );
}

function Need({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div class="need" title={hint}>
      <span>{label}</span>
      <Bar value={value} tone="auto" />
      <b>{Math.round(value)}</b>
    </div>
  );
}

function ageLabel(age: number) {
  if (age < LAYING.rampDays) return 'Jeune pondeuse';
  if (age <= LAYING.declineStart) return 'Pleine ponte';
  if (age <= LAYING.declineEnd) return 'Vieille poule · ponte en baisse';
  return 'Poule âgée';
}

/** Coq, coquelet, poussin, poulette ; jars, oie, oison pour les oies. */
export function birdRole(h: Hen) {
  const goose = isGoose(h.breed);
  if (h.young) {
    if (growthStage(h) < 3) return goose ? 'Oison' : 'Poussin';
    if (goose) return h.rooster ? 'Jeune jars' : 'Jeune oie';
    return h.rooster ? 'Coquelet' : 'Poulette';
  }
  if (goose) return h.rooster ? 'Jars' : 'Oie';
  return h.rooster ? 'Coq' : 'Poule';
}

/** Jour et heure de jeu d'un instant (ex. « jour 47, 14 h »). */
function whenLabel(t: number) {
  t = Math.max(0, t);
  const day = Math.floor(t / TIME.DAY) + 1;
  const h = Math.floor(((t % TIME.DAY) / TIME.DAY) * 24);
  return `jour ${day}, ${h} h`;
}

/** Fiche de la poussinière : qui y grandit, et quand ils rejoindront le troupeau. */
/** Les emplacements de couveuse d'une poussinière : ce qui y est installé, et de quoi compléter. */
function NurserySeats({ b }: { b: Building }) {
  const game = useGame();
  const s = game.state;
  const seats = nurseryPlan(b.level).seats.length;
  const incs = hostedIncubators(s, b);
  const price = BUILDINGS.incubator.levels[0].cost;
  const next = BUILDINGS.nursery.levels[b.level];
  return (
    <>
      <div class="kv">
        <span>Couveuses</span>
        <b>
          {incs.length} / {seats} emplacement{seats > 1 ? 's' : ''}
        </b>
      </div>
      {incs.length > 0 && (
        <div class="inc-list">
          {incs.map((inc) => {
            const L = lvl(inc);
            const n = inc.hatch?.length ?? 0;
            const left = nextHatchIn(s, inc);
            return (
              <button type="button" class="inc-row seat" key={inc.id} onClick={() => game.select({ kind: 'building', id: inc.id })} title="Voir cette couveuse">
                <div class="inc-main">
                  <b>{L.name}</b>
                  <Bar value={n / Math.max(1, L.capacity)} max={1} tone="blue" thin />
                </div>
                <span class="inc-left">{n ? `${n}/${L.capacity} œufs${left !== null ? ` · ${left < 1 ? 'imminent' : `${Math.ceil(left)} j`}` : ''}` : 'Vide'}</span>
              </button>
            );
          })}
        </div>
      )}
      {incs.length < seats && (
        <div class="auto-door">
          <div>
            <b>Emplacement libre</b>
            <small>Une couveuse posée ici : ses poussins naîtront directement dans cette poussinière.</small>
          </div>
          <Btn kind="primary" small disabled={s.money < price} onClick={() => game.act(() => A.installIncubator(s, b.id), 'build')}>
            <Icon name="hammer" size={15} /> Installer · {fmtMoney(price)}
          </Btn>
        </div>
      )}
      {incs.length >= seats && next && <p class="hint">Tous les emplacements sont pris : {next.name.toLowerCase()} en offre {nurseryPlan(b.level + 1).seats.length}.</p>}
    </>
  );
}

function NurseryInfo({ b }: { b: Building }) {
  const game = useGame();
  const s = game.state;
  const L = lvl(b);
  const chicks = s.hens.filter((h) => h.nursery && h.coopId === b.id);
  const speed = L.growth ?? 1;
  // jours (de jeu) avant la sortie, regroupés : ceux qui sont nés ensemble sortiront ensemble
  const rows = new Map<number, number>();
  for (const h of chicks) {
    const left = readyToLeave(h) ? 0 : Math.ceil(((h.young ?? 0) - BREEDING.nurseryLeaveDays) / speed);
    rows.set(left, (rows.get(left) ?? 0) + 1);
  }
  const sorted = [...rows.entries()].sort((a, c) => a[0] - c[0]);
  const total = (BREEDING.growthDays - BREEDING.nurseryLeaveDays) / speed;
  return (
    <>
      <div class="kv">
        <span>Poussins</span>
        <b>
          {nurseryCount(s, b)} / {L.capacity}
        </b>
      </div>
      <div class="kv">
        <span>Croissance</span>
        <b>+{Math.round((speed - 1) * 100)} %</b>
      </div>
      {sorted.length > 0 && (
        <div class="inc-list">
          {sorted.map(([left, n]) => (
            <div class="inc-row" key={left}>
              <div class="inc-main">
                <b>{n > 1 ? `${n} poussins` : '1 poussin'}</b>
                <Bar value={1 - left / total} max={1} tone="blue" thin />
              </div>
              <span class="inc-left">{left <= 0 ? 'Sortie imminente' : `Sortie dans ${left} j`}</span>
            </div>
          ))}
        </div>
      )}
      <NurserySeats b={b} />
      <label class="nursery-out">
        <input type="checkbox" checked={!!b.letOut} onChange={(e) => game.act(() => A.setNurseryLetOut(s, b.id, (e.target as HTMLInputElement).checked))} />
        <span>
          <b>Laisser sortir l’excédent</b>
          <small>{b.letOut ? 'Quand elle est pleine, les plus grands poussins en trop sortent rejoindre les poules : les autres ne se marchent plus dessus.' : `Cochez pour que les poussins au-delà de ${L.capacity} sortent rejoindre les poules, au lieu de rester entassés (bien-être et santé en baisse).`}</small>
        </span>
      </label>
      {!sorted.length && <p class="hint">Aucun poussin pour l’instant. Ceux qui éclosent dans ses couveuses naissent ici directement.</p>}
      {(s.grain <= 0 || s.water <= 0) && <p class="hint warn">{s.grain <= 0 ? 'Plus de grain en réserve' : 'Plus d’eau en réserve'} : les poussins ont besoin de la réserve de la ferme.</p>}
      <p class="hint">Grain et eau sont pris dans la réserve. À l’abri du grillage, ni poules ni prédateurs. Quand il leur reste {BREEDING.nurseryLeaveDays} jours avant de pondre, ils sortent seuls rejoindre le troupeau.</p>
    </>
  );
}

function IncubatorInfo({ b }: { b: Building }) {
  const game = useGame();
  const s = game.state;
  const L = lvl(b);
  const list = b.hatch ?? [];
  const goose = hatchesGeese(b);
  const stock = fertileStock(s, goose);
  const canLoad = Math.min(stock, L.capacity - list.length);
  const crowd = goose ? crowdedGoslings(s) : crowdedChicks(s);
  const dads = dadCount(s, goose);
  // œufs mis ensemble (même race, même moment) regroupés sur une ligne, les plus avancés en premier
  const rows = new Map<string, { breed: Hen['breed']; t: number; n: number }>();
  for (const e of list) {
    const k = `${e.breed}|${Math.round(e.t)}`;
    const r = rows.get(k) ?? { breed: e.breed, t: e.t, n: 0 };
    r.n++;
    rows.set(k, r);
  }
  const sorted = [...rows.values()].sort((a, c) => a.t - c.t);
  const seatHost = incubatorSeat(s, b)?.host;
  return (
    <>
      {seatHost && (
        <button type="button" class="seat-host" onClick={() => game.select({ kind: 'building', id: seatHost.id })}>
          <Icon name="home" size={14} /> Installée dans : <b>{lvl(seatHost).name}</b>
        </button>
      )}
      <div class="kv">
        <span>En couvaison</span>
        <b>
          {list.length} / {L.capacity} œufs
        </b>
      </div>
      {sorted.length > 0 && (
        <div class="inc-list">
          {sorted.map((r) => {
            const left = eggHatchIn(s, r);
            return (
              <div class="inc-row" key={`${r.breed}${r.t}`}>
                <EggDot type={BREEDS[r.breed].egg} />
                <div class="inc-main">
                  <b>
                    {r.n > 1 ? `${r.n} œufs` : '1 œuf'} · {BREEDS[r.breed].name}
                  </b>
                  <small>Mis {whenLabel(r.t)}</small>
                  <Bar value={1 - left / BREEDING.incubationDays} max={1} tone="blue" thin />
                </div>
                <span class="inc-left">{left < 1 ? 'Éclosion imminente' : `${Math.ceil(left)} j`}</span>
              </div>
            );
          })}
        </div>
      )}
      <div class="kv">
        <span>{goose ? 'Œufs d’oie fécondés au garde-manger' : 'Œufs fécondés au garde-manger'}</span>
        <b>{stock}</b>
      </div>
      <div class="kv">
        <span>Fécondation</span>
        <b>
          {dads ? `${Math.round(fertility(s, goose) * 100)} % des œufs · ${dads} ${goose ? 'jars' : `coq${dads > 1 ? 's' : ''}`}` : goose ? 'aucun jars' : 'aucun coq'}
        </b>
      </div>
      {!dads && <p class="hint warn">{goose ? 'Sans jars, aucun œuf d’oie n’est fécondé : achetez-en un dans la boutique (rubrique Coqs et jars).' : 'Sans coq, aucun œuf n’est fécondé : achetez-en un dans la boutique (rubrique Poules).'}</p>}
      {goose && !s.buildings.some((o) => o.type === 'goosehouse') && <p class="hint warn">Il faut un abri à oies pour que les oisons aient où vivre.</p>}
      {goose && crowd > 0 && <p class="hint warn">Les abris à oies seront trop petits pour {crowd} futur{crowd > 1 ? 's' : ''} oison{crowd > 1 ? 's' : ''} : agrandissez-les bientôt.</p>}
      {!goose && crowd > 0 && (
        <p class="hint warn">
          La ferme est pleine : {crowd} futur{crowd > 1 ? 's' : ''} poussin{crowd > 1 ? 's' : ''} {crowd > 1 ? 'seront' : 'sera'} à l’étroit (bien-être en baisse). Achetez une parcelle ou agrandissez un poulailler.
        </p>
      )}
      <div class="actions">
        <Btn kind={canLoad > 0 ? 'primary' : 'soft'} disabled={canLoad <= 0} onClick={() => game.act(() => loadIncubator(s, b))} title={canLoad <= 0 ? (stock ? 'La couveuse est pleine' : 'Aucun œuf fécondé au garde-manger') : undefined}>
          {canLoad > 0 ? `Mettre ${canLoad} œuf${canLoad > 1 ? 's' : ''} en couveuse` : stock ? 'Couveuse pleine' : 'Aucun œuf fécondé'}
        </Btn>
        <Btn kind="ghost" onClick={() => game.act(() => toggleIncubatorAuto(s, b))} title="Les œufs fécondés ramassés partent directement en couveuse">
          {b.auto !== false ? '✓ Remplissage auto' : 'Remplissage auto : non'}
        </Btn>
      </div>
      <p class="desc">
        {goose
          ? `Chaque œuf éclot ${BREEDING.incubationDays} jours après sa mise en couveuse (les plus frais éclosent le mieux). L’oison sort tout seul, suit les oies et il est adulte à ${BREEDING.growthDays} jours.`
          : `Chaque œuf éclot ${BREEDING.incubationDays} jours après sa mise en couveuse (les plus frais éclosent le mieux). Les poussins naissent directement à la poussinière et pondent à ${BREEDING.growthDays} jours.`}
      </p>
    </>
  );
}

function HenCard({ h }: { h: Hen }) {
  const game = useGame();
  const s = game.state;
  const b = BREEDS[h.breed];
  const st = henStatus(h);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const coop = getBuilding(s, h.coopId);
  return (
    <div class="insp">
      <div class="insp-head">
        <img class="avatar bld pic" src={birdThumb(h)} alt="" />
        <div>
          {editing ? (
            <input
              class="name-input"
              value={h.name}
              maxLength={18}
              autoFocus
              onBlur={(e) => {
                A.renameHen(s, h.id, (e.target as HTMLInputElement).value);
                setEditing(false);
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            />
          ) : (
            <h3 onClick={() => setEditing(true)} title="Cliquer pour renommer">
              {h.name} <small>✎</small>
            </h3>
          )}
          <div class="chips">
            {!isGoose(h.breed) && <Chip>{b.name}</Chip>}
            {h.legendary ? <Chip tone="warn">Poule légendaire · immortelle, un œuf légendaire tous les 4 jours</Chip> : h.golden ? <Chip tone="warn">Poule aux œufs d’or · un œuf d’or tous les 2 jours</Chip> : h.black ? <Chip tone="warn">Entièrement noir · rarissime</Chip> : h.skin ? <Chip>{skinName(h.breed, h.skin)}</Chip> : null}
            {isGoose(h.breed) && growthStage(h) >= 3 ? <span class={`sex-chip ${h.rooster ? 'male' : 'female'}`}>{h.rooster ? '♂' : '♀'} {birdRole(h)}</span> : (h.rooster || h.young) && <Chip tone="blue">{birdRole(h)}</Chip>}
            <Chip tone={st.tone}>{st.label}</Chip>
          </div>
        </div>
      </div>
      <div class="activity">
        <span>{actLabel(h)}</span>
        <FollowBtn />
      </div>
      <Need label="Santé" value={h.health} />
      <Need label="Satiété" value={h.satiety} hint="Inverse de la faim : 100 = repue" />
      <Need label="Hydratation" value={h.hydration} hint="Inverse de la soif : 100 = désaltérée" />
      <Need label="Bien-être" value={h.wellbeing} hint="Confort du poulailler, propreté, herbe, espace" />
      <Need label="Protéines" value={h.protein ?? 0} hint="Vers et insectes du compost : bien-être, ponte et qualité des œufs" />
      <div class="gene-box">
        <div class="gb-head">
          <span>Qualités héréditaires</span>
          {!h.young && (
            <small title="Note estimée au concours agricole">
              Concours : <b>{showScore(h)}</b> pts
            </small>
          )}
        </div>
        <GeneStars h={h} />
        <small class="gb-note">{isGoose(h.breed) ? (h.rooster ? 'Il les transmet à ses oisons.' : 'Elle les transmet à ses oisons (avec le jars).') : h.rooster ? 'Il les transmet à ses poussins.' : 'Elle les transmet à ses poussins (avec le coq).'}</small>
      </div>
      <div class="grid2">
        <div>
          <span>Âge</span>
          <b>{Math.floor(h.age)} j</b>
          <small>{h.young ? 'Né à la ferme' : h.rooster ? 'Reproducteur' : ageLabel(h.age)}</small>
        </div>
        {h.young ? (
          <div>
            <span>Adulte dans</span>
            <b>{Math.ceil(h.young)} j</b>
            <small>{h.rooster ? (isGoose(h.breed) ? 'deviendra un jars' : 'deviendra un coq') : 'puis elle pondra'}</small>
          </div>
        ) : h.rooster ? (
          <div>
            <span>Œufs fécondés</span>
            <b>{Math.round(fertility(s) * 100)} %</b>
            <small>{isGoose(h.breed) ? `${dadCount(s, true)} jars` : `${dadCount(s, false)} coq${dadCount(s, false) > 1 ? 's' : ''}`} · 1 pour ~{BREEDING.hensPerRooster}</small>
          </div>
        ) : (
          <div>
            <span>Productivité</span>
            <b>{Math.round(productivity(h) * 100)} %</b>
            <small>≈ {n1(eggsPerDayOf(h))} œufs/jour</small>
          </div>
        )}
        <div>
          <span>{h.rooster || h.young ? 'Race' : 'Œufs pondus'}</span>
          <b>{h.rooster || h.young ? b.trait : h.eggsLaid}</b>
          <small>
            <EggDot type={h.legendary ? 'phenix' : h.golden ? 'or' : b.egg} /> {EGG_TYPES[h.legendary ? 'phenix' : h.golden ? 'or' : b.egg].short}
          </small>
        </div>
        <div>
          <span>Valeur</span>
          <b>{fmtMoney(henValue(h))}</b>
          <small>{coop ? lvl(coop).name : '—'}</small>
        </div>
      </div>
      {h.young ? (
        <div class="lay">
          <span>{growthLabel(h)}</span>
          <Bar value={1 - h.young / BREEDING.growthDays} max={1} tone="blue" thin />
        </div>
      ) : (
        !h.rooster && (
          <div class="lay">
            <span>Prochain œuf</span>
            <Bar value={Math.min(1, h.layProgress)} max={1} tone="blue" thin />
          </div>
        )
      )}
      <div class="actions">
        {!h.young &&
          (s.show.entryId === h.id ? (
            <Chip tone="good">Inscrite au concours</Chip>
          ) : (
            <Btn kind="soft" disabled={!eligible(h)} title={eligible(h) ? `Prochain concours : jour ${nextShowDay(s)}, ${SHOW_HOUR} h` : 'Elle doit être en bonne santé'} onClick={() => game.act(() => enterShow(s, h.id), 'buy')}>
              <Icon name="trophy" size={15} /> Inscrire au concours
            </Btn>
          ))}
        {(h.health < 95 || h.sick) && (
          <Btn kind={h.sick || h.health < HEALTH.warnAt ? 'primary' : 'soft'} onClick={() => game.act(() => A.healHen(s, h.id), 'buy')}>
            Soigner · {fmtMoney(HEALTH.vetCost)}
          </Btn>
        )}
        {!h.young && h.age >= LAYING.declineStart && (
          <Btn kind="soft" title="Elle pond moins : une association ou des particuliers seront heureux de l'accueillir" onClick={() => game.act(() => A.rehomeHen(s, h.id), 'pop')}>
            Confier à une association
          </Btn>
        )}
        {petShopOf(s) && sellable(h) && (
          <Btn kind="soft" disabled={petRoom(s) <= 0} title={petRoom(s) <= 0 ? 'Les parcs sont pleins' : h.black ? 'Il attendra dans son parc le camion d’un revendeur' : `${fmtMoney(birdPrice(s, h))} à la vente de poules pondeuses`} onClick={() => game.act(() => stockBird(s, h.id), 'pop')}>
            Mettre en vente · {fmtMoney(birdPrice(s, h))}
          </Btn>
        )}
        {!confirm ? (
          <Btn kind="ghost" title="Revente directe à prix cassé : la vente de poules pondeuses rapporte bien plus" onClick={() => setConfirm(true)}>
            Vendre · {fmtMoney(henValue(h))}
          </Btn>
        ) : (
          <Btn kind="danger" onClick={() => game.act(() => A.sellHen(s, h.id), 'coin')}>
            Confirmer la vente
          </Btn>
        )}
      </div>
    </div>
  );
}

function levelDiff(type: Building['type'], cur: BuildingLevel, next: BuildingLevel): string[] {
  const out: string[] = [];
  if (type === 'coop' || type === 'goosehouse') out.push(`Capacité ${cur.capacity} → ${next.capacity} ${type === 'goosehouse' ? 'oies' : 'poules'}`, `Confort ${Math.round((cur.comfort ?? 0) * 100)} → ${Math.round((next.comfort ?? 0) * 100)} %`);
  if (type === 'nest') out.push(`Capacité ${cur.capacity} → ${next.capacity} œufs`, `Qualité +${Math.round((next.quality ?? 0) * 100)} %`);
  if (type === 'feeder') out.push(`Capacité ${cur.capacity} → ${next.capacity} rations`, `Gaspillage ${Math.round((cur.waste ?? 0) * 100)} → ${Math.round((next.waste ?? 0) * 100)} %`, `${next.slots} places`);
  if (type === 'drinker') out.push(`Capacité ${cur.capacity} → ${next.capacity} L`, `${next.slots} places`);
  if (type === 'storage') out.push(`Capacité ${cur.capacity} → ${next.capacity} œufs`, `Vieillissement ×${cur.decay} → ×${next.decay}`);
  if (type === 'dustbath') out.push(`Bien-être +${cur.wellbeing} → +${next.wellbeing}`, `${cur.slots} → ${next.slots} places`);
  if (type === 'pond') out.push(`Réserve ${cur.capacity} → ${next.capacity} L`, `Pluie +${cur.regen} → +${next.regen} L/jour`, `Bien-être +${cur.wellbeing} → +${next.wellbeing}`);
  if (type === 'incubator' || type === 'gooseincubator') out.push(`Capacité ${cur.capacity} → ${next.capacity} œufs`, `Éclosion +${Math.round((next.quality ?? 0) * 100)} %`);
  if (type === 'petshop') out.push(`Parcs ${cur.capacity} → ${next.capacity} volailles`, `Clients ${cur.flow}/h → ${next.flow}/h`);
  if (type === 'nursery') out.push('Couveuses : 1 → 2 emplacements', `Capacité ${cur.capacity} → ${next.capacity} poussins`, `Croissance +${Math.round(((cur.growth ?? 1) - 1) * 100)} % → +${Math.round(((next.growth ?? 1) - 1) * 100)} %`);
  if (type === 'stand') out.push(`Clients ${cur.flow}/h → ${next.flow}/h`, `Paniers ×${cur.qtyMult} → ×${next.qtyMult}`);
  if (next.perk) out.push(next.perk);
  const w0 = cur.w ?? BUILDINGS[type].w;
  const w1 = next.w ?? BUILDINGS[type].w;
  if (w1 !== w0) out.push(`S’allonge : ${w0} → ${w1} cases de long (décalé si besoin)`);
  out.push(`Entretien ${fmtMoney(cur.upkeep)} → ${fmtMoney(next.upkeep)}/j`);
  return out;
}

function BuildingCard({ b }: { b: Building }) {
  const game = useGame();
  const s = game.state;
  const def = BUILDINGS[b.type];
  const L = lvl(b);
  const next = def.levels[b.level];
  const [confirm, setConfirm] = useState(false);
  const up = A.checkUpgrade(s, b.id);
  const dem = A.checkDemolish(s, b.id);
  const ratio = L.capacity ? b.stock / L.capacity : 0;
  return (
    <div class="insp">
      <div class="insp-head">
        <img class="avatar bld pic" src={buildingThumb(b.type, b.level)} alt="" />
        <div>
          <h3>{L.name}</h3>
          <div class="chips">
            <Chip tone="blue">
              Niveau {b.level}/{def.levels.length}
            </Chip>
            <Chip>Entretien {fmtMoney(L.upkeep)}/j</Chip>
          </div>
        </div>
      </div>
      <p class="desc">{def.description}</p>

      {(b.type === 'coop' || b.type === 'goosehouse') && (
        <>
          <div class="kv">
            <span>Occupation</span>
            <b>
              {coopOccupancy(s, b.id)} / {L.capacity} {b.type === 'goosehouse' ? 'oies' : 'poules'}
            </b>
          </div>
          <div class="kv">
            <span>Confort</span>
            <b>{Math.round((L.comfort ?? 0) * 100)} %</b>
          </div>
          <Need label="Propreté" value={b.cleanliness} />
          <div class="kv">
            <span>Trappe{b.autoDoor ? ' automatique' : ''}</span>
            <b>
              {b.closed ? 'fermée' : 'ouverte'} · {s.hens.filter((h) => h.coopId === b.id && h.act === 'sleep').length} à l’abri
            </b>
          </div>
          {b.autoDoor ? (
            <p class="hint good">Trappe automatique : elle s’ouvre seule au lever du jour et se ferme la nuit, dès que {b.type === 'goosehouse' ? 'toutes les oies sont rentrées' : 'toutes les poules sont rentrées'}.</p>
          ) : (
            <div class="auto-door">
              <div>
                <b>Trappe automatique</b>
                <small>Elle s’ouvre au lever du jour et se ferme la nuit, {b.type === 'goosehouse' ? 'oies' : 'poules'} rentrées : à l’abri du renard sans y penser.</small>
              </div>
              <Btn kind="primary" small disabled={s.money < AUTO_DOOR.cost} onClick={() => game.act(() => A.buyAutoDoor(s, b.id), 'build')}>
                <Icon name="auto" size={15} /> Poser · {fmtMoney(AUTO_DOOR.cost)}
              </Btn>
            </div>
          )}
          <div class="actions">
            <Btn kind={b.cleanliness < 50 ? 'primary' : 'soft'} disabled={b.cleanliness > 92} onClick={() => game.act(() => A.cleanCoop(s, b.id), 'build')}>
              <Icon name="broom" size={15} /> Nettoyer · {fmtMoney(cleaningCost(b))}
            </Btn>
            <Btn kind="ghost" onClick={() => game.act(() => A.toggleCoopDoor(s, b.id))} title="La nuit, une trappe fermée protège les poules endormies du renard">
              <Icon name={b.closed ? 'unlock' : 'lock'} size={15} /> {b.closed ? 'Ouvrir la trappe' : 'Fermer la trappe'}
            </Btn>
          </div>
        </>
      )}
      {isIncubator(b) && <IncubatorInfo b={b} />}
      {b.type === 'nursery' && <NurseryInfo b={b} />}
      {b.type === 'petshop' && (
        <>
          <div class="kv">
            <span>En vente</span>
            <b>
              {s.petShop.birds.length} / {L.capacity} volailles
            </b>
          </div>
          <div class="kv">
            <span>Poules · oies</span>
            <b>
              {s.petShop.birds.filter((x) => !isGoose(x.breed)).length} · {s.petShop.birds.filter((x) => isGoose(x.breed)).length}
            </b>
          </div>
          <SellerCard />
          <div class="actions">
            <Btn kind="primary" onClick={() => game.openPanel('market', 'pets')}>
              <Icon name="sell" size={15} /> Gérer les ventes et les prix
            </Btn>
          </div>
        </>
      )}
      {b.type === 'compost' && (
        <>
          <div class="kv">
            <span>Vers et insectes</span>
            <b>
              {Math.floor(b.stock)} / {L.capacity} portions
            </b>
          </div>
          <Need label="Garni" value={(b.stock / Math.max(1, L.capacity)) * 100} />
          <div class="kv">
            <span>Production</span>
            <b>+{L.regen} portions / jour</b>
          </div>
          <p class="desc">
            Les poules qui s’y régalent de vers et d’insectes en profitent pendant environ deux jours :
          </p>
          <ul class="effects">
            <li>
              <b>Ponte +{Math.round(COMPOST.laying * 100)} %</b> et œufs plus riches
            </li>
            <li>
              <b>Grain −{Math.round(COMPOST.grainSaving * 100)} %</b> : les vers remplacent une partie de la ration
            </li>
            <li>
              <b>Bien-être +{COMPOST.wellbeing}</b>
            </li>
          </ul>
        </>
      )}
      {b.type === 'nest' && (
        <>
          <div class="kv">
            <span>Œufs au nid</span>
            <b>
              {b.eggIds.length} / {L.capacity}
            </b>
          </div>
          <Bar value={b.eggIds.length} max={L.capacity} tone={b.eggIds.length >= L.capacity ? 'bad' : 'blue'} />
          {L.autoCollect && <p class="hint">Les œufs roulent automatiquement vers le stockage chaque heure.</p>}
          {b.eggIds.length >= L.capacity && <p class="hint warn">Pondoir plein : les poules pondent au sol !</p>}
          <div class="actions">
            <Btn kind="primary" disabled={!b.eggIds.length} onClick={() => game.act(() => A.collectFromNest(s, b.id), 'pop')} tut="nest">
              <Icon name="basket" size={15} /> Ramasser {b.eggIds.length || ''}
            </Btn>
          </div>
        </>
      )}
      {b.type === 'feeder' && (
        <>
          <div class="kv">
            <span>Grain</span>
            <b>
              {n1(b.stock)} / {L.capacity} rations
            </b>
          </div>
          <Bar value={ratio} max={1} tone="auto" />
          <div class="kv">
            <span>Réserve de grain</span>
            <b>{Math.floor(s.grain)} rations</b>
          </div>
          <p class="hint">
            {L.auto ? 'Se remplit seule depuis le stock de grain.' : 'Remplissage manuel depuis le stock de grain.'} Gaspillage {Math.round((L.waste ?? 0) * 100)} % · {L.slots} places.
          </p>
          <div class="actions">
            {!L.auto && (
              <Btn kind={ratio < 0.4 ? 'primary' : 'soft'} onClick={() => game.act(() => A.refillFeeder(s, b.id), 'grain')} tut="feeder">
                <Icon name="wheat" size={15} /> Remplir
              </Btn>
            )}
            <Btn kind="ghost" onClick={() => game.openPanel('shop', 'grain')}>
              Acheter du grain
            </Btn>
          </div>
        </>
      )}
      {b.type === 'drinker' && (
        <>
          <div class="kv">
            <span>Eau</span>
            <b>
              {n1(b.stock)} / {L.capacity} L
            </b>
          </div>
          <Bar value={ratio} max={1} tone="auto" />
          <div class="kv">
            <span>Cuve d’eau</span>
            <b class={s.water < 1 ? 'neg' : ''}>{Math.floor(s.water)} L</b>
          </div>
          <p class="hint">{L.auto ? 'Se remplit seul depuis la cuve d’eau.' : 'Seau à remplir à la main depuis la cuve d’eau.'} L’eau s’achète en boutique (≈ 0,04 €/L).</p>
          <div class="actions">
            {!L.auto && (
              <Btn kind={ratio < 0.4 ? 'primary' : 'soft'} onClick={() => game.act(() => A.refillDrinker(s, b.id), 'water')}>
                <Icon name="drop" size={15} /> Remplir
              </Btn>
            )}
            <Btn kind="ghost" onClick={() => game.openPanel('shop', 'grain')}>
              Acheter de l’eau
            </Btn>
          </div>
        </>
      )}
      {b.type === 'storage' && <StorageInfo />}
      {b.type === 'stand' && (
        <>
          <div class="kv">
            <span>Clients attendus</span>
            <b>≈ {Math.round(customersPerDay(s))} / jour</b>
          </div>
          <div class="kv">
            <span>File d’attente</span>
            <b>
              {queueLength(s)} en attente · {standCounters(s)} guichet{standCounters(s) > 1 ? 's' : ''}
            </b>
          </div>
          {lostToday(s) > 0 && (
            <div class="kv">
              <span>Partis sans acheter</span>
              <b class="neg">{lostToday(s)} aujourd’hui</b>
            </div>
          )}
          <div class="kv">
            <span>Réputation</span>
            <b>★ {Math.round(s.reputation)} / 100</b>
          </div>
          <div class="actions">
            <Btn kind="primary" onClick={() => game.openPanel('market')} tut="stand">
              Gérer les prix et ventes
            </Btn>
          </div>
        </>
      )}
      {b.type === 'pond' && (
        <>
          <div class="kv">
            <span>Eau de pluie</span>
            <b>
              {n1(b.stock)} / {L.capacity} L
            </b>
          </div>
          <Bar value={b.stock / Math.max(1, L.capacity)} max={1} tone="blue" />
          <div class="kv">
            <span>Remplissage</span>
            <b>+{Math.round((L.regen ?? 0) * NATURE.rainBySeason[seasonIndex(s)])} L / jour ({season(s).name.toLowerCase()})</b>
          </div>
          <ul class="effects">
            <li>
              <b>Eau gratuite</b> : les poules qui y boivent n’entament pas la cuve
            </li>
            <li>
              <b>Soif −{Math.round((NATURE.pondThirst[b.level] ?? 0) * 100)} %</b> et <b>bien-être +{L.wellbeing}</b> sur la parcelle (fraîcheur)
            </li>
          </ul>
        </>
      )}
      {b.type === 'tree' && (
        <ul class="effects">
          <li>
            <b>Bien-être +{L.wellbeing}</b> par arbre sur la parcelle (jusqu’à +{NATURE.shadeMax})
          </li>
          <li>
            <b>Soif −{Math.round(NATURE.treeThirst * 100)} %</b> par arbre, davantage en été (jusqu’à −{Math.round(NATURE.treeThirstMax * 100)} %)
          </li>
          <li>
            <b>Abri contre les buses</b> : une poule sous ses branches ne peut pas être attrapée, et elles y courent quand une buse pique
          </li>
        </ul>
      )}
      {b.type === 'dustbath' && (
        <ul class="effects">
          <li>
            <b>Bien-être +{L.wellbeing}</b> pour les poules de la parcelle
          </li>
          <li>
            <b>Maladies −{Math.round((1 - (NATURE.dustSick[b.level] ?? 1)) * 100)} %</b> : les poules du poulailler voisin se débarrassent des parasites
          </li>
        </ul>
      )}

      {next ? (
        <div class="upgrade">
          <div class="up-title">
            Amélioration → <b>{next.name}</b>
          </div>
          <ul>
            {levelDiff(b.type, L, next).map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <Btn kind="primary" block disabled={!up.ok} onClick={() => game.act(() => A.upgrade(s, b.id), 'build')} title={up.reason}>
            {up.ok || up.reason === 'Fonds insuffisants' ? `Améliorer · ${fmtMoney(next.cost)}` : up.reason}
          </Btn>
          {!up.ok && up.reason === 'Fonds insuffisants' && <small class="muted">Il vous manque {fmtMoney(next.cost - s.money)}</small>}
        </div>
      ) : (
        <p class="hint good">Niveau maximum atteint.</p>
      )}
      <div class="actions small">
        {def.movable && (
          <Btn kind="ghost" small onClick={() => game.startPlacing(b.type, b.id)}>
            <Icon name="move" size={14} /> Déplacer
          </Btn>
        )}
        {def.movable && !A.clearingCost(b) && (
          <Btn kind="ghost" small onClick={() => game.act(() => A.rotate(s, b.id), 'build')} title="Pivoter d’un quart de tour (4 appuis = un tour complet)">
            <Icon name="rotate" size={14} /> Pivoter
          </Btn>
        )}
        {!def.unique &&
          (!confirm ? (
            <Btn kind="ghost" small disabled={!dem.ok} title={dem.reason} onClick={() => setConfirm(true)}>
              {A.clearingCost(b) ? `Enlever · ${fmtMoney(A.clearingCost(b))}` : A.demolishRefund(s, b.id) > 0 ? `Démonter (+${fmtMoney(A.demolishRefund(s, b.id))})` : 'Démonter'}
            </Btn>
          ) : (
            <Btn kind="danger" small onClick={() => game.act(() => A.demolish(s, b.id), 'build')}>
              {A.clearingCost(b) ? `Confirmer · ${fmtMoney(A.clearingCost(b))}` : 'Confirmer le démontage'}
            </Btn>
          ))}
      </div>
    </div>
  );
}

function StorageInfo() {
  const game = useGame();
  const s = game.state;
  const n = storedCount(s);
  const cap = storageCapacity(s);
  const fertile = fertileStock(s);
  const chickStock = fertileStock(s, false);
  const gooseStock = fertileStock(s, true);
  const noChickInc = chickStock > 0 && !buildingsOf(s, 'incubator').length;
  const noGooseInc = gooseStock > 0 && !buildingsOf(s, 'gooseincubator').length;
  const hatching = incubatingCount(s);
  const placeable = incubatable(s);
  const groups = new Map<string, { type: keyof typeof EGG_TYPES; grade: keyof typeof GRADES; count: number; fresh: number; fertile: boolean }>();
  for (const l of s.lots) {
    const k = `${l.type}-${l.grade}-${l.fertile ? 'f' : ''}`;
    const g = groups.get(k) ?? { type: l.type, grade: l.grade, count: 0, fresh: 0, fertile: !!l.fertile };
    g.fresh = (g.fresh * g.count + l.freshness * l.count) / (g.count + l.count);
    g.count += l.count;
    groups.set(k, g);
  }
  const list = [...groups.values()].sort((a, b) => Number(a.fertile) - Number(b.fertile));
  return (
    <>
      <div class="kv">
        <span>Œufs stockés</span>
        <b>
          {n} / {cap}
        </b>
      </div>
      <Bar value={n} max={cap} tone={n >= cap ? 'bad' : 'blue'} />
      <div class="egg-split">
        <div>
          <span>À vendre</span>
          <b>{n - fertile}</b>
          <small>œufs ordinaires</small>
        </div>
        <div class={fertile ? 'fert' : ''}>
          <span>Fécondés</span>
          <b>{fertile}</b>
          <small>{roosterCount(s) ? 'pour la couveuse' : 'il faut un coq'}</small>
        </div>
        <div>
          <span>En couveuse</span>
          <b>{hatching}</b>
          <small>{hatching ? 'en train de couver' : 'vide'}</small>
        </div>
      </div>
      {fertile > 0 && buildingsOf(s, 'incubator').length + buildingsOf(s, 'gooseincubator').length > 0 && (
          <>
            <Btn kind="primary" block disabled={placeable <= 0} onClick={() => game.act(() => incubateAll(s), 'pop')}>
              <Icon name="egg" size={15} />{' '}
              {placeable <= 0
                ? 'Mettre en couveuse'
                : placeable === fertile
                  ? `Mettre ${fertile > 1 ? `les ${fertile} œufs fécondés` : 'l’œuf fécondé'} en couveuse`
                  : `Mettre ${placeable} œuf${placeable > 1 ? 's' : ''} sur ${fertile} en couveuse`}
            </Btn>
            {placeable < fertile && !noChickInc && !noGooseInc && <p class="hint warn">{placeable ? 'Il ne reste pas assez de place dans' : 'Plus de place dans'} la couveuse : améliorez-la ou construisez-en une autre.</p>}
          </>
        )}
      {(noChickInc || noGooseInc) && (
        <div class="hint warn">
          {noChickInc && noGooseInc
            ? 'Ces œufs peuvent éclore : installez une couveuse dans une poussinière pour les poules, et construisez une couveuse à oies (Boutique → Bâtiments).'
            : noGooseInc
              ? 'Ces œufs d’oie peuvent donner des oisons : construisez une couveuse à oies (Boutique → Bâtiments).'
              : 'Ces œufs peuvent donner des poussins : installez une couveuse dans une poussinière (Boutique → Bâtiments).'}{' '}
          <button class="link" onClick={() => game.openPanel('shop', 'buildings')}>
            Voir les couveuses
          </button>
        </div>
      )}
      <div class="lots">
        {list.map((g) => (
          <div class={`lot ${g.fertile ? 'fert' : ''}`} key={`${g.type}${g.grade}${g.fertile}`}>
            <EggDot type={g.type} />
            <span>
              {EGG_TYPES[g.type].short}
              {g.fertile && <em class="fert-tag">fécondé</em>}
            </span>
            <Chip tone={g.grade === 'extra' ? 'good' : g.grade === 'B' ? 'warn' : 'neutral'}>{GRADES[g.grade].name}</Chip>
            <b>{g.count}</b>
            <small title="Fraîcheur">fraîcheur {Math.round(g.fresh)} %</small>
          </div>
        ))}
        {groups.size === 0 && <p class="hint">Aucun œuf en stock.</p>}
      </div>
      <div class="actions">
        <Btn kind="primary" onClick={() => game.openPanel('market')}>
          Vendre des œufs
        </Btn>
      </div>
    </>
  );
}

function ParcelCard({ keyId }: { keyId: string }) {
  const game = useGame();
  const s = game.state;
  const owned = s.parcels.includes(keyId);
  const [c, r] = keyId.split(',').map(Number);
  const name = `Parcelle ${String.fromCharCode(65 + c)}${r + 1}`;
  if (owned) {
    const g = parcelGrass(s, keyId);
    const hens = s.hens.filter((h) => parcelKeyOfCell(Math.floor(h.x), Math.floor(h.z)) === keyId).length;
    const pk = parcelPerks(s, keyId);
    const effects: string[] = [];
    if (pk.wellbeing) effects.push(`Bien-être +${pk.wellbeing}`);
    if (pk.sick < 1) effects.push(`Maladies −${Math.round((1 - pk.sick) * 100)} %`);
    if (pk.thirst < 1) effects.push(`Soif −${Math.round((1 - pk.thirst) * 100)} %`);
    if (pk.trees) effects.push(`Abri des buses (${pk.trees} arbre${pk.trees > 1 ? 's' : ''})`);
    return (
      <div class="insp parcel-mini">
        <div class="insp-head">
          <div class="avatar bld">
            <Icon name="sprout" size={18} />
          </div>
          <div>
            <h3>{name}</h3>
            <div class="chips">
              <Chip tone="good">Votre terrain</Chip>
              <Chip>{WORLD.PARCEL} × {WORLD.PARCEL} m</Chip>
            </div>
          </div>
        </div>
        <Need label="Herbe" value={g * 100} hint="Nourriture naturelle : les poules la picorent, elle repousse lentement" />
        <div class="pm-line">
          <span>
            <b>{hens}</b> poule{hens > 1 ? 's' : ''} ici
          </span>
          <span>
            capacité <b>+{PARCELS.hensPerParcel}</b>
          </span>
        </div>
        {effects.length > 0 ? (
          <div class="pm-effects">
            {effects.map((e) => (
              <span key={e}>{e}</span>
            ))}
          </div>
        ) : (
          <small class="pm-tip">Bains, mares, arbres et compost rendent les poules de la parcelle plus heureuses et productives.</small>
        )}
        <div class="actions">
          <Btn small kind={g < 0.4 ? 'primary' : 'soft'} onClick={() => game.act(() => A.reseed(s, keyId), 'grain')}>
            <Icon name="sprout" size={14} /> Ressemer · {fmtMoney(GRASS.reseedCost)}
          </Btn>
          <Btn small kind="ghost" onClick={() => game.openPanel('shop', 'buildings')}>
            <Icon name="hammer" size={14} /> Aménager
          </Btn>
        </div>
      </div>
    );
  }
  const chk = A.checkBuyParcel(s, keyId);
  const price = parcelPrice(s.parcels.length);
  return (
    <div class="insp">
      <div class="insp-head">
        <div class="avatar bld">
          <Icon name="map" size={22} />
        </div>
        <div>
          <h3>{name}</h3>
          <div class="chips">
            <Chip tone="blue">À vendre</Chip>
            <Chip>{WORLD.PARCEL} × {WORLD.PARCEL} m</Chip>
          </div>
        </div>
      </div>
      <p class="desc">Une prairie verdoyante : +{PARCELS.hensPerParcel} poules de capacité, de l’herbe fraîche et de la place pour construire.</p>
      {keyId === BIRD_ORDERS.parcel && <p class="hint">Le chemin de terre arrive ici, au grand portail : il faut cette parcelle pour vendre vos poules pondeuses.</p>}
      {(() => {
        const wild = wildPlants(c, r);
        const trees = wild.filter((p) => p.kind === 'tree').length;
        const bushes = wild.length - trees;
        return (
          <p class="hint">
            Elle garde ses {trees} arbres et ses {bushes} buissons : les arbres profitent déjà aux poules (ombre, fraîcheur, abri contre les buses). Pour construire à leur place, un arbre s’enlève pour {fmtMoney(CLEARING.tree)}, un buisson pour {fmtMoney(CLEARING.bush)}.
          </p>
        );
      })()}
      <div class="kv">
        <span>Prix</span>
        <b>{fmtMoney(price)}</b>
      </div>
      <div class="kv">
        <span>Taxe foncière</span>
        <b>{fmtMoney(30)} / jour</b>
      </div>
      <div class="kv">
        <span>Parcelles</span>
        <b>
          {s.parcels.length} / {maxParcelsOf(s)}
        </b>
      </div>
      <div class="actions">
        <Btn kind="primary" block disabled={!chk.ok} onClick={() => game.act(() => A.buyParcel(s, keyId), 'level')}>
          {chk.ok ? `Acheter · ${fmtMoney(price)}` : chk.reason}
        </Btn>
      </div>
    </div>
  );
}
