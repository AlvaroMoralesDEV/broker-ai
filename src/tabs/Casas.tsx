import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isLinkOnly, portalOf, redFlags, type SavedHome } from "../../shared/broker.ts";
import { analyzePurchase, type Profile } from "../../shared/finance.ts";
import { bookmarkletCode } from "../../shared/importer.ts";
import { IMPORT_TOKEN, USER, eur, type HomesStore } from "../lib.ts";
import { Mascot } from "../Mascot.tsx";
import { ListingCard } from "../ListingCard.tsx";
import { Segmented, VerdictBadge } from "../ui.tsx";

type Filter = "activas" | "descartadas";

interface Props {
  profile: Profile;
  store: HomesStore;
  onSimulate: (price: number) => void;
  onAskBroker: () => void;
}

/**
 * Botón para arrastrar a la barra de marcadores. React no deja poner un href javascript: (lo bloquea por
 * seguridad), así que se pone a mano después de pintar. El código lo genera shared/importer.ts.
 */
function ImportBookmarklet() {
  const link = useRef<HTMLAnchorElement>(null);
  const [help, setHelp] = useState(false);
  useEffect(() => {
    link.current?.setAttribute("href", bookmarkletCode(location.origin, USER, IMPORT_TOKEN));
  }, []);
  return (
    <section className="panel import-box">
      <div>
        <h2>Guarda anuncios desde el portal</h2>
        <p className="muted">
          Arrastra este botón a tu barra de marcadores. Cuando estés viendo un anuncio en Idealista, Fotocasa o cualquier otro portal, púlsalo: lo
          leo desde tu navegador, lo analizo y lo guardo aquí.
        </p>
      </div>
      <div className="import-actions">
        <a ref={link} className="bookmarklet" onClick={(e) => (e.preventDefault(), setHelp(true))} title="Arrástrame a la barra de marcadores">
          ⭐ Guardar en Bróker IA
        </a>
        {help && <p className="small muted">Arrástralo a la barra de marcadores (Ctrl+Mayús+B para mostrarla); aquí no hace nada.</p>}
      </div>
    </section>
  );
}

/** Ventana «¿Seguro que quieres eliminarla?». Escape o pulsar fuera la cierran sin borrar. */
function ConfirmDelete({ home, onCancel, onConfirm }: { home: SavedHome; onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // el foco va a «Cancelar»: un Enter de más no borra nada
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-delete-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="confirm-delete-title">¿Estás seguro de que quieres eliminarla?</h3>
        <p>
          <strong>{home.listing.title}</strong>
          {home.listing.price > 0 ? ` · ${eur(home.listing.price)}` : ""}
        </p>
        <p className="muted small">Se borran también sus notas y su histórico de precios. No se puede deshacer. Si solo ya no te interesa, márcala como «Descartada».</p>
        <div className="modal-actions">
          <button ref={cancel} className="ghost" onClick={onCancel}>
            Cancelar
          </button>
          <button className="danger" onClick={onConfirm}>
            Sí, eliminar
          </button>
        </div>
      </div>
    </div>
  );
}

/** Viviendas guardadas (por el agente o desde una tarjeta), recalculadas con tu perfil actual. */
export function MisViviendas({ profile, store, onSimulate, onAskBroker }: Props) {
  const { homes, patch, remove } = store;
  const [filter, setFilter] = useState<Filter>("activas");
  /** portal elegido en el filtro («todos» o el id de portalOf) */
  const [portal, setPortal] = useState("todos");
  const [toDelete, setToDelete] = useState<SavedHome | null>(null);
  const closeDelete = useCallback(() => setToDelete(null), []);

  // portales de las viviendas de esta pestaña (en seguimiento o descartadas), con cuántas hay de cada uno
  const inTab = homes.filter((h) => (filter === "descartadas") === (h.status === "descartada"));
  const portals = [...inTab.reduce((m, h) => {
    const p = portalOf(h.listing.url);
    return m.set(p.id, { ...p, n: (m.get(p.id)?.n ?? 0) + 1 });
  }, new Map<string, { id: string; name: string; n: number }>()).values()].sort((a, b) => b.n - a.n);
  // si el portal elegido ya no tiene viviendas aquí, se vuelve a «Todos»
  const activePortal = portals.some((p) => p.id === portal) ? portal : "todos";

  const rows = useMemo(
    () =>
      homes
        .filter((h) => (filter === "descartadas") === (h.status === "descartada"))
        .filter((h) => activePortal === "todos" || portalOf(h.listing.url).id === activePortal)
        .map((h) => {
          const l = h.listing;
          const a = analyzePurchase({ ...profile, ccaa: l.ccaa ?? profile.ccaa, newBuild: l.newDevelopment || profile.newBuild }, l.price);
          return { h, a, flags: redFlags(l) };
        }),
    [homes, filter, activePortal, profile],
  );
  const discarded = homes.filter((h) => h.status === "descartada").length;
  // las guardadas solo con el enlace no tienen números: no entran en la comparativa
  const analyzed = rows.filter((r) => !isLinkOnly(r.h.listing));

  return (
    <div className="page stack">
      <div className="results-head">
        <div>
          <h2 className="page-title">Mis viviendas</h2>
          <p className="muted">Recalculadas con tu situación de hoy. Para añadir una, usa el botón de abajo o pega el anuncio (o solo su enlace) en el chat.</p>
        </div>
        <Segmented<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            ["activas", `En seguimiento (${homes.length - discarded})`],
            ["descartadas", `Descartadas (${discarded})`],
          ]}
        />
      </div>

      <ImportBookmarklet />

      {portals.length > 1 && (
        <div className="portal-filter" role="group" aria-label="Filtrar por portal">
          <span className="muted small">Portal:</span>
          <button className={activePortal === "todos" ? "on" : ""} aria-pressed={activePortal === "todos"} onClick={() => setPortal("todos")}>
            Todos ({inTab.length})
          </button>
          {portals.map((p) => (
            <button key={p.id} className={activePortal === p.id ? "on" : ""} aria-pressed={activePortal === p.id} onClick={() => setPortal(p.id)}>
              {p.name} ({p.n})
            </button>
          ))}
        </div>
      )}

      {analyzed.length >= 2 && (
        <section className="panel">
          <h2>Comparativa</h2>
          <div className="table-wrap">
            <table className="compare">
              <thead>
                <tr>
                  <th>Vivienda</th>
                  <th>Precio</th>
                  <th>€/m²</th>
                  <th>Cuota</th>
                  <th>Comunidad</th>
                  <th>Esfuerzo</th>
                  <th>Ahorros necesarios</th>
                  <th>Te sobra / falta</th>
                  <th>Alertas</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...analyzed]
                  .sort((x, y) => x.h.listing.price - y.h.listing.price)
                  .map(({ h, a, flags }) => (
                    <tr key={h.id}>
                      <td>{h.listing.url ? <a href={h.listing.url} target="_blank" rel="noreferrer">{h.listing.title}</a> : h.listing.title}</td>
                      <td>{eur(h.listing.price)}</td>
                      <td>{h.listing.pricePerM2 ? eur(h.listing.pricePerM2) : "—"}</td>
                      <td>{eur(a.payment)}/mes</td>
                      <td>{h.listing.communityFees != null ? `${eur(h.listing.communityFees)}/mes` : "—"}</td>
                      <td>{a.effortPct.toFixed(0)} %</td>
                      <td>{eur(a.cashNeeded)}</td>
                      <td className={a.savingsGap > 0 ? "bad" : "good"}>{a.savingsGap > 0 ? `−${eur(a.savingsGap)}` : `+${eur(a.savingsLeft)}`}</td>
                      <td>{flags.length ? flags.map((f) => f.label).join(", ") : "—"}</td>
                      <td>
                        <VerdictBadge verdict={a.verdict} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <div className="cards">
        {rows.map(({ h, a, flags }) => {
          const first = h.prices[0]?.price;
          return (
            <ListingCard
              key={h.id}
              listing={h.listing}
              analysis={a}
              flags={flags}
              status={h.status}
              onStatus={(status) => patch(h.id, { status })}
              onSimulate={() => onSimulate(h.listing.price)}
              onDelete={() => setToDelete(h)}
            >
              {first != null && first !== h.listing.price && (
                <p className={`small ${h.listing.price < first ? "good" : "bad"}`}>
                  {h.listing.price < first ? "Ha bajado" : "Ha subido"} desde {eur(first)} (guardada el {new Date(h.createdAt).toLocaleDateString("es-ES")})
                </p>
              )}
              {h.savedVerdict && h.savedVerdict !== a.verdict && (
                <p className="small muted">
                  Al guardarla {h.savedVerdict === "ok" ? "te encajaba" : h.savedVerdict === "justo" ? "iba justa" : "estaba fuera de presupuesto"}: ha cambiado tu
                  situación.
                </p>
              )}
              <textarea
                className="notes"
                rows={2}
                defaultValue={h.notes ?? ""}
                placeholder="Notas: visita, dudas, lo que te dijo la agencia…"
                onBlur={(e) => e.target.value !== (h.notes ?? "") && patch(h.id, { notes: e.target.value })}
              />
            </ListingCard>
          );
        })}
      </div>
      {toDelete && (
        <ConfirmDelete
          home={toDelete}
          onCancel={closeDelete}
          onConfirm={() => {
            remove(toDelete.id);
            setToDelete(null);
          }}
        />
      )}
      {rows.length === 0 && (
        <div className="empty-state">
          <Mascot size={88} live />
          {filter === "activas" ? (
            <>
              <h3>Aún no sigues ninguna vivienda</h3>
              <p className="muted">Abre un anuncio en Idealista, copia el texto y pégalo en el chat: tu bróker lo revisa y lo guardas con un clic. Si solo tienes el enlace, mándalo y lo guarda para tenerlo a mano.</p>
              <button onClick={onAskBroker}>Ir al chat</button>
            </>
          ) : (
            <p className="muted">No has descartado ninguna.</p>
          )}
        </div>
      )}
    </div>
  );
}
