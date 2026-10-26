// La Banque : les comptes de la ferme (solde, résultat, évolution de la trésorerie et de la dette,
// revenus et dépenses, journal) et le prêt express (curseur, durée, taux du moment, échéance).
import { useState } from 'preact/hooks';
import { BANK, creditLimit, dailyDue, isPaused, pauseCost, pauseLoan, quoteLoan, repayLoan, takeLoan, totalDebt, type Duration } from '../sim/bank';
import { EXPENSE_LABELS, FINANCING_IN, FINANCING_OUT, INCOME_LABELS, OPERATING, fmtMoney, fmtSigned, sumExpense, sumIncome, today } from '../sim/economy';
import { season } from '../sim/seasons';
import { dailyCharges } from '../sim/simulation';
import type { DayFinance, ExpenseCat, IncomeCat } from '../sim/types';
import { Bar, Btn, Chip, Icon, Stat, useGame } from './common';

const pct = (r: number) => `${(r * 100).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;

export function BankPanel() {
  const game = useGame();
  const s = game.state;
  // l'onglet vit dans game.panelTab : le lien « empruntez » des comptes peut y basculer
  const tab = game.panelTab === 'loan' ? 'loan' : 'accounts';
  const setTab = (t: 'accounts' | 'loan') => {
    game.panelTab = t;
    game.changed();
  };
  const t = today(s);
  const debt = totalDebt(s);
  const due = dailyDue(s);
  const result = sumIncome(t) - sumExpense(t);
  const limit = creditLimit(s);
  return (
    <>
      <div class="bank-head">
        <div class={`bank-balance ${s.money < 0 ? 'neg' : ''}`}>
          <span>Solde du compte</span>
          <b>{fmtMoney(s.money)}</b>
          <small>{s.money < 0 ? 'À découvert : agios chaque nuit' : 'Disponible'}</small>
        </div>
        <div class="bank-figs">
          <div>
            <span>Aujourd’hui</span>
            <b class={result >= 0 ? 'pos' : 'neg'}>{fmtSigned(result)}</b>
            <small>résultat du jour</small>
          </div>
          <div>
            <span>Dette</span>
            <b class={debt ? 'neg' : ''}>{fmtMoney(debt)}</b>
            <small>{s.loans.length ? `${s.loans.length} prêt${s.loans.length > 1 ? 's' : ''} en cours` : 'aucun prêt'}</small>
          </div>
          <div>
            <span>Cette nuit</span>
            <b>−{fmtMoney(dailyCharges(s).total)}</b>
            <small>{due ? `dont ${fmtMoney(due)} d’échéances` : 'charges de la ferme'}</small>
          </div>
        </div>
      </div>
      <div class="bank-switch" role="tablist">
        <button role="tab" aria-selected={tab === 'accounts'} class={tab === 'accounts' ? 'on' : ''} onClick={() => setTab('accounts')}>
          <Icon name="chart" size={18} />
          <span>
            <b>Mes comptes</b>
            <small>Revenus, dépenses, journal</small>
          </span>
        </button>
        <button role="tab" aria-selected={tab === 'loan'} class={tab === 'loan' ? 'on' : ''} onClick={() => setTab('loan')}>
          <Icon name="bank" size={18} />
          <span>
            <b>
              Emprunter {s.loans.length > 0 && <i class="bs-count">{s.loans.length}</i>}
            </b>
            <small>Jusqu’à {fmtMoney(limit)}</small>
          </span>
        </button>
      </div>
      <div class="panel-body bank-body">{tab === 'accounts' ? <Accounts /> : <LoanDesk />}</div>
    </>
  );
}

// ---------------------------------------------------------------- Comptes ----
function Chart({ days }: { days: DayFinance[] }) {
  const W = 560;
  const H = 180;
  const pad = 30;
  const byDay = new Map<number, DayFinance>();
  for (const d of days) byDay.set(d.day, d);
  const data = [...byDay.values()].sort((a, b) => a.day - b.day).slice(-14);
  const maxV = Math.max(100, ...data.map((d) => Math.max(sumIncome(d), sumExpense(d))));
  const lines = data.flatMap((d) => [d.cashEnd, -(d.debtEnd ?? 0)]);
  const cMin = Math.min(0, ...lines);
  const cMax = Math.max(100, ...lines);
  const bw = (W - pad * 2) / Math.max(1, data.length);
  const y = (v: number) => H - pad - (v / maxV) * (H - pad * 2);
  const yc = (v: number) => H - pad - ((v - cMin) / (cMax - cMin || 1)) * (H - pad * 2);
  const path = (f: (d: DayFinance) => number) => data.map((d, i) => `${i ? 'L' : 'M'}${pad + bw * (i + 0.5)},${yc(f(d))}`).join(' ');
  const hasDebt = data.some((d) => (d.debtEnd ?? 0) > 0);
  return (
    <svg class="chart" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <line x1={pad} x2={W - pad} y1={H - pad} y2={H - pad} stroke="var(--line)" />
      {cMin < 0 && <line x1={pad} x2={W - pad} y1={yc(0)} y2={yc(0)} stroke="#d9d3c6" stroke-dasharray="3 3" />}
      {data.map((d, i) => {
        const x = pad + bw * i;
        const inc = sumIncome(d);
        const exp = sumExpense(d);
        return (
          <g key={d.day}>
            <rect x={x + bw * 0.12} y={y(inc)} width={bw * 0.36} height={H - pad - y(inc)} rx="2" fill="#9fc0ff">
              <title>
                Jour {d.day} : revenus {fmtMoney(inc)}
              </title>
            </rect>
            <rect x={x + bw * 0.52} y={y(exp)} width={bw * 0.36} height={H - pad - y(exp)} rx="2" fill="#f2c4b2">
              <title>
                Jour {d.day} : dépenses {fmtMoney(exp)}
              </title>
            </rect>
            <text x={x + bw / 2} y={H - 10} text-anchor="middle" font-size="10" fill="var(--muted)">
              J{d.day}
            </text>
          </g>
        );
      })}
      <path d={path((d) => d.cashEnd)} fill="none" stroke="#1f2430" stroke-width="2.4" stroke-linejoin="round" />
      {hasDebt && <path d={path((d) => -(d.debtEnd ?? 0))} fill="none" stroke="#e5484d" stroke-width="2.2" stroke-dasharray="5 4" stroke-linejoin="round" />}
      {data.map((d, i) => (
        <circle key={i} cx={pad + bw * (i + 0.5)} cy={yc(d.cashEnd)} r="3" fill="#1f2430">
          <title>
            Fin du jour {d.day} : trésorerie {fmtMoney(d.cashEnd)}
            {d.debtEnd ? ` · dette ${fmtMoney(d.debtEnd)}` : ''}
          </title>
        </circle>
      ))}
    </svg>
  );
}

function Accounts() {
  const game = useGame();
  const s = game.state;
  const days = s.finance.days;
  const charges = dailyCharges(s);
  const last7 = days.slice(-7);
  const inc: Partial<Record<IncomeCat, number>> = {};
  const exp: Partial<Record<ExpenseCat, number>> = {};
  for (const d of last7) {
    for (const [k, v] of Object.entries(d.income)) inc[k as IncomeCat] = (inc[k as IncomeCat] ?? 0) + (v ?? 0);
    for (const [k, v] of Object.entries(d.expense)) exp[k as ExpenseCat] = (exp[k as ExpenseCat] ?? 0) + (v ?? 0);
  }
  const farmInc = Object.entries(inc).filter(([k]) => !FINANCING_IN.includes(k as IncomeCat));
  const farmExp = Object.entries(exp).filter(([k]) => !FINANCING_OUT.includes(k as ExpenseCat));
  const incT = farmInc.reduce((a, [, v]) => a + (v ?? 0), 0);
  const expT = farmExp.reduce((a, [, v]) => a + (v ?? 0), 0);
  const opT = OPERATING.reduce((a, k) => a + (exp[k] ?? 0), 0);
  const borrowed = inc.emprunt ?? 0;
  const repaid = exp.capital ?? 0;
  const chartDays = new Set(days.map((d) => d.day)).size;
  return (
    <>
      <section class="bk-card">
        <div class="bk-title">
          <h5>Les 14 derniers jours</h5>
          <div class="legend">
            <span>
              <i style={{ background: '#9fc0ff' }} /> Revenus
            </span>
            <span>
              <i style={{ background: '#f2c4b2' }} /> Dépenses
            </span>
            <span>
              <i style={{ background: '#1f2430' }} /> Trésorerie
            </span>
            {s.loans.length > 0 && (
              <span>
                <i class="dash" /> Dette
              </span>
            )}
          </div>
        </div>
        {chartDays > 1 ? <Chart days={days} /> : <p class="bk-empty">Le graphique se remplit jour après jour : revenez demain pour voir l’évolution de votre trésorerie.</p>}
      </section>

      <div class="bk-grid">
        <section class="bk-card">
          <h5>Revenus · 7 jours</h5>
          {farmInc.length === 0 && <p class="bk-empty">Aucune vente cette semaine.</p>}
          {farmInc.map(([k, v]) => (
            <div class="kv" key={k}>
              <span>{INCOME_LABELS[k as IncomeCat]}</span>
              <b class="pos">{fmtMoney(v ?? 0)}</b>
            </div>
          ))}
          <div class="kv total">
            <span>Total</span>
            <b class="pos">{fmtMoney(incT)}</b>
          </div>
        </section>
        <section class="bk-card">
          <h5>Dépenses · 7 jours</h5>
          {farmExp.length === 0 && <p class="bk-empty">Aucune dépense cette semaine.</p>}
          {farmExp.map(([k, v]) => (
            <div class="kv" key={k}>
              <span>
                {EXPENSE_LABELS[k as ExpenseCat]} {!OPERATING.includes(k as ExpenseCat) && <Chip>investissement</Chip>}
              </span>
              <b class="neg">{fmtMoney(v ?? 0)}</b>
            </div>
          ))}
          {opT !== expT && (
            <div class="kv sub">
              <span>dont fonctionnement</span>
              <b>{fmtMoney(opT)}</b>
            </div>
          )}
          <div class="kv total">
            <span>Total</span>
            <b class="neg">{fmtMoney(expT)}</b>
          </div>
        </section>
      </div>

      {(borrowed > 0 || repaid > 0) && (
        <section class="bk-card fin">
          <h5>Financement · 7 jours</h5>
          <div class="kv">
            <span>Prêts reçus</span>
            <b class="pos">{fmtMoney(borrowed)}</b>
          </div>
          <div class="kv">
            <span>Capital remboursé</span>
            <b class="neg">{fmtMoney(repaid)}</b>
          </div>
          <small class="muted">Emprunter n’est pas gagner : ces sommes n’entrent pas dans le résultat de la ferme. Seuls les intérêts sont une charge.</small>
        </section>
      )}

      <div class="bk-grid">
        <section class="bk-card">
          <h5>Prélevé cette nuit, à minuit</h5>
          <div class="kv">
            <span>Entretien des installations</span>
            <b>{fmtMoney(charges.upkeep)}</b>
          </div>
          <div class="kv">
            <span>Taxe foncière ({s.parcels.length} parcelle{s.parcels.length > 1 ? 's' : ''})</span>
            <b>{fmtMoney(charges.land)}</b>
          </div>
          <div class="kv">
            <span>Salaires</span>
            <b>{fmtMoney(charges.wages)}</b>
          </div>
          {charges.loans > 0 && (
            <div class="kv">
              <span>Échéances de prêts</span>
              <b>{fmtMoney(charges.loans)}</b>
            </div>
          )}
          <div class="kv total">
            <span>Total</span>
            <b>{fmtMoney(charges.total)}</b>
          </div>
          {s.money < charges.total * 2 && (
            <p class="hint warn">
              Trésorerie basse : vendez des œufs, reportez vos investissements ou{' '}
              <button
                class="link"
                onClick={() => {
                  game.panelTab = 'loan';
                  game.changed();
                }}
              >
                empruntez
              </button>
              .
            </p>
          )}
        </section>
        <section class="bk-card">
          <h5>Journal</h5>
          <div class="journal full">
            {s.finance.log.length === 0 && <p class="bk-empty">Aucune opération pour l’instant.</p>}
            {s.finance.log.slice(0, 14).map((l, i) => (
              <div class="jl" key={i}>
                <span class="jd">J{l.day}</span>
                <span class="jt">{l.label}</span>
                <span class={l.amount >= 0 ? 'pos' : 'neg'}>{fmtSigned(l.amount)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <div class="kpis small bk-kpis">
        <Stat label="Chiffre d’affaires cumulé" value={fmtMoney(s.stats.salesRevenue)} />
        <Stat label="Résultat cumulé" value={fmtSigned(s.stats.totalIncome - s.stats.totalExpense)} />
        <Stat label="Œufs vendus" value={s.stats.eggsSold} />
        <Stat label="Œufs perdus / périmés" value={`${s.stats.eggsLost} / ${s.stats.eggsSpoiled}`} />
      </div>
    </>
  );
}

// ------------------------------------------------------------ Prêt express ----
const DURATION_LABEL: Record<Duration, string> = { 7: '7 jours', 14: '14 jours', 28: '28 jours' };
const DURATION_SUB: Record<Duration, string> = { 7: 'une saison', 14: 'deux saisons', 28: 'une année' };

function LoanDesk() {
  const game = useGame();
  const s = game.state;
  const limit = creditLimit(s);
  const [want, setWant] = useState(() => Math.min(limit, Math.max(BANK.minLoan, Math.round((limit * 0.5) / BANK.step) * BANK.step)));
  const [days, setDays] = useState<Duration>(14);
  const amount = Math.max(BANK.minLoan, Math.min(limit, want));
  const q = quoteLoan(s, amount, days);
  const full = s.loans.length >= BANK.maxLoans;
  // pas des boutons − / + : environ un vingtième du plafond, arrondi
  const nudge = Math.max(BANK.step, Math.round(limit / 20 / BANK.step) * BANK.step);
  const presets = [BANK.minLoan, Math.round((limit * 0.25) / BANK.step) * BANK.step, Math.round((limit * 0.5) / BANK.step) * BANK.step, limit].filter((v, i, a) => v >= BANK.minLoan && a.indexOf(v) === i);
  return (
    <div class="loan-desk">
      <section class="loan-form">
        <div class="lf-head">
          <div>
            <b>Prêt express</b>
            <span>L’argent est versé tout de suite sur votre compte.</span>
          </div>
          <div class="lf-limit">
            <small>Vous pouvez emprunter jusqu’à</small>
            <b>{fmtMoney(limit)}</b>
          </div>
        </div>

        <label class="lf-label">Montant</label>
        <div class="lf-amount-row">
          <button class="lf-step" aria-label="Diminuer le montant" disabled={amount <= BANK.minLoan} onClick={() => setWant(Math.max(BANK.minLoan, amount - nudge))}>
            −
          </button>
          <div class="lf-amount">{fmtMoney(amount)}</div>
          <button class="lf-step" aria-label="Augmenter le montant" disabled={amount >= limit} onClick={() => setWant(Math.min(limit, amount + nudge))}>
            +
          </button>
        </div>
        <input
          class="lf-range"
          type="range"
          min={BANK.minLoan}
          max={Math.max(limit, BANK.minLoan + 1)}
          step={BANK.step}
          value={amount}
          disabled={limit <= BANK.minLoan}
          style={{ '--fill': `${limit > BANK.minLoan ? ((amount - BANK.minLoan) / (limit - BANK.minLoan)) * 100 : 100}%` } as never}
          onInput={(e) => setWant(Number((e.target as HTMLInputElement).value))}
        />
        <div class="lf-presets" style={{ '--n': presets.length } as never}>
          {presets.map((v) => (
            <button key={v} class={v === amount ? 'on' : ''} onClick={() => setWant(v)}>
              {v === limit ? 'Maximum' : fmtMoney(v)}
            </button>
          ))}
        </div>

        <label class="lf-label">Durée de remboursement</label>
        <div class="lf-durations">
          {BANK.durations.map((d) => {
            const r = quoteLoan(s, amount, d);
            return (
              <button key={d} class={d === days ? 'on' : ''} onClick={() => setDays(d)}>
                <b>{DURATION_LABEL[d]}</b>
                <small>{DURATION_SUB[d]}</small>
                <em>{fmtMoney(r.daily)} / jour</em>
              </button>
            );
          })}
        </div>

        <div class="lf-rate">
          <div>
            <span>Taux annuel</span>
            <b>{pct(q.rate)}</b>
          </div>
          <ul>
            {q.parts.map((p) => (
              <li key={p.label}>
                {p.label} <b>+{pct(p.rate)}</b>
              </li>
            ))}
          </ul>
          <small>Le taux du moment change à chaque saison ({season(s).name.toLowerCase()} en ce moment) ; il est fixé à la signature. Une année de jeu = 28 jours.</small>
        </div>

        <div class="lf-summary">
          <div>
            <span>Vous recevez</span>
            <b class="pos">{fmtMoney(amount)}</b>
          </div>
          <div>
            <span>Échéance chaque nuit</span>
            <b>{fmtMoney(q.daily)}</b>
            <small>pendant {days} jours</small>
          </div>
          <div>
            <span>Total remboursé</span>
            <b>{fmtMoney(q.daily * days)}</b>
            <small>coût du crédit {fmtMoney(q.daily * days - amount)}</small>
          </div>
        </div>

        <Btn kind="primary" block disabled={full} onClick={() => game.act(() => takeLoan(s, amount, days), 'coin')}>
          {full ? `${BANK.maxLoans} prêts en cours : remboursez-en un d’abord` : `Emprunter ${fmtMoney(amount)}`}
        </Btn>
        <p class="lf-note">
          Échéances prélevées chaque nuit, même à découvert. Une pause de 3 ou 7 jours est possible une fois par prêt (les intérêts courent). Remboursement anticipé sans frais.
        </p>
      </section>

      <section class="loan-list">
        <h5>Mes prêts en cours</h5>
        {s.loans.length === 0 ? (
          <p class="hint">Aucun prêt en cours.</p>
        ) : (
          s.loans.map((l) => {
            const left = l.capitalLeft + l.interestLeft;
            const paused = isPaused(s, l);
            return (
              <div class={`loan ${paused ? 'paused' : ''}`} key={l.id}>
                <div class="loan-head">
                  <b>{fmtMoney(l.principal)}</b>
                  <span>
                    sur {l.days} jours · {pct(l.rate)} · signé le jour {l.day}
                  </span>
                  {paused && <Chip tone="warn">En pause jusqu’au jour {l.pausedUntil}</Chip>}
                </div>
                <Bar value={l.paid} max={l.days} tone="blue" thin />
                <div class="loan-meta">
                  <span>
                    Échéance <b>{fmtMoney(l.daily)}</b> / nuit · {l.paid}/{l.days} payées
                  </span>
                  <span>
                    Reste <b>{fmtMoney(left)}</b>
                  </span>
                </div>
                <div class="loan-actions">
                  {!l.paused &&
                    BANK.pauses.map((d) => (
                      <Btn key={d} small kind="ghost" title={`Aucune échéance pendant ${d} jours ; les intérêts courent (+${fmtMoney(pauseCost(l, d))}), répartis ensuite sur les échéances restantes`} onClick={() => game.act(() => pauseLoan(s, l.id, d))}>
                        <Icon name="pauseCircle" size={14} /> Pause {d} j<em>+{fmtMoney(pauseCost(l, d))}</em>
                      </Btn>
                    ))}
                  <Btn small kind="soft" disabled={s.money < l.capitalLeft} title={s.money < l.capitalLeft ? `Il faut ${fmtMoney(l.capitalLeft)} sur le compte` : `Économise ${fmtMoney(l.interestLeft)} d’intérêts`} onClick={() => game.act(() => repayLoan(s, l.id), 'coin')}>
                    Tout rembourser<em>{fmtMoney(l.capitalLeft)}</em>
                  </Btn>
                </div>
                {!l.paused && <small class="loan-tip">Passe difficile ? Une pause d’échéances est possible une fois par prêt.</small>}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
