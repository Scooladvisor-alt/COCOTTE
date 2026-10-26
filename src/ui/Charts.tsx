// Petits graphiques d'historique (cours de l'œuf, taux de ponte) : courbes jour par jour, barres
// en option sur une échelle secondaire, infobulle par jour et légende avec la dernière valeur.
export interface ChartSeries {
  label: string;
  color: string;
  values: Array<number | null>;
}

interface Props {
  days: number[];
  series: ChartSeries[];
  /** Barres en fond (échelle à part, non graduée). */
  bars?: ChartSeries;
  format: (v: number) => string;
  barFormat?: (v: number) => string;
  /** Bornes minimales de l'axe (l'axe s'élargit si les valeurs dépassent). */
  floor?: number;
  ceil?: number;
  height?: number;
}

const W = 600;
const PAD = { l: 52, r: 14, t: 12, b: 24 };

function niceStep(range: number) {
  const raw = range / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / p;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * p;
}

export function HistoryChart({ days, series, bars, format, barFormat, floor, ceil, height = 160 }: Props) {
  const H = height;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null);
  if (days.length === 0 || all.length === 0) return <p class="hc-empty">Pas encore de données : la courbe se dessine jour après jour.</p>;
  let lo = Math.min(...all, floor ?? Infinity);
  let hi = Math.max(...all, ceil ?? -Infinity);
  if (hi - lo < 1e-6) {
    lo -= 1;
    hi += 1;
  }
  const step = niceStep(hi - lo);
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const n = days.length;
  const x = (i: number) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : (i / (n - 1)) * (W - PAD.l - PAD.r));
  const y = (v: number) => PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(v);
  const barMax = bars ? Math.max(1, ...bars.values.map((v) => v ?? 0)) : 1;
  const bw = Math.max(3, ((W - PAD.l - PAD.r) / Math.max(1, n)) * 0.55);
  const labelEvery = Math.max(1, Math.ceil(n / 7));
  const path = (vals: Array<number | null>) => {
    let d = '';
    let pen = false;
    vals.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  return (
    <div class="hc">
      <svg class="hc-svg" viewBox={`0 0 ${W} ${H}`} role="img">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} class="hc-grid" />
            <text x={PAD.l - 8} y={y(v) + 4} class="hc-y">
              {format(v)}
            </text>
          </g>
        ))}
        {bars &&
          bars.values.map((v, i) =>
            v ? <rect key={i} x={x(i) - bw / 2} y={H - PAD.b - (v / barMax) * (H - PAD.t - PAD.b) * 0.55} width={bw} height={(v / barMax) * (H - PAD.t - PAD.b) * 0.55} rx="2" fill={bars.color} opacity="0.55" /> : null,
          )}
        {days.map((d, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <text key={d} x={x(i)} y={H - 6} class="hc-x">
              J{d}
            </text>
          ) : null,
        )}
        {series.map((s) => (
          <path key={s.label} d={path(s.values)} fill="none" stroke={s.color} stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round" />
        ))}
        {series.map((s) => {
          const i = s.values.length - 1;
          const v = s.values[i];
          return v === null ? null : <circle key={s.label} cx={x(i)} cy={y(v)} r="4" fill="#fff" stroke={s.color} stroke-width="2.4" />;
        })}
        {/* infobulle de chaque jour */}
        {days.map((d, i) => (
          <rect key={`h${d}`} x={x(i) - (W - PAD.l - PAD.r) / Math.max(1, n) / 2} y={PAD.t} width={(W - PAD.l - PAD.r) / Math.max(1, n)} height={H - PAD.t - PAD.b} fill="transparent">
            <title>
              {`Jour ${d}\n` +
                series
                  .filter((s) => s.values[i] !== null)
                  .map((s) => `${s.label} : ${format(s.values[i]!)}`)
                  .join('\n') +
                (bars && bars.values[i] ? `\n${bars.label} : ${(barFormat ?? format)(bars.values[i]!)}` : '')}
            </title>
          </rect>
        ))}
      </svg>
      <div class="hc-legend">
        {series.map((s) => {
          const last = [...s.values].reverse().find((v) => v !== null);
          return (
            <span key={s.label}>
              <i style={{ background: s.color }} />
              {s.label}
              {last != null && <b>{format(last)}</b>}
            </span>
          );
        })}
        {bars && (
          <span>
            <i class="bar" style={{ background: bars.color }} />
            {bars.label}
          </span>
        )}
      </div>
    </div>
  );
}
