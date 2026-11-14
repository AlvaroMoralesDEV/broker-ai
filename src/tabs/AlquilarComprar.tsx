import { useMemo } from "react";
import { rentVsBuy, type Profile } from "../../shared/finance.ts";
import { eur, useStored } from "../lib.ts";
import { Field, LineChart, Num, Stat } from "../ui.tsx";

export function AlquilarComprar({ profile, price }: { profile: Profile; price: number }) {
  const [v, setV] = useStored("hs.rent", { rent: 900, rentGrowthPct: 2, homeGrowthPct: 2, investReturnPct: 4, ownerCostsPct: 1, horizonYears: 30 });
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }));
  const r = useMemo(() => rentVsBuy(profile, { ...v, price }), [profile, v, price]);
  const last = r.rows.at(-1);
  const diff = last ? last.buyWealth - last.rentWealth : 0;

  return (
    <div className="stack">
      <section className="panel">
        <h2>¿Sigo de alquiler o compro?</h2>
        <p className="muted">
          Compara tu patrimonio en ambos caminos para la vivienda de {eur(price)} del simulador. Si compras, acumulas el valor de la casa menos la deuda. Si
          alquilas, inviertes el dinero de la entrada ({eur(r.initialCash)}). Cada mes, quien paga menos invierte la diferencia.
        </p>
        <div className="search-row">
          <Field label="Alquiler de una vivienda parecida">
            <Num value={v.rent} onChange={(rent) => set({ rent })} suffix="€/mes" step={25} />
          </Field>
          <Field label="Subida anual del alquiler">
            <Num value={v.rentGrowthPct} onChange={(rentGrowthPct) => set({ rentGrowthPct })} suffix="%" step={0.5} min={-5} max={15} />
          </Field>
          <Field label="Revalorización de la vivienda">
            <Num value={v.homeGrowthPct} onChange={(homeGrowthPct) => set({ homeGrowthPct })} suffix="%/año" step={0.5} min={-5} max={15} />
          </Field>
          <Field label="Rentabilidad de invertir">
            <Num value={v.investReturnPct} onChange={(investReturnPct) => set({ investReturnPct })} suffix="%/año" step={0.5} min={0} max={15} />
          </Field>
          <Field label="Gastos de propietario" hint="IBI, comunidad, seguro, mantenimiento">
            <Num value={v.ownerCostsPct} onChange={(ownerCostsPct) => set({ ownerCostsPct })} suffix="%/año" step={0.1} max={5} />
          </Field>
          <Field label="Horizonte">
            <Num value={v.horizonYears} onChange={(horizonYears) => set({ horizonYears })} suffix="años" min={2} max={40} />
          </Field>
        </div>
      </section>

      <section className="grid4">
        <Stat
          label="Comprar compensa a partir de"
          value={r.breakEvenYear ? `Año ${r.breakEvenYear}` : "Nunca"}
          sub={r.breakEvenYear ? "Si te quedas menos tiempo, mejor alquilar" : `En ${v.horizonYears} años gana el alquiler`}
          tone={r.breakEvenYear && r.breakEvenYear <= 10 ? "good" : "warn"}
        />
        <Stat label={`Patrimonio comprando (año ${v.horizonYears})`} value={eur(last?.buyWealth ?? 0)} />
        <Stat label={`Patrimonio alquilando (año ${v.horizonYears})`} value={eur(last?.rentWealth ?? 0)} />
        <Stat label="Diferencia" value={eur(Math.abs(diff))} sub={diff >= 0 ? "A favor de comprar" : "A favor de alquilar"} tone={diff >= 0 ? "good" : "warn"} />
      </section>

      <section className="panel">
        <h2>Patrimonio año a año</h2>
        <LineChart
          format={eur}
          series={[
            { name: "Comprando", color: "var(--accent)", values: r.rows.map((x) => x.buyWealth) },
            { name: "Alquilando e invirtiendo", color: "var(--series-2)", values: r.rows.map((x) => x.rentWealth) },
          ]}
        />
        <p className="muted small">
          Cuota de la hipoteca: {eur(r.payment)}/mes. No incluye la venta futura (plusvalía, IRPF) ni las deducciones autonómicas; el resultado cambia mucho
          con la revalorización y la rentabilidad que supongas, así que prueba varios escenarios.
        </p>
      </section>
    </div>
  );
}
