import { KEY_FACTS, analyzeHome, isLinkOnly, redFlags, type ProfileExtra } from "../shared/broker.ts";
import { affordability, type Profile } from "../shared/finance.ts";
import { ccaaName } from "../shared/taxes.ts";
import { FinanceLinkPanel } from "./FinanceLink.tsx";
import { eur, type HomesStore, type ProfileState } from "./lib.ts";

/** Frase para empezar a contar cada dato que falta. */
const SEED: Record<string, string> = {
  savings: "Tengo ahorrados ",
  netIncome: "Cobro netos por nómina ",
  contractType: "Mi contrato es ",
  monthlyDebts: "No tengo deudas",
  coBuyer: "Compro ",
  ccaa: "Quiero comprar en ",
  targetZones: "Me interesan las zonas de ",
  timeline: "Me gustaría comprar ",
};

function factValue(key: string, p: Profile, e: ProfileExtra): string {
  switch (key) {
    case "savings":
      return eur(p.savings);
    case "netIncome":
      return e.netPay ? `${eur(e.netPay)} × ${e.pagas ?? 12} pagas` : `${eur(p.netIncome)}/mes`;
    case "contractType":
      return e.contractType ?? "";
    case "monthlyDebts":
      return p.monthlyDebts ? `${eur(p.monthlyDebts)}/mes` : "Ninguna";
    case "coBuyer":
      return e.coBuyer ? `Con otra persona${e.coBuyerNetPay ? ` (${eur(e.coBuyerNetPay)} × ${e.coBuyerPagas ?? 12})` : ""}` : "Solo";
    case "ccaa":
      return ccaaName(p.ccaa);
    case "targetZones":
      return e.targetZones?.join(", ") ?? "";
    case "timeline":
      return e.timeline ?? "";
    default:
      return "";
  }
}

/** Panel derecho del chat: tu presupuesto, lo que el bróker sabe de ti y tus viviendas. Se actualiza en vivo. */
export function Situation({
  me,
  homes,
  onAsk,
  onView,
  onProfileChanged,
}: {
  me: ProfileState;
  homes: HomesStore;
  onAsk: (text: string) => void;
  onView: (v: "viviendas" | "calc") => void;
  /** los ahorros cambian al conectar o desconectar Finanzas */
  onProfileChanged: () => void;
}) {
  const { profile, extra, known, missing } = me;
  const budget = affordability(profile);
  const knownCount = known ? KEY_FACTS.length - missing.length : 0;
  const active = homes.homes.filter((h) => h.status !== "descartada");

  return (
    <aside className="context">
      <section className={`panel${known ? " budget-card" : ""}`}>
        <h3 className="eyebrow">Tu presupuesto</h3>
        {known ? (
          <>
            <p className="big">{eur(budget.maxPrice)}</p>
            <p className="muted small">
              Cuota de hasta <strong>{eur(budget.maxPayment)}/mes</strong>
            </p>
            <p className={`limit limit-${budget.limiting}`}>
              {budget.limiting === "ahorros"
                ? `Te limitan los ahorros. Por sueldo llegarías a ${eur(budget.priceByIncome)}.`
                : `Te limita el sueldo. Por ahorros llegarías a ${eur(budget.priceBySavings)}.`}
            </p>
          </>
        ) : (
          <p className="muted">Cuando me digas tus ahorros y tu sueldo, aquí verás cuánto puedes comprar.</p>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3 className="eyebrow">Lo que sé de ti</h3>
          <span className="muted small">
            {knownCount} de {KEY_FACTS.length}
          </span>
        </div>
        <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={KEY_FACTS.length} aria-valuenow={knownCount}>
          <i style={{ width: `${(knownCount / KEY_FACTS.length) * 100}%` }} />
        </div>
        <ul className="facts-list">
          {KEY_FACTS.map((f) =>
            missing.includes(f.key) || !known ? (
              <li key={f.key} className="pending">
                <button onClick={() => onAsk(SEED[f.key] ?? "")} title={f.question}>
                  <span>{f.label}</span>
                  <em>Añadir</em>
                </button>
              </li>
            ) : (
              <li key={f.key}>
                <span>{f.label}</span>
                <strong>{factValue(f.key, profile, extra)}</strong>
              </li>
            ),
          )}
        </ul>
        <button className="link" onClick={() => onView("calc")}>
          Editar a mano
        </button>
      </section>

      <FinanceLinkPanel onChanged={onProfileChanged} />

      <section className="panel">
        <div className="panel-head">
          <h3 className="eyebrow">Tus viviendas</h3>
          {active.length > 0 && (
            <button className="link" onClick={() => onView("viviendas")}>
              Ver todas
            </button>
          )}
        </div>
        {active.length === 0 && <p className="muted small">Las que guardes aparecerán aquí, con su veredicto al día.</p>}
        <ul className="homes-mini">
          {active.slice(0, 6).map((h) => {
            const l = h.listing;
            const a = analyzeHome(profile, l);
            const flags = redFlags(l).length;
            const link = isLinkOnly(l);
            return (
              <li key={h.id}>
                <button onClick={() => onView("viviendas")} title={l.title}>
                  <i className={`dot ${link ? "pending" : `verdict-${a.verdict}`}`} aria-hidden />
                  <span>{l.title}</span>
                  <strong>{link ? "" : eur(l.price)}</strong>
                  <small>
                    {link ? "Solo el enlace, sin analizar" : `${eur(a.payment)}/mes${flags ? ` · ${flags} ${flags === 1 ? "alerta" : "alertas"}` : ""}`}
                  </small>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </aside>
  );
}
