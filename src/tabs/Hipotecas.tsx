import { useMemo, useState } from "react";
import { quoteOffer, type Offer, type Profile } from "../../shared/finance.ts";
import { RATES, dateEs, eur, pct } from "../lib.ts";
import { Field, Num, Segmented } from "../ui.tsx";

type Kind = Offer["type"];

export function Hipotecas({ profile, update, price }: { profile: Profile; update: (p: Partial<Profile>) => void; price: number }) {
  const [kind, setKind] = useState<Kind>("fija");
  const [loan, setLoan] = useState(Math.round((price * profile.ltvPct) / 100));
  const [euribor, setEuribor] = useState(RATES.euribor.monthlyAvg);

  const rows = useMemo(
    () =>
      RATES.offers
        .filter((o) => o.type === kind)
        .map((o) => ({ o, q: quoteOffer(o, loan, profile.years, euribor, profile.age) }))
        .sort((a, b) => a.q.totalInterest - b.q.totalInterest),
    [kind, loan, profile.years, profile.age, euribor],
  );

  return (
    <div className="stack">
      <section className="panel">
        <div className="results-head">
          <div>
            <h2>Ofertas de los bancos</h2>
            <p className="muted">
              Datos del {dateEs(RATES.updated)}. Tu cuota está calculada para la hipoteca y el plazo de abajo.
            </p>
          </div>
          <Segmented<Kind> value={kind} onChange={setKind} options={[["fija", "Fijas"], ["variable", "Variables"], ["mixta", "Mixtas"]]} />
        </div>
        <div className="search-row">
          <Field label="Importe de la hipoteca" hint={`${profile.ltvPct} % de ${eur(price)} = ${eur((price * profile.ltvPct) / 100)}`}>
            <Num value={loan} onChange={setLoan} suffix="€" step={5000} min={10000} />
          </Field>
          <Field label="Plazo">
            <Num value={profile.years} onChange={(years) => update({ years })} suffix="años" min={5} max={40} />
          </Field>
          {kind !== "fija" && (
            <Field label="Euríbor para el tramo variable" hint={`Media de ${RATES.euribor.month}: ${pct(RATES.euribor.monthlyAvg, 3)}`}>
              <Num value={euribor} onChange={setEuribor} suffix="%" step={0.1} min={-1} max={10} />
            </Field>
          )}
        </div>
      </section>

      <div className="offers">
        {rows.map(({ o, q }, i) => {
          const active = kind === "fija" && Math.abs(profile.ratePct - o.tinBonif) < 0.001;
          const needsMoreLtv = profile.ltvPct > q.ltvAvailable;
          return (
            <article key={o.id} className={`panel offer ${i === 0 ? "best" : ""}`}>
              <div className="offer-main">
                <div>
                  <h3>
                    {o.bank} <span className="muted">· {o.product}</span>
                  </h3>
                  <p className="muted">
                    {o.channel} · hasta {q.ltvAvailable} % · máx. {o.maxYears} años
                    {q.years < profile.years ? ` (calculado a ${q.years})` : ""}
                    {i === 0 ? " · La que menos intereses paga" : ""}
                  </p>
                </div>
                <div className="offer-rate">
                  <strong>{pct(o.tinBonif)}</strong>
                  <span className="muted">
                    {kind === "fija" ? "TIN bonificado" : `${o.initialYears === 1 ? "primer año" : `${o.initialYears} primeros años`}, luego E + ${pct(o.diffBonif ?? 0)}`}
                  </span>
                </div>
                <div className="offer-rate">
                  <strong>{eur(q.initialPayment)}/mes</strong>
                  <span className="muted">
                    {q.laterPayment != null ? `después ${eur(q.laterPayment)}/mes` : o.tae != null ? `TAE ${pct(o.tae)}` : ""}
                  </span>
                </div>
              </div>
              <dl className="mini">
                <div>
                  <dt>Intereses totales</dt>
                  <dd>{eur(q.totalInterest)}</dd>
                </div>
                <div>
                  <dt>Sin bonificar</dt>
                  <dd>{q.noBonifPayment != null && o.tinNoBonif != null ? `${pct(o.tinNoBonif)} · ${eur(q.noBonifPayment)}/mes` : "No publicado"}</dd>
                </div>
                <div>
                  <dt>Comisión de apertura</dt>
                  <dd>{o.openingFee == null ? "No publicada" : o.openingFee === 0 ? "Sin comisión" : eur(o.openingFee)}</dd>
                </div>
                {kind !== "fija" && o.tae != null && (
                  <div>
                    <dt>TAE</dt>
                    <dd>{pct(o.tae)}</dd>
                  </div>
                )}
              </dl>
              <p className="tags">
                {o.bonificaciones.length === 0 ? <span className="chip good">Sin vinculaciones</span> : o.bonificaciones.map((b) => <span key={b} className="chip">{b}</span>)}
              </p>
              {o.notes && <p className="muted small">{o.notes}</p>}
              {needsMoreLtv && <p className="note warn">Estás simulando un {profile.ltvPct} % de financiación y esta oferta llega al {q.ltvAvailable} %.</p>}
              {kind === "fija" && (
                <button className={active ? "" : "ghost"} onClick={() => update({ ratePct: o.tinBonif })} disabled={active}>
                  {active ? "Tipo en uso en tu simulación" : `Simular con el ${pct(o.tinBonif)}`}
                </button>
              )}
            </article>
          );
        })}
      </div>

      <section className="panel">
        <h2>Euríbor a 12 meses</h2>
        <p>
          Media de {RATES.euribor.month}: <b>{pct(RATES.euribor.monthlyAvg, 3)}</b> · valor diario del {dateEs(RATES.euribor.dailyDate)}:{" "}
          <b>{pct(RATES.euribor.daily, 3)}</b>
        </p>
        <p className="muted small">{RATES.euribor.note}</p>
        <p className="muted small">
          Los tipos que publican los bancos son un punto de partida: la oferta real depende de tu perfil y se puede negociar. ING no publica su TIN
          (precio personalizado), por eso no aparece. Fuentes:{" "}
          {RATES.sources.map((s, i) => (
            <span key={s.url}>
              {i > 0 && " · "}
              <a href={s.url} target="_blank" rel="noreferrer">
                {s.name}
              </a>
            </span>
          ))}
        </p>
      </section>
    </div>
  );
}
