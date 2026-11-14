import { useMemo } from "react";
import { savingsPlan, type Profile } from "../../shared/finance.ts";
import { eur, useStored } from "../lib.ts";
import { Field, LineChart, Num, Stat } from "../ui.tsx";

const monthLabel = (monthsFromNow: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsFromNow);
  return d.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
};

const duration = (m: number) => {
  const y = Math.floor(m / 12);
  const rest = m % 12;
  return [y ? `${y} año${y > 1 ? "s" : ""}` : "", rest ? `${rest} mes${rest > 1 ? "es" : ""}` : ""].filter(Boolean).join(" y ");
};

export function PlanAhorro({ profile, price, setPrice }: { profile: Profile; price: number; setPrice: (n: number) => void }) {
  const [v, setV] = useStored("hs.plan", { monthlySaving: 600, savingsReturnPct: 2, priceGrowthPct: 3, months: 36 });
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }));
  const plan = useMemo(() => savingsPlan(profile, { ...v, price }), [profile, v, price]);
  const goal = plan.monthsToGoal;
  const now = plan.rows[0];
  const marks = [0, 6, 12, 18, 24, 36].filter((m) => m <= v.months);

  return (
    <div className="stack">
      <section className="panel">
        <h2>¿Cuándo podré comprar?</h2>
        <p className="muted">
          Indica cuánto ahorras al mes y verás en qué fecha tendrás la entrada, los impuestos y los gastos de la vivienda del simulador, y cómo crece tu
          presupuesto mientras tanto.
        </p>
        <div className="search-row">
          <Field label="Vivienda objetivo">
            <Num value={price} onChange={setPrice} suffix="€" step={5000} min={10000} />
          </Field>
          <Field label="Ahorro mensual">
            <Num value={v.monthlySaving} onChange={(monthlySaving) => set({ monthlySaving })} suffix="€/mes" step={50} />
          </Field>
          <Field label="Rentabilidad de tus ahorros" hint="Cuenta remunerada o depósito">
            <Num value={v.savingsReturnPct} onChange={(savingsReturnPct) => set({ savingsReturnPct })} suffix="%/año" step={0.25} max={15} />
          </Field>
          <Field label="Subida del precio de la vivienda" hint="Mientras ahorras, el piso también sube">
            <Num value={v.priceGrowthPct} onChange={(priceGrowthPct) => set({ priceGrowthPct })} suffix="%/año" step={0.5} min={-10} max={20} />
          </Field>
          <Field label="Horizonte">
            <Num value={v.months} onChange={(months) => set({ months: Math.round(months) })} suffix="meses" min={6} max={120} step={6} />
          </Field>
        </div>
      </section>

      <section className={`panel verdict verdict-${goal === null || !plan.incomeOk ? "no" : goal === 0 ? "ok" : "justo"}`}>
        <h2>
          {goal === 0
            ? "Ya tienes los ahorros necesarios"
            : goal !== null
              ? `Llegas en ${duration(goal)}: ${monthLabel(goal)}`
              : `No llegas en ${duration(v.months)}`}
        </h2>
        <p>
          {goal === 0
            ? `Hoy necesitas ${eur(now.needed)} y tienes ${eur(now.savings)}.`
            : goal !== null
              ? `Para entonces la vivienda costará unos ${eur(plan.rows[goal].price)} y necesitarás ${eur(plan.rows[goal].needed)}; tendrás ${eur(plan.rows[goal].savings)}.`
              : v.priceGrowthPct > 0 && v.monthlySaving > 0
                ? "El precio sube más rápido de lo que ahorras, o el plazo es corto. Prueba a ahorrar más, bajar el precio objetivo o subir la financiación."
                : "Prueba a ahorrar más al mes, bajar el precio objetivo o subir la financiación."}
        </p>
        {!plan.incomeOk && (
          <p>
            <b>Ojo:</b> aunque reúnas los ahorros, la cuota de esta vivienda supera tu endeudamiento máximo. Necesitarías más ingresos, más entrada o un
            precio menor.
          </p>
        )}
      </section>

      <section className="grid4">
        <Stat label="Te falta hoy" value={eur(Math.max(0, now.needed - now.savings))} sub={`Necesitas ${eur(now.needed)}`} tone={now.needed > now.savings ? "warn" : "good"} />
        <Stat label="Ahorras al año" value={eur(v.monthlySaving * 12)} sub={`${((v.monthlySaving / Math.max(1, profile.netIncome)) * 100).toFixed(0)} % de tus ingresos`} />
        <Stat label="La espera encarece el piso" value={`${eur((price * v.priceGrowthPct) / 100)}/año`} sub={`Subida del ${v.priceGrowthPct} % anual`} tone="warn" />
        <Stat label={`Presupuesto en ${duration(v.months)}`} value={eur(plan.rows.at(-1)!.maxPrice)} sub={`Hoy: ${eur(now.maxPrice)}`} tone="good" />
      </section>

      <section className="panel">
        <h2>Tus ahorros frente a lo que necesitas</h2>
        <LineChart
          format={eur}
          unit="Mes"
          first={0}
          tickEvery={6}
          series={[
            { name: "Tus ahorros", color: "var(--accent)", values: plan.rows.map((r) => r.savings) },
            { name: "Entrada + impuestos + gastos", color: "var(--series-2)", values: plan.rows.map((r) => r.needed) },
          ]}
        />
      </section>

      <section className="panel">
        <h2>Qué podrás comprar en cada momento</h2>
        <p className="muted">Precio máximo de vivienda según tus ahorros de ese mes y tus ingresos de hoy.</p>
        <div className="milestones">
          {marks.map((m) => {
            const row = plan.rows[m];
            return (
              <div key={m} className={`milestone ${row.maxPrice >= row.price ? "reached" : ""}`}>
                <span className="muted small">{m === 0 ? "Hoy" : monthLabel(m)}</span>
                <b>{eur(row.maxPrice)}</b>
                <span className="muted small">Ahorros: {eur(row.savings)}</span>
              </div>
            );
          })}
        </div>
        <p className="muted small" style={{ marginTop: 10 }}>
          En verde, los momentos en que tu presupuesto alcanza el precio de la vivienda objetivo (ya revalorizada). Los tipos de interés se suponen
          constantes.
        </p>
      </section>
    </div>
  );
}
