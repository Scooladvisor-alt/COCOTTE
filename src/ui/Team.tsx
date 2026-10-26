import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import { ROLES, ROLE_ORDER, STAFF } from '../config/staff';
import { buyLevel, fmtMoney } from '../sim/economy';
import { JOB_LABELS, basketCount, checkHire, dailyWages, fire, hire, startLabel, workersOf } from '../sim/workers';
import type { Worker } from '../sim/types';
import { RoleIcon, Btn, Chip, Stat, useGame } from './common';

function Wrap({ embedded, children }: { embedded: boolean; children: ComponentChildren }) {
  return embedded ? <>{children}</> : <div class="panel-body">{children}</div>;
}

export function workerStatus(w: Worker) {
  if (!w.onSite) return { label: `À la maison · revient à ${startLabel(w.role)}`, tone: 'neutral' };
  if (!w.job) return { label: 'Choisit sa prochaine tâche', tone: 'neutral' };
  const base = JOB_LABELS[w.job.kind];
  if (w.job.kind === 'commuteIn' || w.job.kind === 'commuteOut') return { label: base, tone: 'neutral' };
  if (w.job.kind === 'hunt') return { label: w.job.phase === 'work' ? 'En joue : il tire sur le prédateur !' : 'Court vers le prédateur, fusil en main', tone: 'bad' };
  return { label: w.job.phase === 'walk' && w.job.kind !== 'wander' ? `En route : ${base.toLowerCase()}` : base, tone: w.job.kind === 'wander' ? 'neutral' : 'good' };
}

export function workerStats(w: Worker, which: 'today' | 'total') {
  const t = w[which];
  const parts: string[] = [];
  if (w.role === 'farmhand') {
    parts.push(`${t.eggs} œufs ramassés`);
    if (t.refills) parts.push(`${t.refills} remplissages`);
    if (t.cleans) parts.push(`${t.cleans} nettoyages`);
  }
  if (w.role === 'caretaker') parts.push(`${t.heals} soins`);
  if (w.role === 'gardener') parts.push(`${t.waterings} arrosages`);
  if (w.role === 'seller') parts.push('Comptoir de l’étal');
  if (t.kills) parts.push(`${t.kills} prédateur${t.kills > 1 ? 's' : ''} abattu${t.kills > 1 ? 's' : ''}`);
  return parts.join(' · ');
}

export function TeamPanel({ embedded = false }: { embedded?: boolean }) {
  const game = useGame();
  const s = game.state;
  const level = buyLevel(s);
  const [confirm, setConfirm] = useState(-1);
  const today = s.workers.reduce(
    (a, w) => ({ eggs: a.eggs + w.today.eggs, refills: a.refills + w.today.refills, heals: a.heals + w.today.heals, waterings: a.waterings + w.today.waterings }),
    { eggs: 0, refills: 0, heals: 0, waterings: 0 },
  );
  return (
    <Wrap embedded={embedded}>
      <div class="kpis">
        <Stat label="Salariés" value={s.workers.length} sub={`${s.workers.filter((w) => w.onSite).length} sur place`} />
        <Stat label="Salaires" value={`${fmtMoney(dailyWages(s))}/j`} sub="prélevés à minuit" />
        <Stat label="Œufs ramassés aujourd’hui" value={today.eggs} sub={`${today.refills} remplissages`} />
        <Stat label="Soins / arrosages" value={`${today.heals} / ${today.waterings}`} sub="aujourd’hui" />
      </div>
      <h5>Votre équipe</h5>
      {s.workers.length === 0 && <p class="empty">Personne n’est encore embauché. Les salariés travaillent de {STAFF.startHour} h à {STAFF.endHour} h et rentrent dormir à la maison.</p>}
      <div class="team">
        {s.workers.map((w) => {
          const def = ROLES[w.role];
          const st = workerStatus(w);
          const carried = basketCount(w);
          return (
            <div class="member" key={w.id}>
              <div class="m-av" style={{ background: '#' + def.outfit.shirt.toString(16).padStart(6, '0') }}>
                <RoleIcon role={w.role} size={18} />
              </div>
              <div class="m-info">
                <b>
                  {w.name} <small>· {def.title}</small>
                </b>
                <span>
                  <Chip tone={st.tone}>{st.label}</Chip>
                  {carried > 0 && <Chip tone="blue">{carried} œufs</Chip>}
                </span>
                <small>Aujourd’hui : {workerStats(w, 'today')}</small>
              </div>
              <div class="m-side">
                <b>{fmtMoney(def.wage)}/j</b>
                <div class="row-btns">
                  <Btn
                    small
                    kind="soft"
                    disabled={!w.onSite}
                    onClick={() => {
                      game.select({ kind: 'worker', id: w.id });
                      game.follow = true;
                      game.renderer.setZoom(Math.max(game.renderer.zoom, 2));
                      game.openPanel(null);
                    }}
                  >
                    Voir
                  </Btn>
                  {confirm === w.id ? (
                    <Btn small kind="danger" onClick={() => (setConfirm(-1), game.act(() => fire(s, w.id)))}>
                      Confirmer
                    </Btn>
                  ) : (
                    <Btn small kind="ghost" onClick={() => setConfirm(w.id)}>
                      Licencier
                    </Btn>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <RestockToggle />
      <h5>Recruter</h5>
      <div class="cards">
        {ROLE_ORDER.map((role) => {
          const def = ROLES[role];
          const chk = checkHire(s, role);
          const locked = level < def.reqLevel;
          const n = workersOf(s, role).length;
          return (
            <div class={`pcard ${locked ? 'locked' : ''}`} key={role}>
              <div class="pcard-top">
                <div class="b-icon" style={{ background: '#' + def.outfit.shirt.toString(16).padStart(6, '0') + '33' }}>
                  <RoleIcon role={role} size={20} />
                </div>
                <div>
                  <h4>{def.title}</h4>
                  <small class="pc-sub">
                    {fmtMoney(def.wage)} / jour · {n}/{def.max(level)} embauché{n > 1 ? 's' : ''}
                  </small>
                </div>
              </div>
              <ul class="boosts compact">
                {def.boosts.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <Btn kind="primary" block disabled={!chk.ok} title={chk.reason} onClick={() => game.act(() => hire(s, role), 'buy')}>
                {locked ? `Niveau ${def.reqLevel}` : chk.ok ? 'Embaucher' : chk.reason}
              </Btn>
            </div>
          );
        })}
      </div>
    </Wrap>
  );
}

/** Autorise le commis à commander lui-même l'eau et le grain. */
export function RestockToggle() {
  const game = useGame();
  const s = game.state;
  return (
    <label class="toggle restock">
      <input
        type="checkbox"
        checked={s.settings.staffRestock}
        onChange={(e) => {
          s.settings.staffRestock = (e.target as HTMLInputElement).checked;
          game.changed();
        }}
      />
      <span>
        <b>Le commis commande l’eau et le grain</b>
        <small>Quand la cuve passe sous 25 % ou que la réserve de grain tient moins d’un jour et demi.</small>
      </span>
    </label>
  );
}
