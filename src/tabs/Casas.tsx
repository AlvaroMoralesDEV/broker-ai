import { useEffect, useMemo, useState } from "react";
import { redFlags, type HomeStatus, type SavedHome } from "../../shared/broker.ts";
import { analyzePurchase, type Profile } from "../../shared/finance.ts";
import { eur } from "../lib.ts";
import { ListingCard } from "../ListingCard.tsx";
import { Segmented, VerdictBadge } from "../ui.tsx";

type Filter = "activas" | "descartadas";

/** Viviendas guardadas (por el agente o desde aquí), recalculadas con tu perfil actual. */
export function MisViviendas({ profile, onSimulate }: { profile: Profile; onSimulate: (price: number) => void }) {
  const [homes, setHomes] = useState<SavedHome[] | null>(null);
  const [filter, setFilter] = useState<Filter>("activas");
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch("/api/homes?all=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Error ${r.status}`))))
      .then(setHomes)
      .catch(() => setError("No hay conexión con el servidor local."));

  useEffect(() => {
    load();
  }, []);

  async function patch(id: string, body: { status?: HomeStatus; notes?: string }) {
    const r = await fetch(`/api/homes/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) {
      const updated: SavedHome = await r.json();
      setHomes((list) => list?.map((h) => (h.id === id ? updated : h)) ?? null);
    }
  }

  async function remove(id: string) {
    if (!confirm("¿Borrar esta vivienda y su histórico de precios?")) return;
    await fetch(`/api/homes/${encodeURIComponent(id)}`, { method: "DELETE" });
    setHomes((list) => list?.filter((h) => h.id !== id) ?? null);
  }

  const rows = useMemo(
    () =>
      (homes ?? [])
        .filter((h) => (filter === "descartadas") === (h.status === "descartada"))
        .map((h) => {
          const l = h.listing;
          const a = analyzePurchase({ ...profile, ccaa: l.ccaa ?? profile.ccaa, newBuild: l.newDevelopment || profile.newBuild }, l.price);
          return { h, a, flags: redFlags(l) };
        }),
    [homes, filter, profile],
  );
  const discarded = homes?.filter((h) => h.status === "descartada").length ?? 0;

  if (error) return <p className="note bad">{error}</p>;
  if (!homes) return <p className="muted">Cargando…</p>;

  return (
    <div className="stack">
      <div className="results-head">
        <div>
          <h2>Mis viviendas</h2>
          <p className="muted">Recalculadas con tu perfil de ahora. Para añadir una, pégale el anuncio a tu bróker y pídele que la guarde.</p>
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

      {rows.length >= 2 && (
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
                {[...rows]
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
                  Al guardarla {h.savedVerdict === "ok" ? "te encajaba" : h.savedVerdict === "justo" ? "era justa" : "estaba fuera de presupuesto"}: ha cambiado tu
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
              <button className="link" onClick={() => remove(h.id)}>
                Borrar
              </button>
            </ListingCard>
          );
        })}
        {rows.length === 0 && (
          <p className="empty">
            {filter === "activas" ? "Aún no tienes viviendas guardadas. Pega un anuncio de Idealista en el chat con tu bróker." : "No has descartado ninguna."}
          </p>
        )}
      </div>
    </div>
  );
}
