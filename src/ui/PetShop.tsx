// L'animalerie (poules et oies en vitrine, au prix qu'on veut) et les commandes des revendeurs.
import { BIRD_ORDERS, PETSHOP, TIME } from '../config/balance';
import { BREEDS, BREED_ORDER, isGoose } from '../config/breeds';
import { BUILDINGS, PET_POS } from '../config/buildings';
import * as A from '../sim/actions';
import { currentDay } from '../sim/core';
import { fmtMoney, today } from '../sim/economy';
import {
  acceptBirdOrder,
  callTruck,
  cancelBirdOrder,
  checkCallTruck,
  declineBirdOrder,
  flockOf,
  loadersAtTruck,
  orderLabel,
  orderStock,
  petBuyChance,
  petCustomersPerDay,
  petPrice,
  petRoom,
  petShopOf,
  priceBounds,
  setPetPrice,
  stockOf,
  stockBirds,
  suggestedPrice,
  togglePetAuto,
  unstockBirds,
} from '../sim/petshop';
import { lvl } from '../sim/queries';
import { hasRole } from '../sim/workers';
import type { BreedId, BirdOrder } from '../sim/types';
import { buildingThumb, henThumb } from '../render/thumbs';
import { Btn, Icon, useGame } from './common';

function speedOf(p: number) {
  if (p >= 0.75) return { t: 'part très vite', c: 'good' };
  if (p >= 0.5) return { t: 'part vite', c: 'good' };
  if (p >= 0.28) return { t: 'part normalement', c: 'neutral' };
  if (p >= 0.1) return { t: 'part lentement', c: 'warn' };
  return { t: 'trop cher : presque personne n’achète', c: 'bad' };
}

function OpenCard() {
  const game = useGame();
  const s = game.state;
  const L = BUILDINGS.petshop.levels[0];
  const chk = A.checkBuild(s, 'petshop');
  return (
    <div class="pet-open">
      <img src={buildingThumb('petshop', 1)} alt="" />
      <div>
        <h4>Ouvrir une animalerie</h4>
        <p>{BUILDINGS.petshop.description}</p>
        <ul class="effects">
          <li>
            <b>Vous fixez les prix</b> : environ la moitié du prix d’achat par défaut, plus ou moins à votre guise
          </li>
          <li>
            <b>{L.capacity} volailles en vitrine</b>, poules d’un côté et oies de l’autre
          </li>
          <li>
            <b>Niveau {BIRD_ORDERS.reqLevel}</b> : des revendeurs et des associations passent commande
          </li>
        </ul>
        <Btn
          kind="primary"
          disabled={!chk.ok}
          onClick={() => {
            if (game.act(() => A.openPetShop(s), 'build')) {
              game.toast('L’animalerie est ouverte : mettez-y des volailles, les clients viendront avec leur carton.', 'good', '🐔');
              game.renderer.focusOn(PET_POS.x, PET_POS.z);
            }
          }}
        >
          <Icon name="hammer" size={15} /> Ouvrir · {fmtMoney(L.cost)}
        </Btn>
        {!chk.ok && chk.reason && <small class="hint warn">{chk.reason}</small>}
      </div>
    </div>
  );
}

function BirdRow({ breed }: { breed: BreedId }) {
  const game = useGame();
  const s = game.state;
  const def = BREEDS[breed];
  const goose = isGoose(breed);
  const price = petPrice(s, breed);
  const [lo, hi] = priceBounds(breed);
  const chance = petBuyChance(s, breed, price);
  const sp = speedOf(chance);
  const flock = flockOf(s, breed).length;
  const stock = stockOf(s, breed).length;
  const room = petRoom(s);
  const word = goose ? 'oie' : 'poule';
  const set = (v: number) => {
    setPetPrice(s, breed, v);
    game.changed();
  };
  const put = (n: number) => game.act(() => stockBirds(s, breed, n), 'pop');
  const presets: Array<[string, number]> = [
    ['Écouler', Math.round((def.price * 0.35) / 10) * 10],
    ['Conseillé', suggestedPrice(breed)],
    ['Cher', Math.round((def.price * 0.75) / 10) * 10],
  ];
  return (
    <div class="pcard2">
      <img class="pc-egg" src={henThumb(breed)} alt="" />
      <div class="pc-main">
        <div class="pc-top">
          <b>{def.name}</b>
          <small>
            {flock} à la ferme · <b>{stock}</b> en vitrine
          </small>
        </div>
        <div class="pc-slider">
          <button class="step" onClick={() => set(price - 50)} title="−0,50 €">
            −
          </button>
          <input type="range" min={lo} max={hi} step={10} value={price} onInput={(e) => set(Number((e.target as HTMLInputElement).value))} />
          <button class="step" onClick={() => set(price + 50)} title="+0,50 €">
            +
          </button>
        </div>
        <div class={`pc-accept ${sp.c}`}>
          <span class="acc">
            <i style={{ width: `${Math.round(Math.min(1, chance) * 100)}%` }} />
          </span>
          <em>
            {Math.round(Math.min(1, chance) * 100)} % des clients acceptent · {sp.t}
          </em>
        </div>
        <div class="row-btns pet-moves">
          {[1, 5, 20].map((n) => (
            <Btn key={n} kind="soft" small disabled={!flock || !room} onClick={() => put(n)}>
              + {n}
            </Btn>
          ))}
          <Btn kind="ghost" small disabled={!stock} title={`Reprendre une ${word} à la ferme`} onClick={() => game.act(() => unstockBirds(s, breed, 1), 'pop')}>
            Reprendre
          </Btn>
        </div>
      </div>
      <div class="pc-price">
        <b>{fmtMoney(price)}</b>
        <small>par {word}</small>
        <span class="mkt">Achat {fmtMoney(def.price)}</span>
        <div class="seg">
          {presets.map(([label, v]) => (
            <button key={label} class={price === v ? 'on' : ''} onClick={() => set(v)}>
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function PetShopTab() {
  const game = useGame();
  const s = game.state;
  const shop = petShopOf(s);
  if (!shop) return <OpenCard />;
  const L = lvl(shop);
  const next = BUILDINGS.petshop.levels[shop.level];
  const up = A.checkUpgrade(s, shop.id);
  const hens = BREED_ORDER.filter((b) => !isGoose(b) && (flockOf(s, b).length > 0 || stockOf(s, b).length > 0));
  const geese = BREED_ORDER.filter((b) => isGoose(b) && (flockOf(s, b).length > 0 || stockOf(s, b).length > 0));
  const sold = s.petShop.soldDay === currentDay(s) ? s.petShop.soldToday ?? 0 : 0;
  const cashed = today(s).income.animalerie ?? 0;
  return (
    <>
      <div class="strip">
        <div>
          <small>En vitrine</small>
          <b>
            {s.petShop.birds.length} / {L.capacity}
          </b>
        </div>
        <div>
          <small>Vendues aujourd’hui</small>
          <b>{sold}</b>
        </div>
        <div>
          <small>Recettes du jour</small>
          <b>{fmtMoney(cashed)}</b>
        </div>
        <div>
          <small>Clients par jour</small>
          <b>≈ {Math.round(petCustomersPerDay(s))}</b>
        </div>
      </div>
      <p class="hint">
        Ouverte de {TIME.SHOP_OPEN} h à {TIME.SHOP_CLOSE} h. Les clients viennent avec leur carton et repartent avec {Math.min(...PETSHOP.wantChoices)} à {Math.max(...PETSHOP.wantChoices)} volailles. Les meilleures reproductrices restent à la ferme ; les jeunes, les coqs, les jars et les spécimens rares ne se vendent pas ici.
      </p>
      <div class="row-btns pet-top">
        <Btn kind={s.petShop.auto ? 'good' : 'ghost'} small onClick={() => (togglePetAuto(s), game.changed())} title="Quand le troupeau dépasse la place disponible, le surplus part tout seul en vitrine">
          {s.petShop.auto ? '✓ Surplus envoyé en vitrine' : 'Envoyer le surplus en vitrine'}
        </Btn>
        {next && (
          <Btn kind="primary" small disabled={!up.ok} title={up.reason ?? next.perk} onClick={() => game.act(() => A.upgrade(s, shop.id), 'build')}>
            {next.name} · {fmtMoney(next.cost)}
          </Btn>
        )}
      </div>
      <h5>Poules pondeuses</h5>
      {hens.length === 0 && <p class="empty">Aucune poule adulte à vendre pour le moment.</p>}
      {hens.map((b) => (
        <BirdRow key={b} breed={b} />
      ))}
      {geese.length > 0 && (
        <>
          <h5>Oies</h5>
          {geese.map((b) => (
            <BirdRow key={b} breed={b} />
          ))}
        </>
      )}
    </>
  );
}

function LoadCard({ o }: { o: BirdOrder }) {
  const s = useGame().state;
  const L = s.birdLoad;
  if (!L || L.orderId !== o.id) return null;
  const left = L.eta - s.clock.t;
  const helpers = loadersAtTruck(s);
  const status =
    L.leave !== undefined
      ? 'Chargement terminé : le camion repart.'
      : left > 0
        ? left > BIRD_ORDERS.delay + 1
          ? `Le camion passera le matin, à ${BIRD_ORDERS.morningHour} h.`
          : `Le camion arrive dans ${Math.ceil((left / TIME.DAY) * 24 * 10) / 10} h. Les ${o.goose ? 'oies' : 'poules'} rejoignent le portail.`
        : helpers
          ? `Chargement : ${L.loaded} / ${o.count} · ${helpers} commis au camion`
          : hasRole(s, 'farmhand')
            ? 'Le camion attend un commis pour charger…'
            : 'Le camion attend : il faut un commis de ferme.';
  return (
    <small class="pet-load">
      <i style={{ width: `${Math.round((L.loaded / Math.max(1, o.count)) * 100)}%` }} />
      <span>🚚 {status}</span>
    </small>
  );
}

export function DealersTab() {
  const game = useGame();
  const s = game.state;
  const day = currentDay(s);
  const active = s.birdOrders.filter((o) => o.status !== 'offer');
  const offers = s.birdOrders.filter((o) => o.status === 'offer');
  const commis = hasRole(s, 'farmhand');
  return (
    <>
      <p class="hint">
        Des revendeurs et des associations cherchent des poules et des oies pour des particuliers. Une fois la commande acceptée, vous appelez leur grand camion : il se gare devant l’animalerie, un commis de ferme aide à charger, et vous êtes payé quand il repart. Ni coqs, ni jars, ni jeunes : les meilleures reproductrices partent en dernier.
      </p>
      {!commis && (
        <div class="notice">
          <span>
            Il faut au moins un <b>commis de ferme</b> pour charger le camion.
          </span>
          <Btn kind="soft" small onClick={() => game.openPanel('team')}>
            Voir l’équipe
          </Btn>
        </div>
      )}
      <h5>En cours ({active.length})</h5>
      {active.length === 0 && <p class="empty">Aucune commande en cours.</p>}
      {active.map((o) => {
        const chk = checkCallTruck(s, o);
        const have = orderStock(s, o);
        return (
          <div class="order" key={o.id}>
            <div class="o-main">
              <b>{o.client}</b>
              <span>
                {o.goose ? '🪿' : '🐔'} {orderLabel(o)} à {fmtMoney(o.unitPrice)} pièce
              </span>
              {o.status === 'loading' ? (
                <LoadCard o={o} />
              ) : (
                <small class={o.deadlineDay - day <= 0 ? 'neg' : ''}>
                  Avant la fin du jour {o.deadlineDay} · {have} / {o.count} {o.goose ? 'oies' : 'poules'} disponibles
                </small>
              )}
            </div>
            <div class="o-side">
              <b>{fmtMoney(o.count * o.unitPrice)}</b>
              {o.status === 'active' && (
                <div class="row-btns">
                  <Btn kind="ghost" small onClick={() => game.act(() => cancelBirdOrder(s, o.id))}>
                    Annuler
                  </Btn>
                  <Btn kind="primary" small disabled={!chk.ok} title={chk.reason} onClick={() => game.act(() => callTruck(s, o.id), 'build')}>
                    Appeler le camion
                  </Btn>
                </div>
              )}
              {o.status === 'active' && !chk.ok && chk.reason && <small class="hint warn">{chk.reason}</small>}
            </div>
          </div>
        );
      })}
      <h5>Offres ({offers.length})</h5>
      {offers.length === 0 && <p class="empty">Pas de nouvelle offre. Il en arrive certains matins.</p>}
      {offers.map((o) => (
        <div class="order offer" key={o.id}>
          <div class="o-main">
            <b>{o.client}</b>
            <span>
              {o.goose ? '🪿' : '🐔'} {orderLabel(o)} à {fmtMoney(o.unitPrice)} pièce
            </span>
            <small>
              Délai : jour {o.deadlineDay} · offre valable jusqu’au jour {o.offerUntilDay} · vous en avez {orderStock(s, o)}
            </small>
          </div>
          <div class="o-side">
            <b>{fmtMoney(o.count * o.unitPrice)}</b>
            <div class="row-btns">
              <Btn kind="ghost" small onClick={() => game.act(() => declineBirdOrder(s, o.id))}>
                Refuser
              </Btn>
              <Btn kind="primary" small onClick={() => game.act(() => acceptBirdOrder(s, o.id))}>
                Accepter
              </Btn>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
