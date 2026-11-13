import type { PurchaseAnalysis } from "../shared/finance.ts";
import type { Listing } from "../shared/listings.ts";
import { eur } from "./lib.ts";
import { VerdictBadge } from "./ui.tsx";

interface Props {
  listing: Listing;
  analysis: PurchaseAnalysis;
  saved?: boolean;
  onToggleSave?: () => void;
  onSimulate: () => void;
}

export function ListingCard({ listing: l, analysis: a, saved, onToggleSave, onSimulate }: Props) {
  const facts = [
    l.size ? `${l.size} m²` : null,
    l.rooms != null ? `${l.rooms} hab.` : null,
    l.bathrooms ? `${l.bathrooms} baño${l.bathrooms > 1 ? "s" : ""}` : null,
    l.floor ? (l.floor === "bajo" || l.floor === "bj" ? "Bajo" : `Planta ${l.floor}`) : null,
    l.hasLift ? "Ascensor" : l.hasLift === false ? "Sin ascensor" : null,
    l.parking ? "Garaje" : null,
    l.newDevelopment ? "Obra nueva" : null,
  ].filter(Boolean);

  return (
    <article className={`card listing verdict-${a.verdict}`}>
      <div className="thumb">
        {l.thumbnail ? <img src={l.thumbnail} alt="" loading="lazy" /> : <span aria-hidden>⌂</span>}
        {l.source === "ejemplo" && <span className="tag">Ejemplo</span>}
        {l.source === "manual" && <span className="tag">Añadida por ti</span>}
      </div>
      <div className="card-body">
        <div className="card-top">
          <strong className="price">{eur(l.price)}</strong>
          <VerdictBadge verdict={a.verdict} />
        </div>
        <h3>{l.title}</h3>
        <p className="muted">
          {[l.district, l.municipality].filter(Boolean).join(" · ")}
          {l.pricePerM2 ? ` · ${eur(l.pricePerM2)}/m²` : ""}
        </p>
        <p className="facts">{facts.join(" · ")}</p>
        <dl className="mini">
          <div>
            <dt>Cuota</dt>
            <dd>{eur(a.payment)}/mes</dd>
          </div>
          <div>
            <dt>Ahorros necesarios</dt>
            <dd>{eur(a.cashNeeded)}</dd>
          </div>
          <div>
            <dt>{a.savingsGap > 0 ? "Te faltan" : "Te sobran"}</dt>
            <dd className={a.savingsGap > 0 ? "bad" : "good"}>{eur(a.savingsGap > 0 ? a.savingsGap : a.savingsLeft)}</dd>
          </div>
        </dl>
        <div className="card-actions">
          <button onClick={onSimulate}>Simular</button>
          {l.url && (
            <a className="button ghost" href={l.url} target="_blank" rel="noreferrer">
              Ver anuncio
            </a>
          )}
          {onToggleSave && (
            <button className="ghost" onClick={onToggleSave} aria-pressed={saved}>
              {saved ? "★ Guardada" : "☆ Guardar"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}
