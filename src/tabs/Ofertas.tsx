import { useMemo, useState } from "react";
import type { Profile } from "../../shared/finance.ts";
import { OFFER_TYPES, compareOffers, offerDefaults, type Bonus, type OfferType, type ReceivedOffer } from "../../shared/offers.ts";
import { RATES, eur, pct, type OffersStore } from "../lib.ts";
import { Field, Num, Segmented } from "../ui.tsx";

type Draft = Omit<ReceivedOffer, "id"> & { id?: string };

const EMPTY: Draft = { bank: "", type: "fija", tinPct: 2.5, bonuses: [] };
const BONUS_SUGGESTIONS = ["Nómina", "Seguro de vida", "Seguro de hogar", "Tarjeta de crédito", "Plan de pensiones", "Alarma"];

const pts = (n: number) => `${n.toLocaleString("es-ES", { maximumFractionDigits: 2 })} pts`;

interface Props {
  profile: Profile;
  store: OffersStore;
  onAskBroker: (text: string) => void;
}

/** Ofertas que te han dado los bancos: cuál sale más barata de verdad y qué vinculaciones no compensan. */
export function Ofertas({ profile, store, onAskBroker }: Props) {
  const { offers, save, remove } = store;
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const defaults = offerDefaults(profile);
  const euribor = RATES.euribor.monthlyAvg;
  const ranked = useMemo(() => compareOffers(offers, defaults, euribor), [offers, defaults.loan, defaults.years, euribor]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const setBonus = (i: number, patch: Partial<Bonus>) => set({ bonuses: draft!.bonuses.map((b, j) => (j === i ? { ...b, ...patch } : b)) });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft) return;
    if (!draft.bank.trim()) return setError("Pon el nombre del banco.");
    const clean: Draft = { ...draft, bank: draft.bank.trim(), bonuses: draft.bonuses.filter((b) => b.name.trim()) };
    if (clean.type === "fija") {
      delete clean.fixedYears;
      delete clean.spreadPct;
    }
    if (await save(clean)) {
      setDraft(null);
      setError(null);
    } else setError("No se ha podido guardar: revisa los números.");
  }

  const best = ranked[0];
  const worst = ranked.at(-1);

  return (
    <div className="page stack">
      <div className="results-head">
        <div>
          <h2 className="page-title">Ofertas de bancos</h2>
          <p className="muted">
            Apunta las ofertas que te den los bancos y te digo cuál sale más barata de verdad, contando seguros y comisiones, y qué vinculaciones no te compensan.
          </p>
        </div>
        {!draft && <button onClick={() => setDraft({ ...EMPTY })}>+ Añadir oferta</button>}
      </div>

      {draft && (
        <form className="panel offer-form" onSubmit={submit}>
          <h2>{draft.id ? `Editar oferta de ${draft.bank}` : "Nueva oferta"}</h2>
          <div className="search-row">
            <Field label="Banco">
              <input type="text" value={draft.bank} onChange={(e) => set({ bank: e.target.value })} placeholder="Santander, ING, Caixa…" autoFocus />
            </Field>
            <Field label="Tipo">
              <Segmented<OfferType> value={draft.type} onChange={(type) => set({ type })} options={OFFER_TYPES.map((t) => [t, t[0].toUpperCase() + t.slice(1)])} />
            </Field>
            <Field label={draft.type === "fija" ? "TIN bonificado" : "TIN del tramo inicial"} hint="Con todas las bonificaciones">
              <Num value={draft.tinPct} onChange={(tinPct) => set({ tinPct })} suffix="%" step={0.05} max={15} />
            </Field>
            {draft.type !== "fija" && (
              <>
                <Field label={draft.type === "mixta" ? "Años a tipo fijo" : "Años antes del euríbor"}>
                  <Num value={draft.fixedYears ?? (draft.type === "mixta" ? 10 : 1)} onChange={(fixedYears) => set({ fixedYears })} suffix="años" max={40} />
                </Field>
                <Field label="Diferencial" hint={`Sobre el euríbor (hoy ${pct(euribor)})`}>
                  <Num value={draft.spreadPct ?? 0.6} onChange={(spreadPct) => set({ spreadPct })} suffix="%" step={0.05} max={5} />
                </Field>
              </>
            )}
          </div>
          <div className="search-row">
            <Field label="Importe" hint={`Vacío: tu hipoteca máxima (${eur(defaults.loan)})`}>
              <Num value={draft.loan ?? null} onChange={(loan) => set({ loan })} suffix="€" step={5000} min={1000} placeholder="auto" />
            </Field>
            <Field label="Plazo" hint={`Vacío: ${defaults.years} años`}>
              <Num value={draft.years ?? null} onChange={(years) => set({ years })} suffix="años" min={1} max={40} placeholder="auto" />
            </Field>
            <Field label="Comisión de apertura">
              <Num value={draft.openingFee ?? null} onChange={(openingFee) => set({ openingFee })} suffix="€" step={100} placeholder="0" />
            </Field>
            <Field label="Otros gastos del banco" hint="Tasación, gestoría…">
              <Num value={draft.otherCosts ?? null} onChange={(otherCosts) => set({ otherCosts })} suffix="€" step={50} placeholder="0" />
            </Field>
            <Field label="TAE de la oferta" hint="Solo informativa">
              <Num value={draft.taePct ?? null} onChange={(taePct) => set({ taePct })} suffix="%" step={0.05} max={20} placeholder="—" />
            </Field>
          </div>

          <h3>Vinculaciones</h3>
          <p className="muted small">Cada producto que te piden para bajar el tipo: cuánto lo baja y cuánto te cuesta al año (la nómina suele ser gratis).</p>
          <datalist id="bonus-names">
            {BONUS_SUGGESTIONS.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="bonus-rows">
            {draft.bonuses.map((b, i) => (
              <div key={i} className="bonus-row">
                <input type="text" list="bonus-names" value={b.name} onChange={(e) => setBonus(i, { name: e.target.value })} placeholder="Seguro de vida" aria-label="Vinculación" />
                <Num value={b.discountPct} onChange={(discountPct) => setBonus(i, { discountPct })} suffix="pts" step={0.05} max={3} />
                <Num value={b.costPerYear} onChange={(costPerYear) => setBonus(i, { costPerYear })} suffix="€/año" step={25} />
                <button type="button" className="icon" onClick={() => set({ bonuses: draft.bonuses.filter((_, j) => j !== i) })} aria-label="Quitar vinculación">
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="ghost" onClick={() => set({ bonuses: [...draft.bonuses, { name: "", discountPct: 0.1, costPerYear: 0 }] })}>
              + Añadir vinculación
            </button>
          </div>
          {error && <p className="note bad">{error}</p>}
          <div className="row">
            <button type="submit">Guardar oferta</button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      {ranked.length > 1 && best && worst && (
        <div className="verdict">
          <div>
            <strong>Te conviene {best.offer.bank}.</strong> Te sale {eur(worst.bestTotalCost - best.bestTotalCost)} más barata que {worst.offer.bank} en todo el
            plazo{best.keep.length < best.offer.bonuses.length ? `, contratando solo ${best.keep.length ? best.keep.join(", ") : "lo imprescindible"}` : ""}. Enséñasela a los
            demás bancos para negociar.
          </div>
        </div>
      )}

      <div className="offers-list">
        {ranked.map((c, i) => (
          <article key={c.offer.id} className={`panel offer-card${i === 0 && ranked.length > 1 ? " best" : ""}`}>
            <div className="offer-head">
              <div>
                <h3>
                  {i === 0 && ranked.length > 1 && <span className="badge verdict-ok">La mejor</span>} {c.offer.bank}
                </h3>
                <p className="muted small">
                  {c.offer.type[0].toUpperCase() + c.offer.type.slice(1)} al {pct(c.offer.tinPct)}
                  {c.offer.type !== "fija" && ` · ${c.offer.fixedYears ?? 1} años y luego euríbor + ${pct(c.offer.spreadPct ?? 0)}`} · {eur(c.loan)} a {c.years} años
                  {c.offer.taePct != null && ` · TAE declarada ${pct(c.offer.taePct)}`}
                </p>
              </div>
              <div className="row">
                <button className="ghost small-btn" onClick={() => setDraft({ ...c.offer })}>
                  Editar
                </button>
                <button className="link danger" onClick={() => confirm(`¿Borrar la oferta de ${c.offer.bank}?`) && remove(c.offer.id)}>
                  Borrar
                </button>
              </div>
            </div>
            <dl className="mini">
              <div>
                <dt>Cuota</dt>
                <dd>
                  {eur(c.payment)}/mes{c.laterPayment != null && <small className="muted"> → {eur(c.laterPayment)}</small>}
                </dd>
              </div>
              <div>
                <dt>Con lo que pagas por vinculaciones</dt>
                <dd>{eur(c.effectiveMonthly)}/mes</dd>
              </div>
              <div>
                <dt>Coste total eligiendo bien</dt>
                <dd className={i === 0 && ranked.length > 1 ? "good" : undefined}>{eur(c.bestTotalCost)}</dd>
              </div>
              <div>
                <dt>Comisiones y gastos</dt>
                <dd>{eur(c.fees)}</dd>
              </div>
            </dl>
            {c.bonuses.length > 0 && (
              <table className="bonus-table">
                <thead>
                  <tr>
                    <th>Vinculación</th>
                    <th>Rebaja</th>
                    <th>Te ahorra en intereses</th>
                    <th>Te cuesta</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {c.bonuses.map((b, j) => (
                    <tr key={b.name}>
                      <td>{b.name}</td>
                      <td>{pts(c.offer.bonuses[j].discountPct)}</td>
                      <td>{eur(b.interestSaved)}</td>
                      <td>{eur(b.totalCost)}</td>
                      <td className={b.worthIt ? "good" : "bad"}>{b.worthIt ? "✓ Compensa" : "✗ No compensa"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </article>
        ))}
      </div>

      {offers.length === 0 && !draft && (
        <div className="empty-state">
          <span className="empty-icon" aria-hidden>
            %
          </span>
          <h3>Aún no has apuntado ninguna oferta</h3>
          <p className="muted">
            Cuando un banco te dé condiciones (por escrito o en la FEIN), apúntalas aquí. Con Claude también puedes pegar el texto o una captura en el chat.
          </p>
          <div className="row">
            <button onClick={() => setDraft({ ...EMPTY })}>+ Añadir oferta</button>
            <button className="ghost" onClick={() => onAskBroker("Me han dado esta oferta de hipoteca: ")}>
              Pegarla en el chat
            </button>
          </div>
        </div>
      )}
      <p className="muted small">
        Supuestos: euríbor constante en {pct(euribor)} ({RATES.euribor.month}) y vinculaciones con el mismo precio todos los años. El coste total incluye intereses,
        vinculaciones y comisiones durante todo el plazo.
      </p>
    </div>
  );
}
