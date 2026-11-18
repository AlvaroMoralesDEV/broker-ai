import { useCallback, useEffect, useMemo, useState } from "react";
import { affordability, maxTermYears } from "../shared/finance.ts";
import { importMessage, parseImportHash } from "../shared/importer.ts";
import { Chat } from "./Chat.tsx";
import { IMPORT_TOKEN, RATES, USER, dateEs, eur, useHomes, useOffers, useProfile, useStatus, useStored, useUsers } from "./lib.ts";
import { Mascot } from "./Mascot.tsx";
import { ProfileForm } from "./ProfileForm.tsx";
import { Situation } from "./Situation.tsx";
import { Stat } from "./ui.tsx";
import { UserSwitcher } from "./UserSwitcher.tsx";
import { AlquilarComprar } from "./tabs/AlquilarComprar.tsx";
import { Amortizar } from "./tabs/Amortizar.tsx";
import { Bonificaciones } from "./tabs/Bonificaciones.tsx";
import { MisViviendas } from "./tabs/Casas.tsx";
import { Hipotecas } from "./tabs/Hipotecas.tsx";
import { Ofertas } from "./tabs/Ofertas.tsx";
import { PlanAhorro } from "./tabs/PlanAhorro.tsx";
import { Simulador } from "./tabs/Simulador.tsx";

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
  const [seed, setSeed] = useState<{ text: string; n: number; send?: boolean; notice?: string } | null>(null);

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
    // anuncio que manda el marcador «Guardar en Bróker IA»: conversación nueva y al chat
    const imported = parseImportHash(location.hash);
    if (location.hash.startsWith("#importar=")) history.replaceState(null, "", location.pathname + location.search);
    if (imported) {
      const trusted = imported.token === IMPORT_TOKEN;
      setConversationId(null);
      setView("chat");
      setSeed({
        text: importMessage(imported.page),
        n: Date.now(),
        send: trusted,
        notice: trusted
          ? undefined
          : "Este anuncio llega de un marcador que no es el de este navegador, así que no lo he enviado. Revísalo y pulsa Enviar si es tuyo, o vuelve a arrastrar el botón desde «Mis viviendas».",
      });
      return;
    }
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
        <strong>
          <Mascot size={26} /> Bróker IA
        </strong>
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
          <Mascot size={46} live />
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
                {me.warning && <p className="note warn small">{me.warning}</p>}
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

      {view === "chat" && <Situation me={me} homes={homes} onAsk={ask} onView={go} onProfileChanged={me.reload} />}
    </div>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d={d} />
  </svg>
);
