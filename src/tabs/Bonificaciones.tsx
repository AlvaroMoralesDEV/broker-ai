import { useMemo } from "react";
import { bonification, type Profile } from "../../shared/finance.ts";
import { eur, pct, useStored } from "../lib.ts";
import { Field, Num, Stat } from "../ui.tsx";

export function Bonificaciones({ profile, price }: { profile: Profile; price: number }) {
  const [v, setV] = useStored("hs.bonif", {
    loan: Math.round((price * profile.ltvPct) / 100),
    rateNoBonifPct: 3.75,
    discountPct: 1,
    bankProductsPerYear: 900,
    externalProductsPerYear: 400,
  });
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }));
  const r = useMemo(() => bonification({ ...v, years: profile.years }), [v, profile.years]);

  return (
    <div className="stack">
      <section className="panel">
        <h2>¿Compensa bonificar la hipoteca?</h2>
        <p className="muted">
          El banco te baja el tipo si contratas sus seguros y productos. Aquí comparas lo que ahorras en cuota con lo que pagas de más por esos productos
          frente a contratarlos por tu cuenta.
        </p>
        <div className="search-row">
          <Field label="Hipoteca">
            <Num value={v.loan} onChange={(loan) => set({ loan })} suffix="€" step={5000} />
          </Field>
          <Field label="TIN sin bonificar">
            <Num value={v.rateNoBonifPct} onChange={(rateNoBonifPct) => set({ rateNoBonifPct })} suffix="%" step={0.05} max={15} />
          </Field>
          <Field label="Rebaja por bonificar" hint="Suma de todas las vinculaciones">
            <Num value={v.discountPct} onChange={(discountPct) => set({ discountPct })} suffix="pts" step={0.05} max={3} />
          </Field>
          <Field label="Productos con el banco" hint="Seguros de vida y hogar, alarma… al año">
            <Num value={v.bankProductsPerYear} onChange={(bankProductsPerYear) => set({ bankProductsPerYear })} suffix="€/año" step={25} />
          </Field>
          <Field label="Lo mismo por tu cuenta" hint="Seguros equivalentes en otra compañía">
            <Num value={v.externalProductsPerYear} onChange={(externalProductsPerYear) => set({ externalProductsPerYear })} suffix="€/año" step={25} />
          </Field>
        </div>
      </section>

      <section className={`verdict verdict-${r.worthIt ? "ok" : "no"} panel`}>
        <h2>{r.worthIt ? "Sí compensa bonificar" : "No compensa bonificar"}</h2>
        <p>
          {r.worthIt
            ? `Ahorras ${eur(r.netPerYear)} al año (${eur(r.netTotal)} en ${profile.years} años) después de pagar el sobrecoste de los productos del banco.`
            : `Pierdes ${eur(-r.netPerYear)} al año (${eur(-r.netTotal)} en ${profile.years} años): los productos del banco cuestan más de lo que ahorras en cuota.`}
        </p>
      </section>

      <section className="grid4">
        <Stat label={`Cuota sin bonificar (${pct(v.rateNoBonifPct)})`} value={`${eur(r.paymentNoBonif)}/mes`} />
        <Stat label={`Cuota bonificada (${pct(v.rateNoBonifPct - v.discountPct)})`} value={`${eur(r.paymentBonif)}/mes`} />
        <Stat label="Ahorro en cuota" value={`${eur(r.monthlySaving * 12)}/año`} sub={`${eur(r.monthlySaving)} al mes`} tone="good" />
        <Stat label="Sobrecoste de los productos" value={`${eur(r.extraCostPerYear)}/año`} sub="Banco − por tu cuenta" tone={r.extraCostPerYear > 0 ? "warn" : "good"} />
      </section>
      <p className="muted small">
        Truco habitual: muchos seguros solo tienes que mantenerlos el primer año; pregunta al banco cuánto sube el tipo si luego los cambias de
        compañía y repite este cálculo.
      </p>
    </div>
  );
}
