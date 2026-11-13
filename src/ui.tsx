import { useEffect, useState, type ReactNode } from "react";
import type { Verdict } from "../shared/finance.ts";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

interface NumProps {
  value: number | null;
  onChange: (n: number) => void;
  suffix?: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}

/** Campo numérico que deja escribir libremente y solo confirma valores válidos. */
export function Num({ value, onChange, suffix, step = 1, min = 0, max, placeholder }: NumProps) {
  const [text, setText] = useState(value == null ? "" : String(value));
  useEffect(() => {
    if (value == null) setText("");
    else if (Number(text.replace(",", ".")) !== value) setText(String(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <span className="num">
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value.replace(",", "."));
          if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && (max == null || n <= max)) onChange(n);
        }}
        onBlur={() => setText(value == null ? "" : String(value))}
        onKeyDown={(e) => {
          if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
          e.preventDefault();
          const next = Math.round(((value ?? 0) + (e.key === "ArrowUp" ? step : -step)) * 1000) / 1000;
          if (next >= min && (max == null || next <= max)) onChange(next);
        }}
      />
      {suffix && <span className="num-suffix">{suffix}</span>}
    </span>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: ReactNode; tone?: "good" | "warn" | "bad" }) {
  return (
    <div className={`stat ${tone ?? ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

const VERDICT_TEXT: Record<Verdict, string> = { ok: "Encaja", justo: "Justa", no: "Fuera de presupuesto" };

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <span className={`badge verdict-${verdict}`}>{VERDICT_TEXT[verdict]}</span>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="tablist">
      {options.map(([id, label]) => (
        <button key={id} role="tab" aria-selected={value === id} className={value === id ? "on" : ""} onClick={() => onChange(id)}>
          {label}
        </button>
      ))}
    </div>
  );
}

interface Series {
  name: string;
  color: string;
  values: number[];
}

/** Gráfico de líneas sencillo (eje X = años). */
interface ChartProps {
  series: Series[];
  height?: number;
  format: (n: number) => string;
  /** nombre de la unidad del eje X */
  unit?: string;
  /** valor del primer punto (1 para años, 0 para meses) */
  first?: number;
  tickEvery?: number;
}

export function LineChart({ series, height = 220, format, unit = "Año", first = 1, tickEvery = 5 }: ChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const w = 720;
  const pad = { l: 8, r: 8, t: 12, b: 24 };
  const n = Math.max(...series.map((s) => s.values.length));
  if (n < 2) return null;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const x = (i: number) => pad.l + (i / (n - 1)) * (w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - v / max) * (height - pad.t - pad.b);
  const ticks = Array.from({ length: n }, (_, i) => i).filter((i) => (i + first) % tickEvery === 0 || i === 0);
  return (
    <div className="chart">
      <svg
        viewBox={`0 0 ${w} ${height}`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const rel = ((e.clientX - box.left) / box.width) * w;
          setHover(Math.max(0, Math.min(n - 1, Math.round(((rel - pad.l) / (w - pad.l - pad.r)) * (n - 1)))));
        }}
      >
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={w - pad.r} y1={y(max * f)} y2={y(max * f)} className="grid" />
        ))}
        <line x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} className="axis" />
        {ticks.map((i) => (
          <text key={i} x={x(i)} y={height - 6} textAnchor="middle" className="tick">
            {i + first}
          </text>
        ))}
        {series.map((s) => (
          <polyline key={s.name} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
        ))}
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={y(0)} className="cursor" />
            {series.map((s) => s.values[hover] != null && <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r="4" fill={s.color} />)}
          </>
        )}
      </svg>
      <div className="chart-legend">
        <span className="muted">{hover != null ? `${unit} ${hover + first}` : "Pasa el ratón por el gráfico"}</span>
        {series.map((s) => (
          <span key={s.name}>
            <i style={{ background: s.color }} />
            {s.name}
            {hover != null && s.values[hover] != null && <b> {format(s.values[hover])}</b>}
          </span>
        ))}
      </div>
    </div>
  );
}
