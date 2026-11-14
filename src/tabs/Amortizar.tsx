import { useMemo } from "react";
import { earlyRepayment, type Profile } from "../../shared/finance.ts";
import { eur, pct, useStored } from "../lib.ts";
import { Field, LineChart, Num, Segmented, Stat } from "../ui.tsx";

const duration = (m: number) => {
  const y = Math.floor(m / 12);
  const rest = m % 12;
  return [y ? `${y} año${y > 1 ? "s" : ""}` : "", rest ? `${rest} mes${rest > 1 ? "es" : ""}` : ""].filter(Boolean).join(" y ") || "0 meses";
};

export function Amortizar({ profile, price }: { profile: Profile; price: number }) {
  const loan = Math.round((price * profile.ltvPct) / 100);
  const [v, setV] = useStored("hs.amort", { extraMonthly: 100, lumpSum: 0, lumpYear: 2, mode: "plazo" as "plazo" | "cuota" });
  const set = (patch: Partial<typeof v>) => setV((old) => ({ ...old, ...patch }));
  const input = { loan, ratePct: profile.ratePct, years: profile.years };
  const r = useMemo(() => earlyRepayment({ ...input, ...v }), [loan, profile.ratePct, profile.years, v]); // eslint-disable-line react-hooks/exhaustive-deps
  const other = useMemo(
    () => earlyRepayment({ ...input, ...v, mode: v.mode === "plazo" ? "cuota" : "plazo" }),
    [loan, profile.ratePct, profile.years, v], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const nothing = r.totalExtra === 0;
  // comisión máxima legal en hipotecas fijas: 2 % los 10 primeros años, 1,5 % después
  const feeCap = r.totalExtra * 0.02;

  return (
    <div className="stack">
      <section className="panel">
        <div className="results-head">
          <div>
            <h2>¿Y si amortizo antes de tiempo?</h2>
            <p className="muted">
              Sobre la hipoteca del simulador: {eur(loan)} al {pct(profile.ratePct)} a {profile.years} años ({eur(r.basePayment)}/mes).
            </p>
          </div>
          <Segmented<"plazo" | "cuota"> value={v.mode} onChange={(mode) => set({ mode })} options={[["plazo", "Reducir plazo"], ["cuota", "Reducir cuota"]]} />
        </div>
        <div className="search-row">
          <Field label="Aportación extra cada mes">
            <Num value={v.extraMonthly} onChange={(extraMonthly) => set({ extraMonthly })} suffix="€/mes" step={25} />
          </Field>
          <Field label="Aportación única" hint="Una paga extra, una herencia, un bonus…">
            <Num value={v.lumpSum} onChange={(lumpSum) => set({ lumpSum })} suffix="€" step={1000} />
          </Field>
          <Field label="En qué año la haces">
            <Num value={v.lumpYear} onChange={(lumpYear) => set({ lumpYear: Math.round(lumpYear) })} suffix="º año" min={1} max={profile.years} />
          </Field>
        </div>
      </section>

      {nothing ? (
        <p className="note">Pon una aportación mensual o única para ver cuánto te ahorras.</p>
      ) : (
        <>
          <section className="grid4">
            <Stat label="Intereses que te ahorras" value={eur(r.interestSaved)} sub={`De ${eur(r.baseInterest)} a ${eur(r.interest)}`} tone="good" />
            {v.mode === "plazo" ? (
              <Stat label="Terminas de pagar" value={`${duration(r.monthsSaved)} antes`} sub={`En ${duration(r.months)} en vez de ${profile.years} años`} tone="good" />
            ) : (
              <Stat label="Tu cuota acaba en" value={`${eur(r.finalPayment)}/mes`} sub={`Empieza en ${eur(r.basePayment)}/mes`} tone="good" />
            )}
            <Stat label="Total que aportas de más" value={eur(r.totalExtra)} sub={`Ahorras ${(r.interestSaved / r.totalExtra).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} € por cada euro`} />
            <Stat
              label={v.mode === "plazo" ? "Si redujeras cuota" : "Si redujeras plazo"}
              value={eur(other.interestSaved)}
              sub={v.mode === "plazo" ? "Ahorro menor, pero cuota más baja" : "Ahorro mayor, pero misma cuota"}
            />
          </section>

          <section className="panel">
            <h2>Deuda pendiente</h2>
            <LineChart
              format={eur}
              series={[
                { name: "Amortizando antes", color: "var(--accent)", values: r.balance },
                { name: "Sin amortizar", color: "var(--series-2)", values: r.baseBalance },
              ]}
            />
            <p className="muted small">
              Reducir plazo siempre ahorra más intereses; reducir cuota te da más margen cada mes. En hipotecas fijas el banco puede cobrar comisión por
              amortizar (máximo legal 2 % los 10 primeros años y 1,5 % después, y solo si le causa pérdida): como mucho unos {eur(feeCap)} sobre lo que
              aportas. Algunas ofertas no la cobran; míralo en la pestaña Hipotecas.
            </p>
          </section>
        </>
      )}
    </div>
  );
}
