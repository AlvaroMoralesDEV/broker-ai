import { useCallback, useEffect, useMemo, useState } from "react";
import { KEY_FACTS, redFlags, type ProfileExtra } from "../shared/broker.ts";
import { affordability, analyzePurchase, maxTermYears, type Profile } from "../shared/finance.ts";
import { CCAA_LIST, ccaaName, type CCAA } from "../shared/taxes.ts";
import { Chat } from "./Chat.tsx";
import { RATES, USER, dateEs, eur, switchUser, useHomes, useOffers, useProfile, useStatus, useStored, useUsers, type HomesStore, type ProfileState } from "./lib.ts";
import { Ofertas } from "./tabs/Ofertas.tsx";
import { Field, Num, Stat } from "./ui.tsx";
import { Simulador } from "./tabs/Simulador.tsx";
import { MisViviendas } from "./tabs/Casas.tsx";
import { Hipotecas } from "./tabs/Hipotecas.tsx";
import { Bonificaciones } from "./tabs/Bonificaciones.tsx";
import { AlquilarComprar } from "./tabs/AlquilarComprar.tsx";
import { PlanAhorro } from "./tabs/PlanAhorro.tsx";
import { Amortizar } from "./tabs/Amortizar.tsx";

type View = "chat" | "viviendas" | "ofertas" | "calc";
const VIEWS: View[] = ["chat", "viviendas", "ofertas", "calc"];

const TABS = [
  ["simulador", "Simulador"],
  ["hipotecas", "Hipotecas"],
  ["plan", "Plan de ahorro"],
  ["amortizar", "Amortizar antes"],
  ["bonificaciones", "Bonificaciones"],
  ["alquiler", "Alquilar o comprar"],
] as const;
type Tab = (typeof TABS)[number][0];

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

export function App() {
  const me = useProfile();
  const { profile, update } = me;
  const status = useStatus();
  const homes = useHomes();
  const offers = useOffers();
  const users = useUsers();
  const [view, setView] = useStored<View>("hs.view", "chat");
  const [tab, setTab] = useStored<Tab>("hs.calc", "simulador");
  // la conversación abierta se recuerda por usuario
  const [conversationId, setConversationId] = useStored<string | null>(`hs.conversation.${USER}`, null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [drawer, setDrawer] = useState<"nav" | "context" | null>(null);
  const [seed, setSeed] = useState<{ text: string; n: number } | null>(null);

  const budget = useMemo(() => affordability(profile), [profile]);
  const [price, setPrice] = useStored<number>("hs.price", () => budget.maxPrice || 150000);

  const loadConversations = useCallback(
    () =>
      fetch("/api/conversations")
        .then((r) => (r.ok ? r.json() : []))
        .then((list: Conversation[]) => {
          setConversations(list);
          // la conversación recordada puede haberse borrado (o ser de otra base de datos)
          setConversationId((id) => (id && !list.some((c) => c.id === id) ? null : id));
        })
        .catch(() => {}),
    [setConversationId],
  );
  useEffect(() => {
    loadConversations();
    // enlaces directos: /#viviendas, /#calc y /?c=<id de conversación>
    const fromHash = VIEWS.find((v) => v === location.hash.slice(1));
    if (fromHash) setView(fromHash);
    const linked = new URLSearchParams(location.search).get("c");
    if (linked) {
      setConversationId(linked);
      if (!fromHash) setView("chat");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = (v: View) => {
    setView(v);
    setDrawer(null);
  };
  const openConversation = (id: string | null) => {
    setConversationId(id);
    go("chat");
  };
  const simulate = (p: number) => {
    setPrice(p);
    setTab("simulador");
    go("calc");
  };
  const ask = (text: string) => {
    setSeed({ text, n: Date.now() });
    go("chat");
  };
  async function deleteConversation(id: string) {
    if (!confirm("¿Borrar esta conversación? Tu perfil y tus viviendas no se tocan.")) return;
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (id === conversationId) setConversationId(null);
    loadConversations();
  }

  const active = homes.homes.filter((h) => h.status !== "descartada");
  const provider = status?.provider ?? null;

  return (
    <div className={`shell view-${view}${drawer ? ` drawer-${drawer}` : ""}`}>
      <header className="topbar">
        <button className="icon" onClick={() => setDrawer(drawer === "nav" ? null : "nav")} aria-label="Menú">
          ☰
        </button>
        <strong>Bróker IA</strong>
        {view === "chat" ? (
          <button className="ghost small-btn" onClick={() => setDrawer(drawer === "context" ? null : "context")}>
            {me.known ? eur(budget.maxPrice) : "Mi situación"}
          </button>
        ) : (
          <span />
        )}
      </header>
      {drawer && <div className="scrim" onClick={() => setDrawer(null)} />}

      <aside className="side">
        <div className="brand">
          <span className="logo" aria-hidden>
            ⌂
          </span>
          <div>
            <h1>Bróker IA</h1>
            <p>Tu bróker hipotecario personal</p>
          </div>
        </div>
        <UserSwitcher store={users} />
        <button className="new-chat" onClick={() => openConversation(null)}>
          + Nueva conversación
        </button>
        <nav className="nav">
          <button className={view === "chat" ? "on" : ""} onClick={() => go("chat")}>
            <Icon d="M4 5h16v11H9l-5 4z" /> Chat
          </button>
          <button className={view === "viviendas" ? "on" : ""} onClick={() => go("viviendas")}>
            <Icon d="M3 11l9-7 9 7M5 10v10h14V10M10 20v-6h4v6" /> Mis viviendas {active.length > 0 && <em>{active.length}</em>}
          </button>
          <button className={view === "ofertas" ? "on" : ""} onClick={() => go("ofertas")}>
            <Icon d="M19 5L5 19M7.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM16.5 18a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z" /> Ofertas de bancos{" "}
            {offers.offers.length > 0 && <em>{offers.offers.length}</em>}
          </button>
          <button className={view === "calc" ? "on" : ""} onClick={() => go("calc")}>
            <Icon d="M6 3h12v18H6zM9 7h6M9 12h.01M12 12h.01M15 12h.01M9 16h.01M12 16h.01M15 16h.01" /> Calculadoras
          </button>
        </nav>
        <div className="conversations">
          {conversations.length > 0 && <h3>Conversaciones</h3>}
          {conversations.map((c) => (
            <div key={c.id} className={`conversation${c.id === conversationId && view === "chat" ? " on" : ""}`}>
              <button className="conversation-open" onClick={() => openConversation(c.id)} title={c.title}>
                <span>{c.title}</span>
                <small>{new Date(c.updatedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}</small>
              </button>
              <button className="conversation-delete" onClick={() => deleteConversation(c.id)} aria-label={`Borrar «${c.title}»`} title="Borrar">
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="side-foot">
          {provider && (
            <p className={`provider provider-${provider.kind}`} title={provider.hint ?? undefined}>
              <i aria-hidden /> {provider.label}
              {provider.kind === "anthropic" && provider.model ? ` · ${provider.model}` : ""}
            </p>
          )}
          {provider && provider.kind !== "anthropic" && provider.hint && <p className="provider-hint">{provider.hint}</p>}
          <p className="muted">
            Tipos del {dateEs(RATES.updated)} · Euríbor {RATES.euribor.monthlyAvg.toLocaleString("es-ES")} %
          </p>
        </div>
      </aside>

      <main className="main">
        {view === "chat" && (
          <Chat
            profile={profile}
            known={me.known}
            provider={provider}
            conversationId={conversationId}
            onConversation={setConversationId}
            onTurnDone={() => {
              loadConversations();
              me.reload();
              homes.reload();
              offers.reload();
            }}
            onProfileChanged={me.reload}
            homes={homes}
            onSimulate={simulate}
            seed={seed}
          />
        )}
        {view === "ofertas" && <Ofertas profile={profile} store={offers} onAskBroker={ask} />}
        {view === "viviendas" && <MisViviendas profile={profile} store={homes} onSimulate={simulate} onAskBroker={() => openConversation(conversationId)} />}
        {view === "calc" && (
          <div className="page">
            <div className="layout">
              <aside className="panel profile">
                <h2>Tu perfil</h2>
                {me.known === false && (
                  <p className="note warn">Aún no has dado tus datos: cuéntaselos a tu bróker o rellénalos aquí. Mientras, los números usan un perfil de ejemplo.</p>
                )}
                <ProfileForm profile={profile} update={update} maxYears={maxTermYears(profile.age)} />
              </aside>
              <div>
                <section className="budget">
                  <Stat
                    label="Precio máximo de vivienda"
                    value={eur(budget.maxPrice)}
                    sub={budget.limiting === "ahorros" ? "Te limitan los ahorros" : "Te limitan los ingresos"}
                    tone="good"
                  />
                  <Stat label="Cuota máxima" value={`${eur(budget.maxPayment)}/mes`} sub={`${profile.debtRatioPct} % de tus ingresos − deudas`} />
                  <Stat label="Por ingresos podrías llegar a" value={eur(budget.priceByIncome)} sub={`Hipoteca de ${eur(budget.maxLoan)}`} />
                  <Stat label="Por ahorros podrías llegar a" value={eur(budget.priceBySavings)} sub="Entrada + impuestos + gastos" />
                </section>
                <nav className="tabs">
                  {TABS.map(([id, label]) => (
                    <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
                      {label}
                    </button>
                  ))}
                </nav>
                {tab === "simulador" && <Simulador profile={profile} update={update} price={price} setPrice={setPrice} budget={budget} />}
                {tab === "hipotecas" && <Hipotecas profile={profile} update={update} price={price} />}
                {tab === "plan" && <PlanAhorro profile={profile} price={price} setPrice={setPrice} />}
                {tab === "amortizar" && <Amortizar profile={profile} price={price} />}
                {tab === "bonificaciones" && <Bonificaciones profile={profile} price={price} />}
                {tab === "alquiler" && <AlquilarComprar profile={profile} price={price} />}
                <footer className="foot">
                  Cálculos orientativos: no son una oferta ni asesoramiento financiero. Los impuestos y tipos reducidos dependen de requisitos que debes
                  confirmar con la comunidad autónoma o un notario, y las condiciones reales las fija cada banco.
                </footer>
              </div>
            </div>
          </div>
        )}
      </main>

      {view === "chat" && <Situation me={me} homes={homes} onAsk={ask} onView={go} />}
    </div>
  );
}

/**
 * Usuario de esta pestaña. Cada usuario tiene su perfil, conversaciones, viviendas y ofertas.
 * Sin contraseñas: está pensado para usarlo en tu ordenador (tú, tu pareja, alguien a quien asesoras).
 */
function UserSwitcher({ store }: { store: ReturnType<typeof useUsers> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const current = store.current;
  const label = current?.name ?? "…";
  const initial = (n: string) => n.trim()[0]?.toUpperCase() ?? "?";
  const newTab = (id: string) => window.open(`${location.pathname}?u=${encodeURIComponent(id)}`, "_blank", "noopener");

  return (
    <div className="user-switch">
      <button className="user-current" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="user-initial" aria-hidden>
          {initial(label)}
        </span>
        <span className="user-name">{label}</span>
        <small>{open ? "Cerrar" : "Cambiar"}</small>
      </button>
      {open && (
        <div className="user-menu">
          <p className="eyebrow">Usuarios</p>
          {store.users.map((u) => (
            <div key={u.id} className={`user-row${u.id === USER ? " on" : ""}`}>
              <button className="user-pick" onClick={() => u.id !== USER && switchUser(u.id)} disabled={u.id === USER}>
                <span className="user-initial" aria-hidden>
                  {initial(u.name)}
                </span>
                {u.name}
                {u.id === USER && <small> · aquí</small>}
              </button>
              <button className="icon" title={`Abrir a ${u.name} en otra pestaña`} aria-label={`Abrir a ${u.name} en otra pestaña`} onClick={() => newTab(u.id)}>
                ↗
              </button>
            </div>
          ))}
          <form
            className="user-new"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) store.create(name.trim());
            }}
          >
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre del nuevo usuario" maxLength={40} aria-label="Nombre del nuevo usuario" />
            <button type="submit" disabled={!name.trim()}>
              Crear
            </button>
          </form>
          <div className="row">
            <button
              className="link"
              onClick={() => {
                const n = prompt("Nuevo nombre", label);
                if (n?.trim()) store.rename(USER, n.trim());
              }}
            >
              Renombrar
            </button>
            {USER !== "default" && (
              <button
                className="link danger"
                onClick={() => confirm(`¿Borrar a ${label} y todos sus datos (perfil, conversaciones, viviendas y ofertas)? No se puede deshacer.`) && store.remove(USER)}
              >
                Borrar a {label}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);

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
function Situation({ me, homes, onAsk, onView }: { me: ProfileState; homes: HomesStore; onAsk: (text: string) => void; onView: (v: View) => void }) {
  const { profile, extra, known, missing } = me;
  const budget = affordability(profile);
  const knownCount = known ? KEY_FACTS.length - missing.length : 0;
  const active = homes.homes.filter((h) => h.status !== "descartada");

  return (
    <aside className="context">
      <section className="panel">
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
            const a = analyzePurchase({ ...profile, ccaa: l.ccaa ?? profile.ccaa, newBuild: l.newDevelopment || profile.newBuild }, l.price);
            const flags = redFlags(l).length;
            return (
              <li key={h.id}>
                <button onClick={() => onView("viviendas")} title={l.title}>
                  <i className={`dot verdict-${a.verdict}`} aria-hidden />
                  <span>{l.title}</span>
                  <strong>{eur(l.price)}</strong>
                  <small>
                    {eur(a.payment)}/mes{flags ? ` · ${flags} ${flags === 1 ? "alerta" : "alertas"}` : ""}
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

function ProfileForm({ profile, update, maxYears }: { profile: Profile; update: (p: Partial<Profile>) => void; maxYears: number }) {
  return (
    <div className="form">
      <Field label="Edad">
        <Num value={profile.age} onChange={(age) => update({ age, years: Math.min(profile.years, maxTermYears(age)) })} suffix="años" min={18} max={80} />
      </Field>
      <Field label="Ingresos netos al mes" hint="Nóminas y otros ingresos que declares (suma si compráis dos)">
        <Num value={profile.netIncome} onChange={(netIncome) => update({ netIncome })} suffix="€" step={50} />
      </Field>
      <Field label="Otras deudas al mes" hint="Coche, préstamos, tarjetas…">
        <Num value={profile.monthlyDebts} onChange={(monthlyDebts) => update({ monthlyDebts })} suffix="€" step={25} />
      </Field>
      <Field label="Ahorros para la compra">
        <Num value={profile.savings} onChange={(savings) => update({ savings })} suffix="€" step={1000} />
      </Field>
      <Field label="Comunidad autónoma" hint="Determina los impuestos de la compra">
        <select value={profile.ccaa} onChange={(e) => update({ ccaa: e.target.value as CCAA })}>
          {CCAA_LIST.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <label className="check">
        <input type="checkbox" checked={profile.firstHome} onChange={(e) => update({ firstHome: e.target.checked })} />
        Primera vivienda habitual
      </label>
      <label className="check">
        <input type="checkbox" checked={profile.newBuild} onChange={(e) => update({ newBuild: e.target.checked })} />
        Obra nueva (IVA en vez de ITP)
      </label>

      <h3>Hipoteca</h3>
      <Field label="Financiación del banco" hint="80 % es lo normal; 90-95 % para jóvenes o con aval">
        <div className="chips">
          {[80, 90, 95, 100].map((v) => (
            <button key={v} className={profile.ltvPct === v ? "on" : ""} onClick={() => update({ ltvPct: v })}>
              {v} %
            </button>
          ))}
        </div>
      </Field>
      <Field label="Tipo de interés (TIN)" hint="Elige uno real en la pestaña Hipotecas">
        <Num value={profile.ratePct} onChange={(ratePct) => update({ ratePct })} suffix="%" step={0.05} max={15} />
      </Field>
      <Field label="Plazo" hint={`Máximo habitual a tu edad: ${maxYears} años`}>
        <Num value={profile.years} onChange={(years) => update({ years })} suffix="años" min={5} max={40} />
      </Field>

      <details>
        <summary>Ajustes avanzados</summary>
        <Field label="Endeudamiento máximo" hint="Los bancos piden entre el 30 % y el 40 %">
          <Num value={profile.debtRatioPct} onChange={(debtRatioPct) => update({ debtRatioPct })} suffix="%" min={10} max={50} />
        </Field>
        <Field label="Notaría, registro, gestoría y tasación" hint="En % del precio">
          <Num value={profile.otherCostsPct} onChange={(otherCostsPct) => update({ otherCostsPct })} suffix="%" step={0.1} max={5} />
        </Field>
        <Field label="Impuesto a mano" hint="Déjalo vacío para calcularlo según la comunidad">
          <span className="row">
            <Num value={profile.taxOverridePct} onChange={(taxOverridePct) => update({ taxOverridePct })} suffix="%" step={0.5} max={20} placeholder="auto" />
            {profile.taxOverridePct != null && (
              <button className="link" onClick={() => update({ taxOverridePct: null })}>
                Quitar
              </button>
            )}
          </span>
        </Field>
        <Field label="Préstamo personal (si falta entrada)">
          <span className="row">
            <Num value={profile.personalLoanRatePct} onChange={(personalLoanRatePct) => update({ personalLoanRatePct })} suffix="%" step={0.5} max={25} />
            <Num value={profile.personalLoanYears} onChange={(personalLoanYears) => update({ personalLoanYears })} suffix="años" min={1} max={10} />
          </span>
        </Field>
      </details>
    </div>
  );
}
