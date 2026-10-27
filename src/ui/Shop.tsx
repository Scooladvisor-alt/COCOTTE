// La boutique : un vrai magasin de ferme, sur une seule page qui défile. Sommaire à gauche, fiches article
// illustrées par les modèles 3D du jeu, l'essentiel en deux ou trois chiffres, le prix bien visible.
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { BREEDING, COSTS, HEN_PACKS, DOG, EGG_TYPES, GRAIN_BINS, GRAIN_SACKS, PARCELS, ROBOT, UNLOCKS, WATER, WATER_PACKS, WATER_TANKS, WORLD, parcelPrice, sackPrice, waterPrice, type StoreLevel, COMPOST, NATURE } from '../config/balance';
import { grainBinDef, grainPerDay, waterPerDay, waterTankDef } from '../sim/stocks';
import { BREEDS, BREED_ORDER, ROOSTER_TITLES } from '../config/breeds';
import { BUILDINGS, BUILD_ORDER } from '../config/buildings';
import * as A from '../sim/actions';
import { parcelCenter } from '../sim/core';
import { countOfType } from '../sim/buildings';
import { buyLevel, fmtMoney, levelReached, lockedAt, maxParcelsOf } from '../sim/economy';
import { adultCount, buildingsOf, coopCapacity, flockCapacity, landCapacity } from '../sim/queries';
import { fertility } from '../sim/breeding';
import { buyRobot, checkBuyRobot } from '../sim/robots';
import { buyDog, checkBuyDog } from '../sim/dog';
import { buildingThumb, dogThumb, henThumb, parcelThumb, robotThumb, roosterThumb, sackThumb, waterThumb } from '../render/thumbs';
import type { BreedId, BuildingType } from '../sim/types';
import { Btn, Icon, useGame } from './common';
import { TeamPanel } from './Team';
import { GeneRange } from './Show';

type Cat = 'hens' | 'buildings' | 'gear' | 'grain' | 'land' | 'staff';
const CATS: Array<{ id: Cat; label: string; icon: string; tint: string }> = [
  { id: 'hens', label: 'Poules', icon: 'hen', tint: '#fff1dc' },
  { id: 'buildings', label: 'Bâtiments', icon: 'hammer', tint: '#e9f0ff' },
  { id: 'gear', label: 'Équipement', icon: 'bot', tint: '#eef4fb' },
  { id: 'grain', label: 'Grain & eau', icon: 'wheat', tint: '#fff6df' },
  { id: 'land', label: 'Terrain', icon: 'map', tint: '#eaf6e3' },
  { id: 'staff', label: 'Personnel', icon: 'team', tint: '#f3eefc' },
];

/**
 * Toute la boutique sur une seule page qui défile : Poules, Bâtiments, Équipement… Le rail sert de
 * sommaire (un clic y saute, la rubrique en cours s'allume pendant le défilement).
 */
/** Position d'une rubrique dans la zone qui défile. */
function posIn(box: HTMLElement, el: HTMLElement) {
  return el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
}

export function ShopPanel() {
  const game = useGame();
  const main = useRef<HTMLDivElement>(null);
  const rail = useRef<HTMLElement>(null);
  const jumped = useRef<string | null>(null);
  const [active, setActive] = useState<Cat>('hens');
  const cat = CATS.find((c) => c.id === active)!;

  const jump = (id: Cat, smooth: boolean) => {
    const box = main.current;
    const el = box?.querySelector<HTMLElement>(`[data-cat="${id}"]`);
    if (!box || !el) return;
    box.scrollTo({ top: posIn(box, el) - 4, behavior: smooth ? 'smooth' : 'auto' });
    setActive(id);
  };

  // ouverture sur une rubrique précise (raccourci, bouton « Voir les poulaillers »…)
  useEffect(() => {
    const want = game.panelTab;
    if (want === jumped.current) return;
    const first = jumped.current === null;
    jumped.current = want;
    if (want && CATS.some((c) => c.id === want)) {
      jump(want as Cat, !first);
      // à l'ouverture, le panneau s'anime (et les vignettes se chargent) : on recale une fois posé
      if (first) window.setTimeout(() => jump(want as Cat, false), 420);
    }
  });

  // rail horizontal (téléphone) : la rubrique en cours reste visible
  useEffect(() => {
    const on = rail.current?.querySelector<HTMLElement>('.on');
    const r = rail.current;
    if (on && r && r.scrollWidth > r.clientWidth) r.scrollTo({ left: on.offsetLeft - 8, behavior: 'smooth' });
  }, [active]);

  const onScroll = () => {
    const box = main.current;
    if (!box) return;
    let cur: Cat = 'hens';
    for (const c of CATS) {
      const el = box.querySelector<HTMLElement>(`[data-cat="${c.id}"]`);
      if (el && posIn(box, el) - box.scrollTop <= 80) cur = c.id;
    }
    // tout en bas : la dernière rubrique, même courte
    if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) cur = CATS[CATS.length - 1].id;
    if (cur !== active) setActive(cur);
  };

  return (
    <div class="shop" style={{ '--tint': cat.tint } as never}>
      <nav class="rail" ref={rail}>
        {CATS.map((c) => (
          <button key={c.id} class={active === c.id ? 'on' : ''} onClick={() => jump(c.id, true)}>
            <span class="ri" style={{ background: c.tint }}>
              <Icon name={c.icon} size={17} />
            </span>
            <span>{c.label}</span>
          </button>
        ))}
      </nav>
      <div class="shop-main" ref={main} onScroll={onScroll}>
        <section class="shop-sect" data-cat="hens">
          <HensTab />
        </section>
        <section class="shop-sect" data-cat="buildings">
          <BuildTab />
        </section>
        <section class="shop-sect" data-cat="gear">
          <GearTab />
        </section>
        <section class="shop-sect" data-cat="grain">
          <GrainTab />
        </section>
        <section class="shop-sect" data-cat="land">
          <LandTab />
        </section>
        <section class="shop-sect" data-cat="staff">
          <Head title="Personnel" sub="Embauchez des salariés : ils s’occupent de la ferme pendant que vous gérez." />
          <TeamPanel embedded />
        </section>
      </div>
    </div>
  );
}

// ---------------------------------------------------------- Fiche article ----
function Tile(props: {
  pic: string;
  title: string;
  tag?: string;
  desc?: string;
  stats?: Array<[string, ComponentChildren]>;
  price?: number;
  priceNote?: string;
  cta: string;
  onBuy: () => void;
  ok: boolean;
  why?: string;
  locked?: number;
  count?: string;
  tut?: string;
  /** Bloc sous les caractéristiques (étoiles de la race…). */
  extra?: ComponentChildren;
}) {
  return (
    <article class={`tile ${props.locked ? 'locked' : ''}`} data-tut={props.tut}>
      <div class="tile-pic">
        {props.pic ? <img src={props.pic} alt="" draggable={false} /> : <span class="no-pic" />}
        {props.locked ? (
          <span class="tb lock">
            <Icon name="lock" size={12} /> Niveau {props.locked}
          </span>
        ) : (
          props.tag && <span class="tb">{props.tag}</span>
        )}
        {props.count && <span class="tc">{props.count}</span>}
      </div>
      <div class="tile-body">
        <h4>{props.title}</h4>
        {props.desc && <p>{props.desc}</p>}
        {props.stats && props.stats.length > 0 && (
          <dl>
            {props.stats.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        )}
        {props.extra}
      </div>
      <footer class="tile-foot">
        <div class="tp">
          {props.price !== undefined && <b>{fmtMoney(props.price)}</b>}
          {props.priceNote && <small>{props.priceNote}</small>}
        </div>
        <button class="btn primary small" disabled={!props.ok} onClick={props.onBuy}>
          {props.cta}
        </button>
      </footer>
      {props.why && !props.locked && <div class="why">{props.why}</div>}
    </article>
  );
}

function Head({ title, sub, children }: { title: string; sub?: string; children?: ComponentChildren }) {
  return (
    <header class="sect-head">
      <div>
        <h3>{title}</h3>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div class="sh-side">{children}</div>}
    </header>
  );
}

/** Raison courte d'un refus (le bouton dit l'essentiel, sans phrase à rallonge). */
function short(reason?: string) {
  if (!reason) return '';
  if (reason.startsWith('Poulailler plein')) return 'Poulailler plein : améliorez-le ou construisez-en un';
  if (reason.startsWith('Terrain plein')) return 'Terrain plein : achetez une parcelle';
  if (reason.startsWith('Il faut une place')) return reason.replace('Il faut une place dans un poulailler', 'Exige un poulailler');
  return reason;
}

// ------------------------------------------------------------------ Poules ----
function HensTab() {
  const game = useGame();
  const s = game.state;
  const cap = flockCapacity(s);
  const full = adultCount(s) >= cap;
  return (
    <>
      <Head title="Poules" sub="Chaque race a son caractère, son œuf et son rythme de ponte.">
        <div class={`meter-pill ${full ? 'full' : ''}`}>
          <span>Troupeau</span>
          <b>
            {adultCount(s)} / {cap}
          </b>
          <i style={{ width: `${Math.min(100, (adultCount(s) / Math.max(1, cap)) * 100)}%` }} />
        </div>
      </Head>
      {full && (
        <div class="notice">
          <span>
            Plus de place : poulaillers <b>{coopCapacity(s)}</b> places, terrain <b>{landCapacity(s)}</b> poules.
          </span>
          <button
            class="btn soft small"
            onClick={() => {
              game.panelTab = coopCapacity(s) <= landCapacity(s) ? 'buildings' : 'land';
              game.changed();
            }}
          >
            {coopCapacity(s) <= landCapacity(s) ? 'Voir les poulaillers' : 'Voir les parcelles'}
          </button>
        </div>
      )}
      {s.deliveries.length > 0 && (
        <div class="notice">
          <span>
            🚚 En route : <b>{s.deliveries.map((d) => `${d.count} ${BREEDS[d.breed].name}`).join(', ')}</b> — le camion arrive au portail.
          </span>
        </div>
      )}
      <div class="tiles">
        {BREED_ORDER.map((id) => (
          <BreedTile key={id} id={id} />
        ))}
      </div>
      <Head
        title="Coqs"
        sub={`Un coq féconde les œufs d’une dizaine de poules. Mis en couveuse, ces œufs éclosent en ${BREEDING.incubationDays} jours ; les poussins pondent à ${BREEDING.growthDays} jours.`}
      >
        <div class="meter-pill">
          <span>Œufs fécondés</span>
          <b>{Math.round(fertility(s) * 100)} %</b>
          <i style={{ width: `${fertility(s) * 100}%` }} />
        </div>
      </Head>
      {!buildingsOf(s, 'incubator').length && (
        <div class="notice">
          <span>
            Sans <b>couveuse</b>, les œufs fécondés sont simplement vendus comme les autres.
          </span>
          <button
            class="btn soft small"
            onClick={() => {
              game.panelTab = 'buildings';
              game.changed();
            }}
          >
            Voir la couveuse
          </button>
        </div>
      )}
      <div class="tiles">
        {BREED_ORDER.map((id) => (
          <RoosterTile key={id} id={id} />
        ))}
      </div>
    </>
  );
}

function RoosterTile({ id }: { id: BreedId }) {
  const game = useGame();
  const s = game.state;
  const b = BREEDS[id];
  const chk = A.checkBuyRooster(s, id);
  const locked = lockedAt(s, b.reqLevel);
  const owned = s.hens.filter((h) => h.rooster && h.breed === id).length;
  return (
    <Tile
      pic={roosterThumb(id)}
      title={ROOSTER_TITLES[id]}
      tag={owned ? `${owned} à la ferme` : 'Reproducteur'}
      stats={[['Féconde', `~${BREEDING.hensPerRooster} poules`]]}
      extra={<GeneRange breed={id} />}
      price={A.roosterPrice(id)}
      cta="Acheter"
      ok={chk.ok}
      why={chk.ok ? undefined : /^(Poulailler plein|Terrain plein)/.test(chk.reason ?? '') ? undefined : short(chk.reason)}
      locked={locked}
      onBuy={() => game.act(() => A.buyRooster(s, id), 'buy')}
    />
  );
}

function BreedTile({ id }: { id: BreedId }) {
  const game = useGame();
  const s = game.state;
  const b = BREEDS[id];
  const chk = A.checkBuyHen(s, id);
  const locked = lockedAt(s, b.reqLevel);
  const egg = EGG_TYPES[b.egg];
  return (
    <Tile
      pic={henThumb(id)}
      title={b.name}
      tag={b.trait}
      stats={[
        ['Œufs / jour', b.eggsPerDay.toLocaleString('fr-FR')],
        [
          'Œuf',
          <>
            <i class="egg-sw" style={{ background: '#' + egg.color.toString(16).padStart(6, '0') }} />
            {egg.short} · {fmtMoney(egg.ref)}
          </>,
        ],
      ]}
      extra={
        <>
          <GeneRange breed={id} />
          <PackRow id={id} />
        </>
      }
      price={b.price}
      cta="Acheter"
      ok={chk.ok}
      why={chk.ok ? undefined : /^(Poulailler plein|Terrain plein)/.test(chk.reason ?? '') ? undefined : short(chk.reason)}
      locked={locked}
      onBuy={() => game.act(() => A.buyHen(s, id), 'buy')}
      tut={id === 'rousse' ? 'buy-rousse' : undefined}
    />
  );
}

/** Lots de 6, 12 ou 24 poules : moins chers à l'unité, livrés en camion au portail. */
function PackRow({ id }: { id: BreedId }) {
  const game = useGame();
  const s = game.state;
  return (
    <div class="packs">
      <small>Par lot, livré en camion :</small>
      <div class="pack-btns">
        {HEN_PACKS.map((p) => {
          const chk = A.checkBuyHenPack(s, id, p.count);
          return (
            <button
              key={p.count}
              class="pack"
              disabled={!chk.ok}
              title={chk.ok ? `${p.count} poules pour ${fmtMoney(A.henPackPrice(id, p.count))} (−${Math.round(p.discount * 100)} %)` : chk.reason}
              onClick={() => game.act(() => A.buyHenPack(s, id, p.count), 'buy')}
            >
              <b>×{p.count}</b>
              <span>{fmtMoney(A.henPackPrice(id, p.count))}</span>
              <em>−{Math.round(p.discount * 100)} %</em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Bâtiments ----
function keyStat(type: BuildingType): Array<[string, ComponentChildren]> {
  const L = BUILDINGS[type].levels[0];
  switch (type) {
    case 'coop':
      return [['Capacité', `${L.capacity} poules`]];
    case 'nest':
      return [['Capacité', `${L.capacity} œufs`]];
    case 'feeder':
      return [['Contenance', `${L.capacity} rations · ${L.slots} places`]];
    case 'drinker':
      return [['Contenance', `${L.capacity} L · ${L.slots} places`]];
    case 'dustbath':
      return [
        ['Bien-être', `+${L.wellbeing}`],
        ['Maladies', `−${Math.round((1 - NATURE.dustSick[1]) * 100)} %`],
      ];
    case 'pond':
      return [
        ['Eau gratuite', `${L.capacity} L · +${L.regen} L / jour`],
        ['Soif · bien-être', `−${Math.round(NATURE.pondThirst[1] * 100)} % · +${L.wellbeing}`],
      ];
    case 'tree':
      return [
        ['Bien-être · soif', `+${L.wellbeing} · −${Math.round(NATURE.treeThirst * 100)} %`],
        ['Buses', 'abri sous les branches'],
      ];
    case 'compost':
      return [
        ['Ponte', `jusqu’à +${Math.round(COMPOST.laying * 100)} %`],
        ['Grain', `jusqu’à −${Math.round(COMPOST.grainSaving * 100)} %`],
      ];
    case 'incubator':
      return [
        ['Capacité', `${L.capacity} œufs`],
        ['Éclosion', `${BREEDING.incubationDays} jours`],
      ];
    default:
      return [];
  }
}

function BuildTab() {
  const game = useGame();
  const s = game.state;
  return (
    <>
      <Head title="Bâtiments" sub="Choisissez, puis cliquez sur votre terrain pour placer. Pour améliorer un bâtiment existant, cliquez dessus dans la ferme." />
      <div class="tiles">
        {BUILD_ORDER.map((type) => {
          const def = BUILDINGS[type];
          const L = def.levels[0];
          const chk = A.checkBuild(s, type);
          const locked = lockedAt(s, L.reqLevel);
          return (
            <Tile
              key={type}
              pic={buildingThumb(type, 1)}
              title={def.name}
              desc={def.description}
              stats={[...keyStat(type), ['Emprise', `${def.w} × ${def.d} cases`], ['Entretien', `${fmtMoney(L.upkeep)} / jour`]]}
              price={L.cost}
              count={Number.isFinite(A.maxCount(s, type)) ? `${countOfType(s, type)} / ${A.maxCount(s, type)}` : countOfType(s, type) ? `${countOfType(s, type)} construit${countOfType(s, type) > 1 ? 's' : ''}` : undefined}
              cta="Construire"
              ok={chk.ok}
              why={chk.ok ? undefined : chk.reason}
              locked={locked}
              onBuy={() => game.startPlacing(type)}
            />
          );
        })}
      </div>
    </>
  );
}

// ------------------------------------------------------------- Équipement ----
function GearTab() {
  const game = useGame();
  const s = game.state;
  const level = buyLevel(s);
  const robot = checkBuyRobot(s);
  const dog = checkBuyDog(s);
  return (
    <>
      <Head title="Équipement" sub="Des aides qui travaillent pour vous, de jour comme de nuit." />
      <div class="tiles wide">
        <Tile
          pic={dogThumb()}
          title="Chien de garde"
          tag="Protection"
          desc={s.dog ? `${s.dog.name} fait sa ronde autour de l’enclos et fait fuir renards et buses.` : 'Le chien de la maison (couché devant le perron) : adoptez-le, il fera sa ronde autour de l’enclos et chassera renards et buses.'}
          stats={[
            ['Attaques', 'Presque plus de renards ni de buses'],
            ['Croquettes', `${fmtMoney(DOG.upkeepPerDay)} / jour`],
          ]}
          price={DOG.price}
          count={s.dog ? 'Adopté' : undefined}
          cta={s.dog ? 'Déjà adopté' : 'Adopter'}
          ok={dog.ok}
          why={s.dog ? undefined : dog.ok ? undefined : dog.reason}
          locked={level < DOG.reqLevel ? DOG.reqLevel : undefined}
          onBuy={() => game.act(() => buyDog(s), 'buy')}
        />
        <Tile
          pic={robotThumb()}
          title="Robot ramasseur"
          tag="Autonome"
          desc="Comme un aspirateur robot : il ramasse les œufs au sol puis vide les pondoirs, décharge au stockage et se recharge seul."
          stats={[
            ['Bac', `${ROBOT.capacity} œufs`],
            ['Électricité', `${fmtMoney(ROBOT.upkeepPerDay)} / jour`],
          ]}
          price={ROBOT.price}
          count={s.robots.length ? `${s.robots.length} en service` : undefined}
          cta="Acheter"
          ok={robot.ok}
          why={robot.ok ? undefined : robot.reason}
          locked={undefined}
          onBuy={() => game.act(() => buyRobot(s), 'buy')}
        />
      </div>
    </>
  );
}

// ------------------------------------------------------------- Grain & eau ----
function GrainTab() {
  const game = useGame();
  const s = game.state;
  const lvl = buyLevel(s);
  const idx = s.market.grainIndex;
  const bin = grainBinDef(s);
  const tank = waterTankDef(s);
  const missing = Math.floor(tank.capacity - s.water);
  return (
    <>
      <Head title="Grain & eau" sub="La réserve de grain alimente les mangeoires, la cuve alimente les abreuvoirs.">
        <span class={`trend ${idx > 1.03 ? 'up' : idx < 0.97 ? 'down' : ''}`}>
          Cours du grain {idx > 1.03 ? '▲' : idx < 0.97 ? '▼' : '='} {Math.round(idx * 100)} %
        </span>
      </Head>
      <div class="reserves">
        <Reserve kind="grain" name={bin.name} value={s.grain} cap={bin.capacity} unit="rations" use={`≈ ${grainPerDay(s).toFixed(1)} rations / jour`} next={GRAIN_BINS[s.grainBin]} onUpgrade={() => game.act(() => A.upgradeGrainBin(s), 'build')} />
        <Reserve kind="water" name={tank.name} value={s.water} cap={tank.capacity} unit="L" use={`≈ ${Math.round(waterPerDay(s))} L / jour`} next={WATER_TANKS[s.waterTank]} onUpgrade={() => game.act(() => A.upgradeWaterTank(s), 'build')} />
      </div>
      <h5 class="sub-h">Grain</h5>
      <div class="tiles compact">
        {GRAIN_SACKS.map((g) => {
          const price = sackPrice(g, idx);
          const noRoom = s.grain + g.rations > bin.capacity;
          return (
            <Tile
              key={g.id}
              pic={sackThumb(g.id as 'small' | 'medium' | 'bigbag')}
              title={g.name}
              desc={`${g.rations} rations · ${fmtMoney(Math.round(price / g.rations))} la ration`}
              price={price}
              cta="Acheter"
              ok={!noRoom && s.money >= price && lvl >= g.reqLevel}
              why={noRoom ? 'Pas assez de place dans la réserve' : s.money < price ? 'Fonds insuffisants' : undefined}
              locked={lvl < g.reqLevel ? g.reqLevel : undefined}
              onBuy={() => game.act(() => A.buyGrain(s, g.id), 'grain')}
            />
          );
        })}
      </div>
      <h5 class="sub-h">Eau</h5>
      <div class="tiles compact">
        {WATER_PACKS.map((p) => {
          const price = waterPrice(p.liters);
          const noRoom = s.water + p.liters > tank.capacity;
          return (
            <Tile
              key={p.id}
              pic={waterThumb(p.id as 'w50' | 'w250' | 'w1000')}
              title={p.name}
              desc={`${p.liters} L · ${(price / p.liters / 100).toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} € le litre`}
              price={price}
              cta="Acheter"
              ok={!noRoom && s.money >= price && lvl >= p.reqLevel}
              why={noRoom ? 'Pas assez de place dans la cuve' : s.money < price ? 'Fonds insuffisants' : undefined}
              locked={lvl < p.reqLevel ? p.reqLevel : undefined}
              onBuy={() => game.act(() => A.buyWaterPack(s, p.id), 'water')}
            />
          );
        })}
        <Tile
          pic={waterThumb('fill')}
          title="Remplir la cuve"
          desc={missing >= 1 ? `${missing} L manquants, au meilleur tarif` : 'La cuve est pleine'}
          price={missing >= 1 ? waterPrice(missing) : undefined}
          cta="Remplir"
          ok={missing >= 1}
          onBuy={() => game.act(() => A.fillTank(s), 'water')}
        />
      </div>
      <h5 class="sub-h">Automatique</h5>
      <div class="autos">
        <AutoRow
          on={s.settings.autoGrain}
          locked={lvl < UNLOCKS.autoGrain ? UNLOCKS.autoGrain : 0}
          title="Commande automatique de grain"
          onToggle={(v) => (s.settings.autoGrain = v)}
        >
          Sous{' '}
          <input
            type="number"
            min={0}
            max={2000}
            value={s.settings.autoGrainThreshold}
            onChange={(e) => {
              s.settings.autoGrainThreshold = Math.max(0, Math.min(2000, Number((e.target as HTMLInputElement).value) || 0));
              game.changed();
            }}
          />{' '}
          rations, commander un{' '}
          <select
            value={s.settings.autoGrainSack}
            onChange={(e) => {
              s.settings.autoGrainSack = (e.target as HTMLSelectElement).value;
              game.changed();
            }}
          >
            {GRAIN_SACKS.filter((g) => g.reqLevel <= lvl).map((g) => (
              <option value={g.id} key={g.id}>
                {g.name.toLowerCase()}
              </option>
            ))}
          </select>
        </AutoRow>
        <AutoRow on={s.settings.autoWater} locked={lvl < WATER.autoUnlock ? WATER.autoUnlock : 0} title="Raccordement au réseau d’eau" onToggle={(v) => (s.settings.autoWater = v)}>
          Remplir la cuve sous{' '}
          <input
            type="number"
            min={0}
            max={100}
            value={s.settings.autoWaterThreshold}
            onChange={(e) => {
              s.settings.autoWaterThreshold = Math.max(0, Math.min(100, Number((e.target as HTMLInputElement).value) || 0));
              game.changed();
            }}
          />{' '}
          % de sa capacité
        </AutoRow>
      </div>
    </>
  );
}

function AutoRow(props: { on: boolean; locked: number; title: string; onToggle: (v: boolean) => void; children: ComponentChildren }) {
  const game = useGame();
  return (
    <div class={`auto-row2 ${props.locked ? 'locked' : ''}`}>
      <label class="switch">
        <input
          type="checkbox"
          disabled={!!props.locked}
          checked={props.on}
          onChange={(e) => {
            props.onToggle((e.target as HTMLInputElement).checked);
            game.changed();
          }}
        />
        <i />
      </label>
      <div>
        <b>
          {props.title}
          {props.locked ? <small> · niveau {props.locked}</small> : null}
        </b>
        <span>{props.children}</span>
      </div>
    </div>
  );
}

function Reserve(props: { kind: 'grain' | 'water'; name: string; value: number; cap: number; unit: string; use: string; next?: StoreLevel; onUpgrade: () => void }) {
  const game = useGame();
  const s = game.state;
  const ratio = Math.min(1, props.value / Math.max(1, props.cap));
  const next = props.next;
  const locked = next ? !levelReached(s, next.reqLevel) : true;
  return (
    <div class={`reserve ${props.kind}`}>
      <div class={`vessel ${props.kind === 'grain' ? 'silo' : 'tank'}`}>
        <i style={{ height: `${ratio * 100}%` }} />
      </div>
      <div class="rv-info">
        <small>{props.name}</small>
        <b>
          {Math.floor(props.value)} <em>/ {props.cap} {props.unit}</em>
        </b>
        <span>{props.use}</span>
      </div>
      {next ? (
        <Btn kind="soft" small disabled={locked || s.money < next.cost} title={locked ? `Niveau ${next.reqLevel} requis` : undefined} onClick={props.onUpgrade}>
          {locked ? `Niv. ${next.reqLevel} : ${next.capacity} ${props.unit}` : `${next.capacity} ${props.unit} · ${fmtMoney(next.cost)}`}
        </Btn>
      ) : (
        <span class="chip good">Maximum</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- Terrain ----
function LandTab() {
  const game = useGame();
  const s = game.state;
  const price = parcelPrice(s.parcels.length);
  const rows = [];
  for (let r = 0; r < WORLD.ROWS; r++) {
    const cells = [];
    for (let c = 0; c < WORLD.COLS; c++) {
      const key = `${c},${r}`;
      const owned = s.parcels.includes(key);
      const chk = A.checkBuyParcel(s, key);
      const adj = A.parcelNeighbours(key).some((k) => s.parcels.includes(k));
      cells.push(
        <button
          key={key}
          class={`plot ${owned ? 'owned' : chk.ok ? 'buyable' : adj ? 'adj' : ''}`}
          disabled={owned || !adj}
          title={owned ? 'Votre parcelle' : chk.reason ?? `Acheter pour ${fmtMoney(price)}`}
          onClick={() => {
            game.select({ kind: 'parcel', key });
            game.renderer.focusOn(...parcelCenter(c, r));
            game.openPanel(null);
          }}
        >
          <span>
            {String.fromCharCode(65 + c)}
            {r + 1}
          </span>
          <small>{owned ? 'à vous' : adj ? fmtMoney(price) : ''}</small>
        </button>,
      );
    }
    rows.push(
      <div class="plot-row" key={r}>
        {cells}
      </div>,
    );
  }
  return (
    <>
      <Head title="Terrain" sub="Chaque parcelle ajoute de l’herbe fraîche, de la place pour construire et de la capacité pour le troupeau.">
        <div class="meter-pill">
          <span>Parcelles</span>
          <b>
            {s.parcels.length} / {maxParcelsOf(s)}
          </b>
          <i style={{ width: `${(s.parcels.length / maxParcelsOf(s)) * 100}%` }} />
        </div>
      </Head>
      <section class="hero ok land">
        <img src={parcelThumb()} alt="" />
        <div>
          <b>Prochaine parcelle : {fmtMoney(price)}</b>
          <span>
            +{PARCELS.hensPerParcel} poules de capacité · taxe foncière {fmtMoney(COSTS.landTaxPerParcel)} / jour. Elle doit toucher votre terrain ; la clôture s’agrandit d’elle-même.
          </span>
        </div>
      </section>
      <div class="plots">
        {rows}
        <div class="road-strip">Route du village</div>
      </div>
    </>
  );
}
