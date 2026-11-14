import { useMemo } from "react";
import { analyzePurchase, maxTermYears, pmt, schedule, type Affordability, type Profile } from "../../shared/finance.ts";
import { eur, pct } from "../lib.ts";
import { LineChart, Num, Stat, VerdictBadge } from "../ui.tsx";

interface Props {
  profile: Profile;
  update: (p: Partial<Profile>) => void;
  price: number;
  setPrice: (n: number) => void;
  budget: Affordability;
}

export function Simulador({ profile, update, price, setPrice, budget }: Props) {
  const a = useMemo(() => analyzePurchase(profile, price), [profile, price]);
  const s = useMemo(() => schedule(a.loan, [{ years: profile.years, ratePct: profile.ratePct }]), [a.loan, profile.years, profile.ratePct]);
  const sliderMax = Math.max(600_000, Math.ceil((budget.maxPrice * 1.6) / 50_000) * 50_000);
  const maxYears = maxTermYears(profile.age);
  const terms = [...new Set([20, 25, 30, maxYears, profile.years])].filter((y) => y <= Math.max(maxYears, profile.years)).sort((x, y) => x - y);
  const parts = [
    { label: `Entrada (${100 - a.ltvPct} %)`, value: a.downPayment, cls: "c1" },
    { label: `Impuestos · ${a.tax.label}`, value: a.tax.amount, cls: "c2" },
    { label: `Notaría, registro, gestoría y tasación (${profile.otherCostsPct} %)`, value: a.otherCosts, cls: "c3" },
  ];

  return (
    <div className="stack">
      <section className="panel">
        <div className="price-head">
          <div>
            <h2>¿Cuánto cuesta la vivienda?</h2>
            <p className="muted">Mueve el precio y mira al instante si te la puedes permitir.</p>
          </div>
          <div className="price-input">
            <Num value={price} onChange={setPrice} suffix="€" step={5000} min={10000} max={5_000_000} />
            <button className="ghost" onClick={() => setPrice(budget.maxPrice)} title="Usar mi precio máximo">
              Mi máximo
            </button>
          </div>
        </div>
        <input
          className="slider"
          type="range"
          min={50_000}
          max={sliderMax}
          step={1000}
          value={Math.min(price, sliderMax)}
          onChange={(e) => setPrice(Number(e.target.value))}
          aria-label="Precio de la vivienda"
        />
        <div className={`verdict verdict-${a.verdict}`}>
          <VerdictBadge verdict={a.verdict} />
          <ul>
            {a.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="grid4">
        <Stat
          label="Cuota mensual"
          value={`${eur(a.payment)}/mes`}
          sub={`Máximo recomendado ${eur(a.maxPayment)}`}
          tone={a.payment <= a.maxPayment ? "good" : "bad"}
        />
        <Stat
          label="Ahorros necesarios"
          value={eur(a.cashNeeded)}
          sub={a.savingsGap > 0 ? `Te faltan ${eur(a.savingsGap)}` : `Te sobran ${eur(a.savingsLeft)}`}
          tone={a.savingsGap > 0 ? "bad" : "good"}
        />
        <Stat label="Hipoteca" value={eur(a.loan)} sub={`${a.ltvPct} % al ${pct(a.ratePct)} a ${a.years} años`} />
        <Stat
          label="Esfuerzo sobre ingresos"
          value={pct(a.effortPct, 0)}
          sub={`Límite ${profile.debtRatioPct} %`}
          tone={a.effortPct <= profile.debtRatioPct ? "good" : a.effortPct <= profile.debtRatioPct + 5 ? "warn" : "bad"}
        />
      </section>

      <section className="panel">
        <h2>Dinero que necesitas el día de la firma</h2>
        <div className="bar">
          {parts.map((p) => (
            <span key={p.label} className={p.cls} style={{ width: `${(p.value / a.cashNeeded) * 100}%` }} title={`${p.label}: ${eur(p.value)}`} />
          ))}
        </div>
        <table className="breakdown">
          <tbody>
            {parts.map((p) => (
              <tr key={p.label}>
                <td>
                  <i className={p.cls} />
                  {p.label}
                </td>
                <td>{eur(p.value)}</td>
              </tr>
            ))}
            <tr className="total">
              <td>Total a aportar</td>
              <td>{eur(a.cashNeeded)}</td>
            </tr>
            <tr>
              <td>Tus ahorros</td>
              <td>{eur(profile.savings)}</td>
            </tr>
          </tbody>
        </table>
        {a.tax.note && (
          <p className={`note ${a.tax.reduced ? "warn" : ""}`}>
            {a.tax.reduced && <b>Tipo reducido aplicado. </b>}
            {a.tax.note} Confírmalo antes de contar con ello.
          </p>
        )}
        {a.savingsGap > 0 && (
          <p className="note">
            Para cubrir los {eur(a.savingsGap)} que faltan con un préstamo personal al {pct(profile.personalLoanRatePct, 1)} a {profile.personalLoanYears}{" "}
            años pagarías <b>{eur(a.personalLoanPayment)}/mes</b> más: en total {eur(a.totalMonthly)}/mes frente a tu máximo de {eur(a.maxPayment)}.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>La cuota según el plazo</h2>
        <div className="terms">
          {terms.map((y) => {
            const cuota = pmt(a.loan, profile.ratePct, y);
            const interest = cuota * y * 12 - a.loan;
            return (
              <button key={y} className={`term ${y === profile.years ? "on" : ""}`} onClick={() => update({ years: y })} disabled={y > 40}>
                <span className="term-years">{y} años</span>
                <span className="term-cuota">{eur(cuota)}/mes</span>
                <span className="muted">{eur(interest)} de intereses</span>
                {y > maxYears && <span className="muted">Supera el máximo por edad</span>}
              </button>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <h2>Cómo se va pagando</h2>
        <p className="muted">
          En {profile.years} años pagarás {eur(s.totalPaid)}: {eur(a.loan)} de capital y <b>{eur(s.totalInterest)} de intereses</b>.
        </p>
        <LineChart
          format={eur}
          series={[
            { name: "Deuda pendiente", color: "var(--accent)", values: s.rows.map((r) => r.balance) },
            { name: "Intereses pagados (acumulado)", color: "var(--series-2)", values: s.rows.reduce<number[]>((acc, r) => [...acc, (acc.at(-1) ?? 0) + r.interest], []) },
          ]}
        />
      </section>
    </div>
  );
}
