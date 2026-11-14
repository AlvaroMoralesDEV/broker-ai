import type { ReactNode } from "react";
import { HOME_STATUSES, isLinkOnly, type HomeStatus, type RedFlag } from "../shared/broker.ts";
import type { PurchaseAnalysis } from "../shared/finance.ts";
import type { Listing } from "../shared/listings.ts";
import { eur } from "./lib.ts";
import { VerdictBadge } from "./ui.tsx";

const STATUS_TEXT: Record<HomeStatus, string> = {
  interesa: "Me interesa",
  visitar: "Para visitar",
  visitada: "Visitada",
  oferta: "Oferta hecha",
  descartada: "Descartada",
};

interface Props {
  listing: Listing;
  analysis: PurchaseAnalysis;
  flags?: RedFlag[];
  /** "guardada" si se sabe que está guardada pero no su estado */
  status?: HomeStatus | "guardada";
  onStatus?: (s: HomeStatus) => void;
  /** si se pasa y la vivienda no está guardada, muestra el botón Guardar */
  onSave?: () => void;
  onSimulate: () => void;
  children?: ReactNode;
}

export function ListingCard({ listing: l, analysis: a, flags = [], status, onStatus, onSave, onSimulate, children }: Props) {
  const facts = [
    l.size ? `${l.size} m²` : null,
    l.rooms != null ? `${l.rooms} hab.` : null,
    l.bathrooms ? `${l.bathrooms} baño${l.bathrooms > 1 ? "s" : ""}` : null,
    l.floor ? (/^(bajo|bj)$/i.test(l.floor) ? "Bajo" : /^\d+$/.test(l.floor) ? `Planta ${l.floor}` : l.floor.replace(/^atico$/i, "ático").replace(/sotano/i, "sótano").replace(/^./, (c) => c.toUpperCase())) : null,
    l.hasLift ? "Ascensor" : l.hasLift === false ? "Sin ascensor" : null,
    l.parking ? "Garaje" : null,
    l.newDevelopment ? "Obra nueva" : null,
  ].filter(Boolean);

  const statusControl =
    onStatus && status && status !== "guardada" ? (
      <select value={status} onChange={(e) => onStatus(e.target.value as HomeStatus)} aria-label="Estado">
        {HOME_STATUSES.map((s) => (
          <option key={s} value={s}>
            {STATUS_TEXT[s]}
          </option>
        ))}
      </select>
    ) : status ? (
      <span className="pill on">★ {status === "guardada" ? "Guardada" : STATUS_TEXT[status]}</span>
    ) : null;

  // Guardada solo con el enlace: no hay precio ni datos, así que no se pinta ningún número.
  if (isLinkOnly(l)) {
    return (
      <article className="card listing link-only">
        <div className="card-body">
          <div className="card-top">
            <span className="badge link-badge">Solo el enlace</span>
          </div>
          <h3>{l.title}</h3>
          {l.url && <p className="muted small link-url">{l.url.replace(/^https?:\/\/(www\.)?/, "")}</p>}
          <p className="muted">Aún no he visto este anuncio. Pega su texto en el chat y te digo si te encaja, el coste real y las alertas.</p>
          {children}
          <div className="card-actions">
            {l.url && (
              <a className="button" href={l.url} target="_blank" rel="noreferrer">
                Abrir anuncio ↗
              </a>
            )}
            {statusControl}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className={`card listing verdict-${a.verdict}`}>
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
        {facts.length > 0 && <p className="facts">{facts.join(" · ")}</p>}
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
        {flags.length > 0 && (
          <ul className="flags">
            {flags.map((f) => (
              <li key={f.label} className={`flag-${f.level}`} title={f.evidence ? `${f.why}\n\nEn el anuncio: «${f.evidence}»` : f.why}>
                {f.label}
              </li>
            ))}
          </ul>
        )}
        {children}
        <div className="card-actions">
          {onSave && !status && <button onClick={onSave}>☆ Guardar</button>}
          <button className={onSave && !status ? "ghost" : undefined} onClick={onSimulate}>
            Simular
          </button>
          {l.url && (
            <a className="button ghost" href={l.url} target="_blank" rel="noreferrer">
              Ver anuncio ↗
            </a>
          )}
          {statusControl}
        </div>
      </div>
    </article>
  );
}
