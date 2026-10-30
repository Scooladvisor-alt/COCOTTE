import { useState } from 'preact/hooks';
import { BREEDING, COMPOST, EGG_TYPES, TIME, GRADES, HEALTH, LAYING, NATURE, PARCELS, ROBOT, parcelPrice, WORLD } from '../config/balance';
import { season, seasonIndex } from '../sim/seasons';
import { hopperCount, sellRobot } from '../sim/robots';
import { crowdedChicks, eggHatchIn, fertileStock, fertility, growthLabel, growthStage, incubatable, incubateAll, incubatingCount, loadIncubator, roosterCount, toggleIncubatorAuto } from '../sim/breeding';
import { birdThumb, buildingThumb, dogThumb, robotThumb } from '../render/thumbs';
import { parcelPerks } from '../sim/perks';
import { parcelKeyOfCell } from '../sim/core';
import { buyDog, checkBuyDog } from '../sim/dog';
import { DOG } from '../config/balance';
import { BREEDS, skinName } from '../config/breeds';
import { BUILDINGS, type BuildingLevel } from '../config/buildings';
import * as A from '../sim/actions';
import { cleaningCost } from '../sim/buildings';
import { fmtMoney, maxParcelsOf } from '../sim/economy';
import { parcelGrass } from '../sim/grass';
import { ACT_LABELS, eggsPerDayOf, henStatus, henValue, productivity } from '../sim/hens';
import { customersPerDay, lostToday, queueLength, standCounters } from '../sim/market';
import { buildingsOf, coopOccupancy, getBuilding, getHen, lvl, storageCapacity, storedCount } from '../sim/queries';
import { GRASS } from '../config/balance';
import type { Building, Hen, Robot, Worker } from '../sim/types';
import { ROLES } from '../config/staff';
import { SHOW_HOUR, eligible, enterShow, nextShowDay, showScore } from '../sim/show';
import { GeneStars } from './Show';
import { basketCount, endLabel, fire, startLabel } from '../sim/workers';
import { RestockToggle, workerStats, workerStatus } from './Team';
import { Bar, Btn, Chip, EggDot, Icon, WorkerFace, n1, useGame } from './common';

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
  const charging = r.task === 'dock' && !r.path.length;
  return (
    <div class="insp">
      <div class="insp-head">
        <img class="insp-pic" src={robotThumb()} alt="" />
        <div>
          <h3>Robot ramasseur</h3>
          <div class="chips">
            <Chip tone="blue">Autonome</Chip>
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
          {n} / {ROBOT.capacity} œufs
        </b>
      </div>
      <div class="kv">
        <span>Ramassés depuis l’achat (jour {r.boughtDay})</span>
        <b>{r.total} œufs</b>
      </div>
      <p class="hint">Il ramasse d’abord les œufs pondus au sol (avant qu’ils ne pourrissent), puis vide les pondoirs et décharge au stockage. Il reste à l’intérieur des clôtures et retourne se recharger seul.</p>
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

/** Coq, coquelet, poussin ou poulette. */
export function birdRole(h: Hen) {
  if (h.young) return growthStage(h) < 3 ? 'Poussin' : h.rooster ? 'Coquelet' : 'Poulette';
  return h.rooster ? 'Coq' : 'Poule';
}

/** Jour et heure de jeu d'un instant (ex. « jour 47, 14 h »). */
function whenLabel(t: number) {
  t = Math.max(0, t);
  const day = Math.floor(t / TIME.DAY) + 1;
  const h = Math.floor(((t % TIME.DAY) / TIME.DAY) * 24);
  return `jour ${day}, ${h} h`;
}

function IncubatorInfo({ b }: { b: Building }) {
  const game = useGame();
  const s = game.state;
  const L = lvl(b);
  const list = b.hatch ?? [];
  const stock = fertileStock(s);
  const canLoad = Math.min(stock, L.capacity - list.length);
  const crowd = crowdedChicks(s);
  // œufs mis ensemble (même race, même moment) regroupés sur une ligne, les plus avancés en premier
  const rows = new Map<string, { breed: Hen['breed']; t: number; n: number }>();
  for (const e of list) {
    const k = `${e.breed}|${Math.round(e.t)}`;
    const r = rows.get(k) ?? { breed: e.breed, t: e.t, n: 0 };
    r.n++;
    rows.set(k, r);
  }
  const sorted = [...rows.values()].sort((a, c) => a.t - c.t);
  return (
    <>
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
        <span>Œufs fécondés au garde-manger</span>
        <b>{stock}</b>
      </div>
      <div class="kv">
        <span>Fécondation</span>
        <b>
          {roosterCount(s) ? `${Math.round(fertility(s) * 100)} % des œufs · ${roosterCount(s)} coq${roosterCount(s) > 1 ? 's' : ''}` : 'aucun coq'}
        </b>
      </div>
      {!roosterCount(s) && <p class="hint warn">Sans coq, aucun œuf n’est fécondé : achetez-en un dans la boutique (rubrique Poules).</p>}
      {crowd > 0 && (
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
        Chaque œuf éclot {BREEDING.incubationDays} jours après sa mise en couveuse (les plus frais éclosent le mieux). Les poussins suivent les poules et pondent à {BREEDING.growthDays} jours.
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
            <Chip>{b.name}</Chip>
            {h.golden ? <Chip tone="warn">Poule aux œufs d’or · un œuf d’or tous les 2 jours</Chip> : h.black ? <Chip tone="warn">Entièrement noir · rarissime</Chip> : h.skin ? <Chip>{skinName(h.breed, h.skin)}</Chip> : null}
            {(h.rooster || h.young) && <Chip tone="blue">{birdRole(h)}</Chip>}
            <Chip tone={st.tone}>{st.label}</Chip>
          </div>
        </div>
      </div>
      <div class="activity">
        <span>{ACT_LABELS[h.act]}</span>
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
        <small class="gb-note">{h.rooster ? 'Il les transmet à ses poussins.' : 'Elle les transmet à ses poussins (avec le coq).'}</small>
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
            <small>{h.rooster ? 'deviendra un coq' : 'puis elle pondra'}</small>
          </div>
        ) : h.rooster ? (
          <div>
            <span>Œufs fécondés</span>
            <b>{Math.round(fertility(s) * 100)} %</b>
            <small>{roosterCount(s)} coq{roosterCount(s) > 1 ? 's' : ''} · 1 pour ~{BREEDING.hensPerRooster}</small>
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
            <EggDot type={b.egg} /> {EGG_TYPES[b.egg].short}
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
        {!confirm ? (
          <Btn kind="ghost" onClick={() => setConfirm(true)}>
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
  if (type === 'dustbath') out.push(`Bien-être +${cur.wellbeing} → +${next.wellbeing}`);
  if (type === 'pond') out.push(`Réserve ${cur.capacity} → ${next.capacity} L`, `Pluie +${cur.regen} → +${next.regen} L/jour`, `Bien-être +${cur.wellbeing} → +${next.wellbeing}`);
  if (type === 'incubator') out.push(`Capacité ${cur.capacity} → ${next.capacity} œufs`, `Éclosion +${Math.round((next.quality ?? 0) * 100)} %`);
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
            <span>Trappe</span>
            <b>
              {b.closed ? 'fermée' : 'ouverte'} · {s.hens.filter((h) => h.coopId === b.id && h.act === 'sleep').length} à l’abri
            </b>
          </div>
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
      {b.type === 'incubator' && <IncubatorInfo b={b} />}
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
        {!def.unique &&
          (!confirm ? (
            <Btn kind="ghost" small disabled={!dem.ok} title={dem.reason} onClick={() => setConfirm(true)}>
              {A.demolishRefund(s, b.id) > 0 ? `Démonter (+${fmtMoney(A.demolishRefund(s, b.id))})` : 'Démonter'}
            </Btn>
          ) : (
            <Btn kind="danger" small onClick={() => game.act(() => A.demolish(s, b.id), 'build')}>
              Confirmer le démontage
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
  const incubators = buildingsOf(s, 'incubator');
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
      {fertile > 0 &&
        (incubators.length ? (
          <>
            <Btn kind="primary" block disabled={placeable <= 0} onClick={() => game.act(() => incubateAll(s), 'pop')}>
              <Icon name="egg" size={15} />{' '}
              {placeable <= 0
                ? 'Mettre en couveuse'
                : placeable === fertile
                  ? `Mettre ${fertile > 1 ? `les ${fertile} œufs fécondés` : 'l’œuf fécondé'} en couveuse`
                  : `Mettre ${placeable} œuf${placeable > 1 ? 's' : ''} sur ${fertile} en couveuse`}
            </Btn>
            {placeable < fertile && <p class="hint warn">{placeable ? 'Il ne reste pas assez de place dans' : 'Plus de place dans'} la couveuse : améliorez-la ou construisez-en une autre.</p>}
          </>
        ) : (
          <div class="hint warn">
            Ces œufs peuvent donner des poussins : construisez une couveuse (Boutique → Bâtiments).{' '}
            <button class="link" onClick={() => game.openPanel('shop', 'buildings')}>
              Voir la couveuse
            </button>
          </div>
        ))}
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
