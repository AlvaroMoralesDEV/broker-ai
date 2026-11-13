import { useEffect, useMemo, useState } from "react";
import { analyzePurchase, type Affordability, type Profile, type Verdict } from "../../shared/finance.ts";
import type { Listing, SearchResult } from "../../shared/listings.ts";
import { ccaaName } from "../../shared/taxes.ts";
import { eur, useStored } from "../lib.ts";
import { ListingCard } from "../ListingCard.tsx";
import { Field, Num, Segmented, VerdictBadge } from "../ui.tsx";

interface Props {
  profile: Profile;
  budget: Affordability;
  onSimulate: (price: number) => void;
}

interface Query {
  zone: string;
  maxPrice: number | null;
  minRooms: number;
  minSize: number | null;
  radiusKm: number;
  order: "price" | "size" | "ratio";
}

type Filter = "todas" | "encajan" | "guardadas";

export function Casas({ profile, budget, onSimulate }: Props) {
  const [query, setQuery] = useStored<Query>("hs.query", { zone: "", maxPrice: null, minRooms: 0, minSize: null, radiusKm: 5, order: "price" });
  const [result, setResult] = useStored<SearchResult | null>("hs.result", null);
  const [saved, setSaved] = useStored<Listing[]>("hs.saved", []);
  const [filter, setFilter] = useState<Filter>("todas");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState({ title: "", price: null as number | null, url: "" });

  const set = (patch: Partial<Query>) => setQuery((q) => ({ ...q, ...patch }));
  const isSaved = (id: string) => saved.some((s) => s.id === id);
  const toggle = (l: Listing) => setSaved((list) => (list.some((s) => s.id === l.id) ? list.filter((s) => s.id !== l.id) : [...list, l]));

  // enlace directo a una búsqueda: /?zona=Valencia#casas
  useEffect(() => {
    const zona = new URLSearchParams(location.search).get("zona");
    if (zona) {
      set({ zone: zona });
      search(undefined, zona);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function search(e?: React.FormEvent, zoneOverride?: string) {
    e?.preventDefault();
    const zone = (zoneOverride ?? query.zone).trim();
    if (zone.length < 2) return setError("Escribe una ciudad, barrio o municipio.");
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ zone, order: query.order, radiusKm: String(query.radiusKm) });
    // por defecto se buscan también viviendas algo por encima del presupuesto, para ver qué queda cerca
    params.set("maxPrice", String(query.maxPrice ?? Math.round(budget.maxPrice * 1.25)));
    if (query.minRooms) params.set("minRooms", String(query.minRooms));
    if (query.minSize) params.set("minSize", String(query.minSize));
    try {
      const res = await fetch(`/api/search?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `Error ${res.status}`);
      setResult(json);
      setFilter("todas");
    } catch (err) {
      setError(err instanceof TypeError ? "No hay conexión con el servidor local. ¿Está arrancado con npm run dev?" : (err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  // Los impuestos dependen de dónde está la vivienda, no de la comunidad del perfil.
  const searchProfile = useMemo(() => (result?.ccaa ? { ...profile, ccaa: result.ccaa } : profile), [profile, result?.ccaa]);
  const analyze = (l: Listing, p: Profile) => analyzePurchase({ ...p, newBuild: l.newDevelopment || p.newBuild }, l.price);

  const shown = useMemo(() => {
    const base = filter === "guardadas" ? saved : (result?.listings ?? []);
    const rows = base.map((l) => ({ l, a: analyze(l, filter === "guardadas" ? profile : searchProfile) }));
    return filter === "encajan" ? rows.filter((r) => r.a.verdict !== "no") : rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, saved, result, profile, searchProfile]);

  const counts = useMemo(() => {
    const c: Record<Verdict, number> = { ok: 0, justo: 0, no: 0 };
    for (const l of result?.listings ?? []) c[analyze(l, searchProfile).verdict]++;
    return c;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result, searchProfile]);

  function addManual(e: React.FormEvent) {
    e.preventDefault();
    if (!manual.price) return;
    const url = /^https?:\/\//i.test(manual.url.trim()) ? manual.url.trim() : null;
    const l: Listing = {
      id: `manual-${Date.now()}`, title: manual.title.trim() || "Vivienda sin nombre", price: manual.price, size: null, rooms: null, bathrooms: null,
      floor: null, hasLift: null, exterior: null, parking: null, newDevelopment: false, address: "", district: null, municipality: "", province: null,
      pricePerM2: null, thumbnail: null, url, description: null, source: "manual",
    };
    setSaved((list) => [...list, l]);
    setManual({ title: "", price: null, url: "" });
    setFilter("guardadas");
  }

  return (
    <div className="stack">
      <form className="panel search" onSubmit={search}>
        <h2>Busca viviendas en venta</h2>
        <div className="search-row">
          <Field label="Zona">
            <input type="text" value={query.zone} onChange={(e) => set({ zone: e.target.value })} placeholder="Ruzafa, Valencia · Getafe · Bilbao…" autoFocus />
          </Field>
          <Field label="Precio máximo" hint={`Vacío: tu máximo + 25 % (${eur(budget.maxPrice * 1.25)})`}>
            <Num value={query.maxPrice} onChange={(maxPrice) => set({ maxPrice })} suffix="€" step={5000} placeholder="auto" />
          </Field>
          <Field label="Habitaciones">
            <select value={query.minRooms} onChange={(e) => set({ minRooms: Number(e.target.value) })}>
              <option value={0}>Cualquiera</option>
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}+
                </option>
              ))}
            </select>
          </Field>
          <Field label="Superficie mínima">
            <Num value={query.minSize} onChange={(minSize) => set({ minSize })} suffix="m²" step={5} placeholder="—" />
          </Field>
          <Field label="Radio">
            <Num value={query.radiusKm} onChange={(radiusKm) => set({ radiusKm })} suffix="km" min={0.5} max={50} />
          </Field>
          <Field label="Ordenar por">
            <select value={query.order} onChange={(e) => set({ order: e.target.value as Query["order"] })}>
              <option value="price">Precio</option>
              <option value="ratio">€/m²</option>
              <option value="size">Tamaño</option>
            </select>
          </Field>
        </div>
        <div className="row">
          <button type="submit" disabled={loading}>
            {loading ? "Buscando…" : "Buscar"}
          </button>
          {query.maxPrice != null && (
            <button type="button" className="link" onClick={() => set({ maxPrice: null })}>
              Usar mi presupuesto
            </button>
          )}
        </div>
        {error && <p className="note bad">{error}</p>}
      </form>

      {result && (
        <section className="stack">
          {result.notice && <p className={`note ${result.source === "ejemplo" ? "warn" : ""}`}>{result.notice}</p>}
          <div className="results-head">
            <div>
              <h2>{result.zone}</h2>
              <p className="muted">
                {counts.ok} encajan · {counts.justo} justas · {counts.no} fuera de presupuesto
                {result.ccaa ? ` · impuestos de ${ccaaName(result.ccaa)}` : ""} ·{" "}
                <a href={result.idealistaSearchUrl} target="_blank" rel="noreferrer">
                  Abrir la zona en Idealista
                </a>
              </p>
            </div>
            <Segmented<Filter>
              value={filter}
              onChange={setFilter}
              options={[
                ["todas", `Todas (${result.listings.length})`],
                ["encajan", `Me encajan (${counts.ok + counts.justo})`],
                ["guardadas", `Guardadas (${saved.length})`],
              ]}
            />
          </div>
        </section>
      )}

      {!result && saved.length > 0 && (
        <button className="ghost" onClick={() => setFilter(filter === "guardadas" ? "todas" : "guardadas")}>
          {filter === "guardadas" ? "Ocultar guardadas" : `Ver mis ${saved.length} viviendas guardadas`}
        </button>
      )}

      {filter === "guardadas" && shown.length >= 2 && (
        <section className="panel">
          <h2>Comparativa de tus viviendas guardadas</h2>
          <div className="table-wrap">
            <table className="compare">
              <thead>
                <tr>
                  <th>Vivienda</th>
                  <th>Precio</th>
                  <th>€/m²</th>
                  <th>Cuota</th>
                  <th>Esfuerzo</th>
                  <th>Ahorros necesarios</th>
                  <th>Te sobra / falta</th>
                  <th>Intereses totales</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...shown]
                  .sort((x, y) => x.l.price - y.l.price)
                  .map(({ l, a }) => (
                    <tr key={l.id}>
                      <td>
                        {l.url ? (
                          <a href={l.url} target="_blank" rel="noreferrer">
                            {l.title}
                          </a>
                        ) : (
                          l.title
                        )}
                      </td>
                      <td>{eur(l.price)}</td>
                      <td>{l.pricePerM2 ? eur(l.pricePerM2) : "—"}</td>
                      <td>{eur(a.payment)}/mes</td>
                      <td>{a.effortPct.toFixed(0)} %</td>
                      <td>{eur(a.cashNeeded)}</td>
                      <td className={a.savingsGap > 0 ? "bad" : "good"}>{a.savingsGap > 0 ? `−${eur(a.savingsGap)}` : `+${eur(a.savingsLeft)}`}</td>
                      <td>{eur(a.totalInterest)}</td>
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

      {(result || filter === "guardadas") && (
        <div className="cards">
          {shown.map(({ l, a }) => (
            <ListingCard key={l.id} listing={l} analysis={a} saved={isSaved(l.id)} onToggleSave={() => toggle(l)} onSimulate={() => onSimulate(l.price)} />
          ))}
          {shown.length === 0 && (
            <p className="empty">
              {filter === "guardadas"
                ? "Aún no has guardado ninguna vivienda."
                : filter === "encajan"
                  ? "Ninguna vivienda de esta búsqueda encaja con tu perfil. Prueba otra zona o sube la financiación."
                  : "No hay viviendas con esos filtros."}
            </p>
          )}
        </div>
      )}

      <form className="panel" onSubmit={addManual}>
        <h2>¿Has visto una casa por tu cuenta?</h2>
        <p className="muted">Añádela con su precio y el enlace del anuncio para compararla con el resto.</p>
        <div className="search-row">
          <Field label="Nombre">
            <input type="text" value={manual.title} onChange={(e) => setManual({ ...manual, title: e.target.value })} placeholder="Piso de la calle Alcalá" />
          </Field>
          <Field label="Precio">
            <Num value={manual.price} onChange={(price) => setManual({ ...manual, price })} suffix="€" step={5000} />
          </Field>
          <Field label="Enlace (opcional)">
            <input type="url" value={manual.url} onChange={(e) => setManual({ ...manual, url: e.target.value })} placeholder="https://www.idealista.com/inmueble/…" />
          </Field>
        </div>
        <button type="submit" disabled={!manual.price}>
          Añadir a guardadas
        </button>
      </form>
    </div>
  );
}
