// Concours agricole et qualités héréditaires : étoiles des volailles, page du concours (catégorie,
// prochaine date, candidates, palmarès) et fenêtre du podium après chaque concours.
import { BREEDS } from '../config/breeds';
import { fmtMoney } from '../sim/economy';
import { GENE_INFO, GENE_KEYS, genesOf } from '../sim/genetics';
import { SHOW_HOUR, SHOW_TIERS, enterShow, showCandidates, showCountdown, trophyCount } from '../sim/show';
import { birdThumb } from '../render/thumbs';
import type { BreedId, Hen } from '../sim/types';
import { Btn, Icon, useGame } from './common';

/** Les trois qualités d'une volaille, en étoiles. */
export function GeneStars({ h, compact = false }: { h: Pick<Hen, 'genes'>; compact?: boolean }) {
  const g = genesOf(h);
  return (
    <div class={`genes ${compact ? 'compact' : ''}`}>
      {GENE_KEYS.map((k) => (
        <div key={k} class={`gene g${g[k]}`} title={`${GENE_INFO[k].label} : ${g[k]}/5 — ${GENE_INFO[k].help}`}>
          <span>{compact ? GENE_INFO[k].short : GENE_INFO[k].label}</span>
          <b>
            {'★'.repeat(g[k])}
            <i>{'★'.repeat(5 - g[k])}</i>
          </b>
        </div>
      ))}
    </div>
  );
}

/**
 * Étoiles qu'on peut espérer à l'achat pour une race : sûres (dorées), possibles (pâles),
 * hors d'atteinte (grises). Chaque race a son profil ; les 4 et 5 étoiles viennent de l'élevage.
 */
export function GeneRange({ breed }: { breed: BreedId }) {
  const R = BREEDS[breed].genes;
  return (
    <div class="genes range" title="Étoiles à l’achat : chaque animal est tiré au hasard dans la fourchette de sa race. Les 4★ et 5★ s’obtiennent par l’élevage.">
      {GENE_KEYS.map((k) => {
        const [lo, hi] = R[k];
        return (
          <div key={k} class="gene">
            <span>{GENE_INFO[k].label}</span>
            <b>
              {'★'.repeat(lo)}
              {hi > lo && <u>{'★'.repeat(hi - lo)}</u>}
              <i>{'★'.repeat(5 - hi)}</i>
            </b>
          </div>
        );
      })}
    </div>
  );
}

const placeLabel = (p: number) => (p === 1 ? '1re' : `${p}e`);
/** Médaille dessinée (or, argent, bronze) ; au-delà du podium, un simple rang. */
const medal = (p: number) => <span class={`medal m${Math.min(p, 4)}`}>{p}</span>;

/** Ligne du panneau de gauche : prochain concours (un clic ouvre la page du concours). */
export function ShowLine() {
  const game = useGame();
  const s = game.state;
  if (!s.hens.some((h) => !h.young)) return null;
  const c = showCountdown(s);
  const tier = SHOW_TIERS[s.show.tier];
  const when = c.hoursLeft < 1 ? 'en cours' : c.hoursLeft < 24 ? `dans ${Math.ceil(c.hoursLeft)} h` : `dans ${c.daysLeft} j`;
  const entry = s.hens.find((h) => h.id === s.show.entryId);
  return (
    <button class={`show-line ${c.hoursLeft < 24 ? 'soon' : ''}`} onClick={() => game.openPanel('missions', 'show')} title="Ouvrir la page du concours">
      <span class="sl-ic">
        <Icon name="trophy" size={17} />
      </span>
      <span class="sl-txt">
        <b>{tier.name}</b>
        <small>
          {when} · {entry ? `${entry.name} inscrite` : 'personne d’inscrit'}
        </small>
      </span>
    </button>
  );
}

/** Page du concours (onglet du panneau Missions). */
export function ShowPanel() {
  const game = useGame();
  const s = game.state;
  const tier = SHOW_TIERS[s.show.tier];
  const c = showCountdown(s);
  const cands = showCandidates(s).slice(0, 8);
  const entry = s.hens.find((h) => h.id === s.show.entryId);
  const trophies = [...s.show.trophies].reverse();
  return (
    <div class="show-page">
      <section class="show-hero">
        <div class="sh-cup">
          <Icon name="trophy" size={36} />
        </div>
        <div class="sh-main">
          <b>{tier.name}</b>
          <span>
            Jour {c.day} à {SHOW_HOUR} h · {c.hoursLeft < 24 ? `dans ${Math.max(0, Math.ceil(c.hoursLeft))} h` : `dans ${c.daysLeft} jours`}
          </span>
          <small>
            Prix : 1er {fmtMoney(tier.prize)} · 2e {fmtMoney(tier.prize * 0.4)} · 3e {fmtMoney(tier.prize * 0.2)} · rivaux autour de {tier.rival} points
          </small>
        </div>
        <div class="sh-ladder" title="Gagnez pour monter de catégorie">
          {SHOW_TIERS.map((t, i) => (
            <span key={t.name} class={i < s.show.tier ? 'done' : i === s.show.tier ? 'cur' : ''}>
              {t.short}
            </span>
          ))}
        </div>
      </section>
      <p class="lead">
        Le dernier jour de chaque saison, une volaille de la ferme affronte trois éleveurs du coin. La <b>beauté</b> compte double, puis la ponte, la robustesse, la santé et la forme du jour. Gagnez pour monter de catégorie : les rivaux deviennent plus forts, il faudra sélectionner votre lignée.
      </p>
      <div class="sect-head">
        <div>
          <h3>Votre candidate</h3>
          <p>{entry ? `${entry.name} est inscrite.` : 'Personne d’inscrit : la plus belle sera présentée d’office.'}</p>
        </div>
      </div>
      {cands.length === 0 ? (
        <p class="hint warn">Aucune volaille adulte en bonne santé ne peut concourir pour l’instant.</p>
      ) : (
        <div class="cand-list">
          {cands.map(({ hen, score }, i) => {
            const on = hen.id === s.show.entryId;
            const chance = score - tier.rival;
            return (
              <div key={hen.id} class={`cand ${on ? 'on' : ''}`}>
                <img src={birdThumb(hen)} alt="" />
                <div class="cand-main">
                  <b>
                    {hen.name} <small>· {BREEDS[hen.breed].name}</small>
                  </b>
                  <GeneStars h={hen} compact />
                </div>
                <div class={`cand-score ${chance >= 6 ? 'good' : chance >= -4 ? 'mid' : 'low'}`} title="Note estimée (le jour J, un peu de chance s’en mêle)">
                  <b>{score}</b>
                  <small>{chance >= 6 ? 'favorite' : chance >= -4 ? 'à sa chance' : 'outsider'}</small>
                </div>
                {on ? (
                  <span class="cand-on">✓ Inscrite</span>
                ) : (
                  <Btn small kind={i === 0 && !entry ? 'primary' : 'soft'} onClick={() => game.act(() => enterShow(s, hen.id), 'buy')}>
                    Inscrire
                  </Btn>
                )}
              </div>
            );
          })}
        </div>
      )}
      <div class="sect-head">
        <div>
          <h3>Palmarès</h3>
          <p>
            {trophyCount(s, 1)} or · {trophyCount(s, 2)} argent · {trophyCount(s, 3)} bronze
          </p>
        </div>
      </div>
      {trophies.length === 0 ? (
        <p class="hint">Pas encore de trophée : le premier concours a lieu le jour 7.</p>
      ) : (
        <div class="trophies">
          {trophies.slice(0, 24).map((t, i) => (
            <div key={i} class={`trophy p${t.place}`} title={`${SHOW_TIERS[t.tier].name}, jour ${t.day}`}>
              <span>{medal(t.place)}</span>
              <b>{t.hen}</b>
              <small>
                {SHOW_TIERS[t.tier].short} · j{t.day}
              </small>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Fenêtre du podium, juste après le concours. */
export function ShowResultModal() {
  const game = useGame();
  const r = game.showResult;
  if (!r) return null;
  const tier = SHOW_TIERS[r.tier];
  const close = () => {
    game.showResult = null;
    game.changed();
  };
  return (
    <div class="modal-wrap">
      <div class="modal card show-result">
        <div class="burst">{medal(r.place)}</div>
        <h2>
          {r.henName} : {placeLabel(r.place)} place
        </h2>
        <p class="sub">
          {tier.name}
          {r.auto ? ' · présentée d’office' : ''}
        </p>
        <ol class="podium">
          {r.ranking.map((x, i) => (
            <li key={i} class={x.mine ? 'mine' : ''}>
              <span class="pd-rank">{medal(i + 1)}</span>
              <span class="pd-name">
                <b>{x.name}</b>
                <small>
                  {x.farm} · {BREEDS[x.breed].name}
                </small>
              </span>
              <span class="pd-score">{x.score} pts</span>
            </li>
          ))}
        </ol>
        {r.prize > 0 && <p class="prize">+{fmtMoney(r.prize)} de prix</p>}
        {r.promoted ? (
          <p class="next">Vous montez de catégorie : prochain rendez-vous au {SHOW_TIERS[r.tier + 1].name} !</p>
        ) : r.place > 1 ? (
          <p class="next">Astuce : la beauté compte double. Faites naître des poussins de vos plus belles volailles pour gagner des étoiles.</p>
        ) : (
          <p class="next">Vous êtes au sommet : défendez votre titre à chaque saison !</p>
        )}
        <Btn kind="primary" block onClick={close}>
          Continuer
        </Btn>
      </div>
    </div>
  );
}
