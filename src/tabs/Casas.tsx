import { useMemo, useState } from "react";
import { isLinkOnly, redFlags } from "../../shared/broker.ts";
import { analyzePurchase, type Profile } from "../../shared/finance.ts";
import { eur, type HomesStore } from "../lib.ts";
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

/** Viviendas guardadas (por el agente o desde una tarjeta), recalculadas con tu perfil actual. */
export function MisViviendas({ profile, store, onSimulate, onAskBroker }: Props) {
  const { homes, patch, remove } = store;
  const [filter, setFilter] = useState<Filter>("activas");

  const rows = useMemo(
    () =>
      homes
        .filter((h) => (filter === "descartadas") === (h.status === "descartada"))
        .map((h) => {
          const l = h.listing;
          const a = analyzePurchase({ ...profile, ccaa: l.ccaa ?? profile.ccaa, newBuild: l.newDevelopment || profile.newBuild }, l.price);
          return { h, a, flags: redFlags(l) };
        }),
    [homes, filter, profile],
  );
  const discarded = homes.filter((h) => h.status === "descartada").length;
  // las guardadas solo con el enlace no tienen números: no entran en la comparativa
  const analyzed = rows.filter((r) => !isLinkOnly(r.h.listing));

  return (
    <div className="page stack">
      <div className="results-head">
        <div>
          <h2 className="page-title">Mis viviendas</h2>
          <p className="muted">Recalculadas con tu situación de hoy. Para añadir una, pega el anuncio (o solo su enlace) en el chat.</p>
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
              <button className="link danger" onClick={() => confirm("¿Borrar esta vivienda y su histórico de precios?") && remove(h.id)}>
                Borrar
              </button>
            </ListingCard>
          );
        })}
      </div>
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
