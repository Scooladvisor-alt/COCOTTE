import { useState } from 'preact/hooks';
import { EGG_ORDER, EGG_TYPES, GRADES, MARKET, ORDERS, RARE, TIME, UNLOCKS } from '../config/balance';
import { BREEDS } from '../config/breeds';
import { currentDay } from '../sim/core';
import { farmLevel, fmtMoney, today } from '../sim/economy';
import { oldestLot } from '../sim/eggs';
import {
  acceptContract,
  acceptOrder,
  buyProbability,
  cancelContract,
  cancelOrder,
  canDeliver,
  customersPerDay,
  dailyProduction,
  declineContract,
  declineOrder,
  deliverContractNow,
  deliverOrder,
  estimatedDemand,
  lostToday,
  maxContracts,
  palletsLeft,
  queueLength,
  refPrice,
  sellPallet,
  sellWholesale,
  setPrice,
  standCounters,
  wholesaleQuote,
  sellGoldEggs,
} from '../sim/market';
import { lvl, stand, storedCount } from '../sim/queries';
import { BUILDINGS } from '../config/buildings';
import * as A from '../sim/actions';
import type { EggType, GameState } from '../sim/types';
import { Btn, EggDot, Icon, Tabs, n1, useGame } from './common';
import { HistoryChart } from './Charts';
import { buildingThumb, eggThumb } from '../render/thumbs';

function visibleTypes(s: GameState): EggType[] {
  const set = new Set<EggType>();
  for (const h of s.hens) set.add(BREEDS[h.breed].egg);
  for (const l of s.lots) set.add(l.type);
  if (set.size === 0) set.add('roux');
  return EGG_ORDER.filter((t) => set.has(t));
}

export function MarketPanel() {
  const game = useGame();
  const s = game.state;
  const lvl = farmLevel(s);
  const tab = game.panelTab ?? 'stand';
  const offers = s.orders.filter((o) => o.status === 'offer').length;
  const coffers = s.contracts.filter((c) => c.status === 'offer').length;
  return (
    <>
      <Tabs
        tabs={[
          { id: 'stand', label: 'Étal (vente directe)' },
          { id: 'coop', label: 'Coopérative', locked: lvl < UNLOCKS.wholesale },
          { id: 'orders', label: 'Commandes', locked: lvl < UNLOCKS.orders, badge: offers },
          { id: 'contracts', label: 'Contrats', locked: lvl < UNLOCKS.contracts, badge: coffers },
          { id: 'auto', label: 'Automatisation', locked: lvl < UNLOCKS.autoWholesale },
        ]}
        active={tab}
        onChange={(t) => {
          game.panelTab = t;
          game.changed();
        }}
      />
      <div class="panel-body">
        {tab === 'stand' && <StandTab />}
        {tab === 'coop' && (lvl >= UNLOCKS.wholesale ? <CoopTab /> : <Locked level={UNLOCKS.wholesale} what="La coopérative rachète vos œufs instantanément, à prix de gros." />)}
        {tab === 'orders' && (lvl >= UNLOCKS.orders ? <OrdersTab /> : <Locked level={UNLOCKS.orders} what="Des commerçants passent des commandes ponctuelles bien payées." />)}
        {tab === 'contracts' && (lvl >= UNLOCKS.contracts ? <ContractsTab /> : <Locked level={UNLOCKS.contracts} what="Des contrats de livraison quotidienne assurent un revenu régulier." />)}
        {tab === 'auto' && (lvl >= UNLOCKS.autoWholesale ? <AutoTab /> : <Locked level={UNLOCKS.autoWholesale} what="Vendez automatiquement le surplus au-delà d’un seuil de stock." />)}
      </div>
    </>
  );
}

function Locked({ level, what }: { level: number; what: string }) {
  return (
    <div class="locked-box">
      <div class="big">
        <Icon name="lock" size={30} />
      </div>
      <b>Débloqué au niveau {level}</b>
      <p>{what}</p>
    </div>
  );
}

function speedLabel(p: number) {
  if (p >= 0.75) return { t: 'Très rapide', c: 'good' };
  if (p >= 0.5) return { t: 'Rapide', c: 'good' };
  if (p >= 0.28) return { t: 'Normale', c: 'neutral' };
  if (p >= 0.1) return { t: 'Lente', c: 'warn' };
  return { t: 'Très lente', c: 'bad' };
}

function StandTab() {
  const game = useGame();
  const s = game.state;
  const types = visibleTypes(s);
  const stock = storedCount(s);
  const cashed = today(s).income.etal ?? 0;
  const queue = queueLength(s);
  const counters = standCounters(s);
  const lost = lostToday(s);
  const gold = s.goldEggs ?? 0;
  return (
    <>
      {(gold > 0 || s.hens.some((h) => h.golden)) && (
        <div class="notice">
          <span>
            ✨ Œufs d’or en réserve : <b>{gold}</b> — le collectionneur les rachète {fmtMoney(RARE.goldEggPrice)} pièce.
          </span>
          <Btn small kind="primary" disabled={gold <= 0} onClick={() => game.act(() => sellGoldEggs(s), 'coin')}>
            Vendre {gold > 1 ? `les ${gold}` : ''} ({fmtMoney(gold * RARE.goldEggPrice)})
          </Btn>
        </div>
      )}
      <div class="strip">
        <div>
          <small>En stock</small>
          <b>{stock} œufs</b>
        </div>
        <div>
          <small>Clients attendus</small>
          <b>≈ {Math.round(customersPerDay(s))} / jour</b>
        </div>
        <div>
          <small>File d’attente</small>
          <b>
            {queue} en attente · {counters} guichet{counters > 1 ? 's' : ''}
          </b>
        </div>
        <div>
          <small>Encaissé aujourd’hui</small>
          <b>{fmtMoney(cashed)}</b>
        </div>
        <div>
          <small>Réputation</small>
          <b>★ {Math.round(s.reputation)}</b>
        </div>
      </div>
      {lost > 0 && (
        <p class="hint warn">
          {lost} client{lost > 1 ? 's sont repartis' : ' est reparti'} sans rien acheter aujourd’hui, lassé{lost > 1 ? 's' : ''} d’attendre. Un vendeur à l’étal ouvre un guichet de plus et sert plus vite ; la Boutique de la ferme a deux guichets.
        </p>
      )}
      <MarketChart types={types} />
      <p class="lead">
        Les villageois passent de {TIME.SHOP_OPEN} h à {TIME.SHOP_CLOSE} h. Prix bas : les œufs partent vite. Prix haut : plus de marge… si les clients suivent.
      </p>
      <div class="price-list" data-tut="prices">
        {types.map((t) => (
          <PriceCard key={t} type={t} />
        ))}
      </div>
      <StandCard />
    </>
  );
}

/** Couleurs des courbes du marché (les teintes réelles des œufs blancs ou crème seraient illisibles). */
const EGG_LINE: Record<EggType, string> = { roux: '#c46a32', blanc: '#7d8ea6', creme: '#d6a43a', mini: '#a985c9', bleu: '#3a9cc0', chocolat: '#6b3f24', or: '#d4a017' };

/** Cours de l'œuf au fil des jours (prix de référence du marché, pour chaque type produit). */
function MarketChart({ types }: { types: EggType[] }) {
  const game = useGame();
  const s = game.state;
  // historique enregistré chaque jour, plus le cours du moment
  const hist = [...(s.market.history ?? [])];
  const now = { d: currentDay(s), p: EGG_ORDER.map((t) => refPrice(s, t)) };
  if (!hist.length || hist[hist.length - 1].d !== now.d) hist.push(now);
  else hist[hist.length - 1] = now;
  const shown = hist.slice(-28);
  const series = types.map((t) => ({ label: EGG_TYPES[t].short, color: EGG_LINE[t], values: shown.map((h) => h.p[EGG_ORDER.indexOf(t)] ?? null) }));
  return (
    <section class="chart-card">
      <div class="cc-head">
        <b>Cours de l’œuf</b>
        <small>prix du marché, {shown.length > 1 ? `${shown.length} derniers jours` : 'aujourd’hui'} · il monte doucement en automne et en hiver</small>
      </div>
      <HistoryChart days={shown.map((h) => h.d)} series={series} format={(v) => fmtMoney(Math.round(v))} height={150} />
    </section>
  );
}

/** L'étal lui-même : niveau, clientèle, et son amélioration (sur la même page que les prix). */
function StandCard() {
  const game = useGame();
  const s = game.state;
  const b = stand(s);
  if (!b) return null;
  const def = BUILDINGS.stand;
  const L = lvl(b);
  const next = def.levels[b.level];
  const up = A.checkUpgrade(s, b.id);
  const fr = (v?: number) => (v ?? 0).toLocaleString('fr-FR');
  return (
    <section class="stand-card">
      <img src={buildingThumb('stand', b.level)} alt="" />
      <div class="sc-main">
        <div class="sc-head">
          <b>{L.name}</b>
          <span class="pill">
            Niveau {b.level}/{def.levels.length}
          </span>
        </div>
        <span>
          {fr(L.flow)} client{(L.flow ?? 0) >= 2 ? 's' : ''} / heure · paniers ×{fr(L.qtyMult)} · entretien {fmtMoney(L.upkeep)} / jour
        </span>
        {next ? (
          <ul>
            <li>
              Clients {fr(L.flow)} → <b>{fr(next.flow)}</b> / heure
            </li>
            <li>
              Paniers ×{fr(L.qtyMult)} → <b>×{fr(next.qtyMult)}</b>
            </li>
            {next.perk && <li>{next.perk}</li>}
            {b.level + 1 === 3 && (
              <li>
                <b>Deux guichets</b> : la file avance deux fois plus vite
              </li>
            )}
          </ul>
        ) : (
          <small class="muted">Votre étal est au plus haut niveau.</small>
        )}
      </div>
      {next && (
        <div class="sc-act">
          <small>{next.name}</small>
          <Btn kind="primary" disabled={!up.ok} title={up.reason} onClick={() => game.act(() => A.upgrade(s, b.id), 'build')}>
            {up.ok || up.reason === 'Fonds insuffisants' ? `Améliorer · ${fmtMoney(next.cost)}` : up.reason}
          </Btn>
          {!up.ok && up.reason === 'Fonds insuffisants' && <small class="muted">Il manque {fmtMoney(next.cost - s.money)}</small>}
        </div>
      )}
    </section>
  );
}

function PriceCard({ type }: { type: EggType }) {
  const game = useGame();
  const s = game.state;
  const def = EGG_TYPES[type];
  const ref = refPrice(s, type);
  const price = s.prices[type];
  const lot = oldestLot(s, type);
  const p = buyProbability(s, type, price, lot?.grade ?? 'A', lot?.freshness ?? 90);
  const share = def.specialty ? p / MARKET.gourmetShare : p;
  const sp = speedLabel(share);
  const demand = estimatedDemand(s, type, price);
  const prod = dailyProduction(s, type);
  const stock = storedCount(s, type);
  const trend = s.market.trend[type] ?? 1;
  const set = (v: number) => {
    setPrice(s, type, v);
    game.changed();
  };
  const min = Math.round(def.ref * 0.4);
  const max = Math.round(def.ref * 2.5);
  const presets: Array<[string, number]> = [
    ['Écouler', Math.round(ref * 0.85)],
    ['Marché', ref],
    ['Premium', Math.round(ref * 1.2)],
  ];
  return (
    <div class="pcard2">
      <img class="pc-egg" src={eggThumb(type)} alt="" />
      <div class="pc-main">
        <div class="pc-top">
          <b>{def.name}</b>
          {def.specialty && <span class="tag">Gourmets</span>}
          <small>
            {stock} en stock{lot ? ` · ${GRADES[lot.grade].name} · fraîcheur ${Math.round(lot.freshness)} %` : ''}
          </small>
        </div>
        <div class="pc-slider">
          <button class="step" onClick={() => set(price - 5)} title="−0,05 €">
            −
          </button>
          <input type="range" min={min} max={max} step={5} value={price} onInput={(e) => set(Number((e.target as HTMLInputElement).value))} />
          <button class="step" onClick={() => set(price + 5)} title="+0,05 €">
            +
          </button>
        </div>
        <div class={`pc-accept ${sp.c}`}>
          <span class="acc">
            <i style={{ width: `${Math.round(Math.min(1, share) * 100)}%` }} />
          </span>
          <em>
            {Math.round(Math.min(1, share) * 100)} % des {def.specialty ? 'gourmets' : 'clients'} achètent · vente {sp.t.toLowerCase()}
          </em>
        </div>
        <small class="pc-foot">
          Demande ≈ {Math.round(demand)} / jour · votre production ≈ {n1(prod)} / jour · valeur du stock {fmtMoney(stock * price)}
        </small>
      </div>
      <div class="pc-price">
        <b>{fmtMoney(price)}</b>
        <small>par œuf</small>
        <span class={`mkt ${trend > 1.02 ? 'up' : trend < 0.98 ? 'down' : ''}`}>
          Marché {fmtMoney(ref)} {trend > 1.02 ? '▲' : trend < 0.98 ? '▼' : ''}
        </span>
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

function CoopTab() {
  const game = useGame();
  const s = game.state;
  const types = EGG_ORDER.filter((t) => storedCount(s, t) > 0);
  const lvl = farmLevel(s);
  return (
    <>
      <p class="hint">La coopérative achète immédiatement n’importe quelle quantité, mais à environ {Math.round(MARKET.wholesaleFactor * 100)} % du prix du marché (selon catégorie et fraîcheur). Pratique pour libérer du stock ou renflouer la trésorerie.</p>
      {types.length === 0 && <p class="empty">Aucun œuf en stock à vendre.</p>}
      {types.map((t) => (
        <CoopRow key={t} type={t} />
      ))}
      <div class={`auto-box ${lvl < UNLOCKS.pallets ? 'locked' : ''}`}>
        <b>Vente en volume : palettes de {MARKET.palletSize} œufs</b> {lvl < UNLOCKS.pallets ? `(niveau ${UNLOCKS.pallets})` : `· ${palletsLeft(s)} restante(s) aujourd’hui`}
        <p class="hint">Centrale d’achat : {Math.round(MARKET.palletFactor * 100)} % du prix du marché, maximum {MARKET.palletsPerDay} palettes par jour.</p>
        <div class="actions">
          {EGG_ORDER.filter((t) => storedCount(s, t) >= MARKET.palletSize).map((t) => (
            <Btn key={t} kind="primary" disabled={lvl < UNLOCKS.pallets || palletsLeft(s) <= 0} onClick={() => game.act(() => ({ ok: sellPallet(s, t) > 0, reason: 'Vente impossible' }), 'coin')}>
              Palette {EGG_TYPES[t].short} · {fmtMoney(wholesaleQuote(s, t, MARKET.palletSize, MARKET.palletFactor).total)}
            </Btn>
          ))}
        </div>
      </div>
    </>
  );
}

function CoopRow({ type }: { type: EggType }) {
  const game = useGame();
  const s = game.state;
  const stock = storedCount(s, type);
  const [qty, setQty] = useState(stock);
  const q = Math.min(qty, stock);
  const quote = wholesaleQuote(s, type, q);
  return (
    <div class="price-row">
      <div class="pr-head">
        <EggDot type={type} size={16} />
        <b>{EGG_TYPES[type].name}</b>
        <span class="pr-stock">{stock} en stock</span>
      </div>
      <div class="pr-ctrl">
        <input type="range" min={0} max={stock} value={q} onInput={(e) => setQty(Number((e.target as HTMLInputElement).value))} />
        <div class="pr-price">
          <b>{q}</b>
          <small>œufs</small>
        </div>
        <Btn kind="primary" disabled={q <= 0} onClick={() => game.act(() => ({ ok: sellWholesale(s, type, q) > 0, reason: 'Stock insuffisant' }), 'coin')}>
          Vendre · {fmtMoney(quote.total)}
        </Btn>
      </div>
      <small class="muted">Soit {q > 0 ? fmtMoney(Math.round(quote.total / q)) : '—'} par œuf (étal : {fmtMoney(s.prices[type])})</small>
    </div>
  );
}

/** Bouton à deux temps : un premier clic arme, un second confirme (annulé au bout de 4 s). */
function TwoStep({ label, confirm, onConfirm }: { label: string; confirm: string; onConfirm: () => void }) {
  const [armed, setArmed] = useState(0);
  const live = armed > 0 && performance.now() - armed < 4000;
  return (
    <Btn
      kind={live ? 'danger' : 'ghost'}
      small
      onClick={() => {
        if (live) {
          setArmed(0);
          onConfirm();
        } else {
          setArmed(performance.now());
          setTimeout(() => setArmed((a) => (a && performance.now() - a >= 3990 ? 0 : a)), 4000);
        }
      }}
    >
      {live ? confirm : label}
    </Btn>
  );
}

function OrdersTab() {
  const game = useGame();
  const s = game.state;
  const day = currentDay(s);
  const active = s.orders.filter((o) => o.status === 'active');
  const offers = s.orders.filter((o) => o.status === 'offer');
  return (
    <>
      <p class="hint">
        Les commandes, petites ou grosses, paient mieux que l’étal mais exigent une quantité et une catégorie minimales avant une date limite. Dès que le stock suffit, une notification vous propose de livrer. Une commande acceptée peut être annulée (un peu de
        réputation perdue) ; un retard en coûte davantage. Maximum {ORDERS.maxActive} commandes en cours.
      </p>
      <h5>En cours ({active.length})</h5>
      {active.length === 0 && <p class="empty">Aucune commande en cours.</p>}
      {active.map((o) => {
        const have = storedCount(s, o.type, o.minGrade);
        return (
          <div class="order" key={o.id}>
            <div class="o-main">
              <b>{o.client}</b>
              <span>
                <EggDot type={o.type} /> {o.qty} × {EGG_TYPES[o.type].short} ({o.minGrade === 'extra' ? 'Extra' : 'cat. A min.'}) à {fmtMoney(o.unitPrice)}
              </span>
              <small class={o.deadlineDay - day <= 0 ? 'neg' : ''}>
                Livrer avant la fin du jour {o.deadlineDay} · stock compatible {have}/{o.qty}
              </small>
            </div>
            <div class="o-side">
              <b>{fmtMoney(o.qty * o.unitPrice)}</b>
              <div class="row-btns">
                <TwoStep label="Annuler" confirm="Confirmer l’annulation" onConfirm={() => game.act(() => cancelOrder(s, o.id))} />
                <Btn kind="primary" small disabled={!canDeliver(s, o)} onClick={() => game.act(() => deliverOrder(s, o.id), 'coin')}>
                  {canDeliver(s, o) ? 'Livrer maintenant' : 'Livrer'}
                </Btn>
              </div>
            </div>
          </div>
        );
      })}
      <h5>Offres ({offers.length})</h5>
      {offers.length === 0 && <p class="empty">Pas de nouvelle offre. Il en arrive chaque matin.</p>}
      {offers.map((o) => (
        <div class="order offer" key={o.id}>
          <div class="o-main">
            <b>{o.client}</b>
            <span>
              <EggDot type={o.type} /> {o.qty} × {EGG_TYPES[o.type].short} ({o.minGrade === 'extra' ? 'Extra' : 'cat. A min.'}) à {fmtMoney(o.unitPrice)}{' '}
              <em class="pos">+{Math.round((o.unitPrice / refPrice(s, o.type) - 1) * 100)} %</em>
            </span>
            <small>
              Délai : jour {o.deadlineDay} · offre valable jusqu’au jour {o.offerUntilDay}
            </small>
          </div>
          <div class="o-side">
            <b>{fmtMoney(o.qty * o.unitPrice)}</b>
            <div class="row-btns">
              <Btn kind="ghost" small onClick={() => game.act(() => declineOrder(s, o.id))}>
                Refuser
              </Btn>
              <Btn kind="primary" small onClick={() => game.act(() => acceptOrder(s, o.id))}>
                Accepter
              </Btn>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function ContractsTab() {
  const game = useGame();
  const s = game.state;
  const active = s.contracts.filter((c) => c.status === 'active');
  const offers = s.contracts.filter((c) => c.status === 'offer');
  return (
    <>
      <p class="hint">
        Chaque jour à {TIME.CONTRACT_HOUR} h, les œufs prévus sont prélevés automatiquement dans le stock (ou plus tôt avec « Livrer aujourd’hui »). Œufs manquants = pénalité et perte de réputation. Un contrat peut être résilié
        contre une journée de pénalité. Contrats simultanés : {maxContracts(s)}.
      </p>
      <h5>Actifs ({active.length})</h5>
      {active.length === 0 && <p class="empty">Aucun contrat actif.</p>}
      {active.map((c) => (
        <div class="order" key={c.id}>
          <div class="o-main">
            <b>{c.client}</b>
            <span>
              <EggDot type={c.type} /> {c.qtyPerDay} {EGG_TYPES[c.type].short}/jour à {fmtMoney(c.unitPrice)}
            </span>
            <small>
              {c.days - c.daysLeft}/{c.days} jours · {c.delivered} livrés{c.missed ? ` · ${c.missed} manqué(s)` : ''}
            </small>
          </div>
          <div class="o-side">
            <b>{fmtMoney(c.qtyPerDay * c.unitPrice)}/j</b>
            <small class={storedCount(s, c.type) >= c.qtyPerDay ? 'pos' : 'neg'}>
              Stock {storedCount(s, c.type)}
              {c.lastDay === currentDay(s) ? ' · livré aujourd’hui' : ''}
            </small>
            <div class="row-btns">
              <TwoStep label="Résilier" confirm="Confirmer (pénalité)" onConfirm={() => game.act(() => cancelContract(s, c.id))} />
              <Btn
                kind="primary"
                small
                disabled={c.lastDay === currentDay(s) || storedCount(s, c.type) < c.qtyPerDay}
                onClick={() => game.act(() => deliverContractNow(s, c.id), 'coin')}
              >
                Livrer aujourd’hui
              </Btn>
            </div>
          </div>
        </div>
      ))}
      <h5>Propositions ({offers.length})</h5>
      {offers.length === 0 && <p class="empty">Aucune proposition pour l’instant.</p>}
      {offers.map((c) => (
        <div class="order offer" key={c.id}>
          <div class="o-main">
            <b>{c.client}</b>
            <span>
              <EggDot type={c.type} /> {c.qtyPerDay} {EGG_TYPES[c.type].short}/jour pendant {c.days} jours à {fmtMoney(c.unitPrice)}
            </span>
            <small>
              Total {fmtMoney(c.qtyPerDay * c.unitPrice * c.days)} · production actuelle ≈ {n1(dailyProduction(s, c.type))}/j
            </small>
          </div>
          <div class="o-side">
            <div class="row-btns">
              <Btn kind="ghost" small onClick={() => game.act(() => declineContract(s, c.id))}>
                Refuser
              </Btn>
              <Btn kind="primary" small onClick={() => game.act(() => acceptContract(s, c.id))}>
                Signer
              </Btn>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

function AutoTab() {
  const game = useGame();
  const s = game.state;
  return (
    <div class="auto-box">
      <label>
        <input
          type="checkbox"
          checked={s.settings.autoWholesale}
          onChange={(e) => {
            s.settings.autoWholesale = (e.target as HTMLInputElement).checked;
            game.changed();
          }}
        />
        <b>Vendre automatiquement le surplus à la coopérative</b>
      </label>
      <div class="auto-row">
        <span>Garder au maximum</span>
        <input
          type="number"
          min={0}
          max={100000}
          value={s.settings.autoWholesaleThreshold}
          onChange={(e) => {
            s.settings.autoWholesaleThreshold = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
            game.changed();
          }}
        />
        <span>œufs en stock (les plus anciens partent en premier, vérifié chaque heure).</span>
      </div>
      <p class="hint">Conseil : gardez assez d’œufs pour l’étal, vos commandes et vos contrats.</p>
    </div>
  );
}
