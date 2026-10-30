import { useEffect, useState } from 'preact/hooks';
import { HEALTH, LAYING } from '../config/balance';
import { BREEDS, BREED_ORDER } from '../config/breeds';
import * as A from '../sim/actions';
import { fmtMoney } from '../sim/economy';
import { ACT_LABELS, eggsPerDayOf, henStatus, henValue, isLayer, productivity } from '../sim/hens';
import { birdRole } from './Inspector';
import { GeneStars } from './Show';
import { geneTotal, genesOf } from '../sim/genetics';
import type { BreedId, Hen } from '../sim/types';
import { Btn, EggDot, n1, useGame } from './common';
import { HistoryChart } from './Charts';
import { birdThumb, henThumb } from '../render/thumbs';

type SortKey = 'name' | 'breed' | 'age' | 'health' | 'satiety' | 'hydration' | 'wellbeing' | 'prod' | 'eggs' | 'value' | 'genes';
type Filter = 'all' | 'watch' | 'sick' | 'old' | 'roosters' | 'young' | BreedId;

function sortValue(h: Hen, k: SortKey): number | string {
  switch (k) {
    case 'name':
      return h.name.toLowerCase();
    case 'breed':
      return BREED_ORDER.indexOf(h.breed);
    case 'age':
      return h.age;
    case 'health':
      return h.health;
    case 'satiety':
      return h.satiety;
    case 'hydration':
      return h.hydration;
    case 'wellbeing':
      return h.wellbeing;
    case 'prod':
      return isLayer(h) ? productivity(h) : -1;
    case 'eggs':
      return h.eggsLaid;
    case 'value':
      return henValue(h);
    case 'genes':
      return geneTotal(genesOf(h)) * 10 + genesOf(h).b;
  }
}

function Mini({ v, label }: { v: number; label: string }) {
  const tone = v < 30 ? 'bad' : v < 55 ? 'warn' : 'good';
  return (
    <span class={`mini ${tone}`} title={`${label} : ${Math.round(v)}`}>
      <i style={{ width: `${Math.max(4, Math.min(100, v))}%` }} />
      <em>{label}</em>
    </span>
  );
}

const SORTS: Array<[SortKey, string, boolean]> = [
  ['health', 'Santé (fragiles d’abord)', true],
  ['prod', 'Ponte (meilleures d’abord)', false],
  ['genes', 'Qualités ★ (meilleures d’abord)', false],
  ['age', 'Âge (plus jeunes d’abord)', true],
  ['name', 'Nom', true],
  ['value', 'Valeur', false],
];

export function HenListPanel() {
  const game = useGame();
  const s = game.state;
  const [sort, setSort] = useState<SortKey>('health');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [confirmOld, setConfirmOld] = useState(false);
  const [confirmRoosters, setConfirmRoosters] = useState(false);
  // vente rapide depuis la liste : premier clic « Vendre », second clic pour confirmer
  const [sellId, setSellId] = useState<number | null>(null);
  useEffect(() => {
    if (sellId === null) return;
    const t = setTimeout(() => setSellId(null), 3500);
    return () => clearTimeout(t);
  }, [sellId]);

  const watch = (h: Hen) => henStatus(h).tone !== 'good';
  const isOld = (h: Hen) => isLayer(h) && h.age > LAYING.declineStart;
  const asc = SORTS.find(([k]) => k === sort)?.[2] ?? true;
  let list = s.hens.filter((h) => {
    if (filter === 'watch' && !watch(h)) return false;
    if (filter === 'sick' && !(h.sick || h.health < HEALTH.warnAt)) return false;
    if (filter === 'old' && !isOld(h)) return false;
    if (filter === 'roosters' && !(h.rooster && !h.young)) return false;
    if (filter === 'young' && !h.young) return false;
    if (BREEDS[filter as BreedId] && h.breed !== filter) return false;
    if (query && !h.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });
  list = [...list].sort((a, b) => {
    const va = sortValue(a, sort);
    const vb = sortValue(b, sort);
    const c = va < vb ? -1 : va > vb ? 1 : 0;
    return asc ? c : -c;
  });

  const total = s.hens.length;
  const perDay = s.hens.reduce((a, h) => a + eggsPerDayOf(h), 0);
  const layers = s.hens.filter(isLayer);
  const avgProd = layers.length ? layers.reduce((a, h) => a + productivity(h), 0) / layers.length : 0;
  const roosters = s.hens.filter((h) => h.rooster && !h.young).length;
  const young = s.hens.filter((h) => h.young).length;
  const toWatch = s.hens.filter(watch).length;
  const sick = s.hens.filter((h) => h.sick || h.health < HEALTH.warnAt);
  const old = s.hens.filter(isOld);
  const byBreed = BREED_ORDER.map((b) => [b, s.hens.filter((h) => h.breed === b).length] as const).filter(([, n]) => n > 0);

  return (
    <div class="panel-body">
      <div class="strip">
        <div>
          <small>Pondeuses</small>
          <b>{layers.length}</b>
        </div>
        {(roosters > 0 || young > 0) && (
          <div>
            <small>Coqs · Jeunes</small>
            <b>
              {roosters} · {young}
            </b>
          </div>
        )}
        <div>
          <small>Ponte estimée</small>
          <b>{n1(perDay)} œufs / jour</b>
        </div>
        <div>
          <small>Productivité moyenne</small>
          <b>{Math.round(avgProd * 100)} %</b>
        </div>
        <div class={toWatch ? 'alert' : ''}>
          <small>À surveiller</small>
          <b>{toWatch}</b>
        </div>
      </div>
      <LayingChart current={avgProd} />
      <div class="list-bar">
        <div class="seg">
          {(
            [
              ['all', `Toutes ${total}`],
              ['watch', `À surveiller ${toWatch}`],
              ['sick', `Malades ${sick.length}`],
              ['old', `Âgées ${old.length}`],
              ...(roosters ? [['roosters', `Coqs ${roosters}`]] : []),
              ...(young ? [['young', `Jeunes ${young}`]] : []),
            ] as Array<[Filter, string]>
          ).map(([f, l]) => (
            <button key={f} class={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
              {l}
            </button>
          ))}
        </div>
        {byBreed.length > 1 && (
          <select class="pick" value={BREEDS[filter as BreedId] ? filter : ''} onChange={(e) => setFilter(((e.target as HTMLSelectElement).value || 'all') as Filter)}>
            <option value="">Toutes les races</option>
            {byBreed.map(([b, n]) => (
              <option key={b} value={b}>
                {BREEDS[b].name} ({n})
              </option>
            ))}
          </select>
        )}
        <select class="pick" value={sort} onChange={(e) => setSort((e.target as HTMLSelectElement).value as SortKey)}>
          {SORTS.map(([k, l]) => (
            <option key={k} value={k}>
              Tri : {l}
            </option>
          ))}
        </select>
        <input class="search" placeholder="Rechercher…" value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)} />
      </div>
      {filter === 'roosters' &&
        (() => {
          const extra = A.extraRoosters(game.state);
          if (!extra.length) return null;
          const total = extra.reduce((a, h) => a + henValue(h), 0);
          return (
            <div class="bulk">
              {!confirmRoosters ? (
                <Btn small kind="soft" onClick={() => setConfirmRoosters(true)} title="Garde le meilleur reproducteur (un coq pour les poules, un jars pour les oies). Les coqs entièrement noirs ne sont jamais vendus d’office.">
                  Vendre les {extra.length} coq{extra.length > 1 ? 's' : ''} en trop · garder le meilleur · +{fmtMoney(total)}
                </Btn>
              ) : (
                <Btn
                  small
                  kind="danger"
                  onClick={() => {
                    setConfirmRoosters(false);
                    game.act(() => A.sellExtraRoosters(game.state), 'coin');
                  }}
                >
                  Confirmer : vendre {extra.length} coq{extra.length > 1 ? 's' : ''} pour {fmtMoney(total)}
                </Btn>
              )}
            </div>
          );
        })()}
      {(sick.length > 0 || old.length > 0) && (
        <div class="bulk">
          {sick.length > 0 && (
            <Btn small kind="soft" onClick={() => game.act(() => healAll(game.state), 'buy')}>
              Soigner les {sick.length} fragiles · {fmtMoney(sick.length * HEALTH.vetCost)}
            </Btn>
          )}
          {old.length > 0 &&
            (!confirmOld ? (
              <Btn small kind="ghost" onClick={() => setConfirmOld(true)} title="Les vieilles poules (600 jours et plus) pondent moins : confiez-les à une association ou à des particuliers">
                Réformer les {old.length} vieilles poules
              </Btn>
            ) : (
              <Btn
                small
                kind="danger"
                onClick={() => {
                  setConfirmOld(false);
                  game.act(() => rehomeOld(game.state), 'pop');
                }}
              >
                Confirmer : les confier à des associations et particuliers
              </Btn>
            ))}
        </div>
      )}
      {total === 0 ? (
        <div class="empty-state">
          <img src={henThumb('rousse')} alt="" />
          <b>Pas encore de poule</b>
          <span>Achetez votre première poule dans la boutique.</span>
          <Btn kind="primary" onClick={() => game.openPanel('shop', 'hens')}>
            Ouvrir la boutique
          </Btn>
        </div>
      ) : (
        <div class="hen-cards">
          {list.map((h) => {
            const b = BREEDS[h.breed];
            const st = henStatus(h);
            const sel = game.selection?.kind === 'hen' && game.selection.id === h.id;
            const arming = sellId === h.id;
            return (
              <div class="hcard-wrap" key={h.id}>
              <button
                class={`hcard ${sel ? 'sel' : ''} ${st.tone}`}
                onClick={() => {
                  game.select({ kind: 'hen', id: h.id });
                  game.follow = true;
                  game.renderer.setZoom(Math.max(game.renderer.zoom, 2));
                  const p = game.renderer.henPosition(h.id);
                  if (p) game.renderer.focusOn(p.x, p.z);
                  game.openPanel(null);
                }}
              >
                <img src={birdThumb(h)} alt="" />
                <div class="hc-main">
                  <div class="hc-top">
                    <b>{h.name}</b>
                    <span class={`pill ${st.tone}`}>{st.label}</span>
                    {h.black && <span class="pill rare">Rarissime</span>}
                    {h.golden && <span class="pill rare">Œufs d’or</span>}
                  </div>
                  <small>
                    {h.rooster || h.young ? `${birdRole(h)} · ` : ''}
                    {b.name} · {Math.floor(h.age)} j · {ACT_LABELS[h.act]}
                  </small>
                  <GeneStars h={h} compact />
                  <div class="hc-needs">
                    <Mini v={h.health} label="Santé" />
                    <Mini v={h.satiety} label="Repue" />
                    <Mini v={h.hydration} label="Eau" />
                    <Mini v={h.wellbeing} label="Moral" />
                  </div>
                </div>
                <div class="hc-side">
                  {isLayer(h) ? (
                    <>
                      <b>{Math.round(productivity(h) * 100)} %</b>
                      <small>
                        <EggDot type={b.egg} size={9} /> {n1(eggsPerDayOf(h))} / j
                      </small>
                    </>
                  ) : h.young ? (
                    <>
                      <b>{Math.ceil(h.young)} j</b>
                      <small>avant adulte</small>
                    </>
                  ) : (
                    <>
                      <b>Coq</b>
                      <small>féconde</small>
                    </>
                  )}
                  <small>{fmtMoney(henValue(h))}</small>
                </div>
              </button>
                <button
                  class={`hc-sell ${arming ? 'arming' : ''}`}
                  title={arming ? 'Cliquer encore pour confirmer la vente' : `Vendre ${h.name} pour ${fmtMoney(henValue(h))}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!arming) return setSellId(h.id);
                    setSellId(null);
                    game.act(() => A.sellHen(s, h.id), 'coin');
                  }}
                >
                  {arming ? `Confirmer · ${fmtMoney(henValue(h))}` : 'Vendre'}
                </button>
              </div>
            );
          })}
          {list.length === 0 && <p class="empty">Aucune poule ne correspond.</p>}
        </div>
      )}
    </div>
  );
}

/** Taux de ponte moyen des pondeuses jour après jour, et œufs pondus chaque jour (barres). */
function LayingChart({ current }: { current: number }) {
  const game = useGame();
  const s = game.state;
  const days = s.finance.days.slice(-28);
  if (!days.length) return null;
  const last = days.length - 1;
  const rate = days.map((d, i) => (i === last && current > 0 ? current * 100 : d.layN ? (d.laySum! / d.layN) * 100 : null));
  const eggs = days.map((d) => d.eggs ?? null);
  return (
    <section class="chart-card">
      <div class="cc-head">
        <b>Taux de ponte moyen</b>
        <small>de toutes vos pondeuses, relevé chaque heure · barres : œufs pondus par jour</small>
      </div>
      <HistoryChart
        days={days.map((d) => d.day)}
        series={[{ label: 'Taux de ponte', color: '#2f6bff', values: rate }]}
        bars={{ label: 'Œufs pondus', color: '#e2b752', values: eggs }}
        format={(v) => `${Math.round(v)} %`}
        barFormat={(v) => `${Math.round(v)} œufs`}
        floor={0}
        ceil={100}
        height={140}
      />
    </section>
  );
}

function healAll(s: import('../sim/types').GameState) {
  const sick = s.hens.filter((h) => h.sick || h.health < HEALTH.warnAt);
  let n = 0;
  for (const h of sick) if (A.healHen(s, h.id).ok) n++;
  return n > 0 ? { ok: true } : { ok: false, reason: 'Fonds insuffisants' };
}

/** Réforme : les vieilles poules partent à la retraite chez des particuliers ou dans une association. */
function rehomeOld(s: import('../sim/types').GameState) {
  const old = s.hens.filter((h) => isLayer(h) && h.age >= LAYING.declineStart).map((h) => h.id);
  for (const id of old) A.rehomeHen(s, id);
  return old.length ? { ok: true } : { ok: false, reason: 'Aucune vieille poule' };
}
