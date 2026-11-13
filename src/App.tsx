import { useEffect, useMemo } from "react";
import { affordability, maxTermYears, type Profile } from "../shared/finance.ts";
import { CCAA_LIST, type CCAA } from "../shared/taxes.ts";
import { RATES, dateEs, eur, useProfile, useStatus, useStored } from "./lib.ts";
import { Field, Num, Stat } from "./ui.tsx";
import { Simulador } from "./tabs/Simulador.tsx";
import { Casas } from "./tabs/Casas.tsx";
import { Hipotecas } from "./tabs/Hipotecas.tsx";
import { Bonificaciones } from "./tabs/Bonificaciones.tsx";
import { AlquilarComprar } from "./tabs/AlquilarComprar.tsx";
import { Asistente } from "./tabs/Asistente.tsx";
import { PlanAhorro } from "./tabs/PlanAhorro.tsx";
import { Amortizar } from "./tabs/Amortizar.tsx";

const TABS = [
  ["simulador", "Simulador"],
  ["casas", "Buscar casas"],
  ["hipotecas", "Hipotecas"],
  ["plan", "Plan de ahorro"],
  ["amortizar", "Amortizar antes"],
  ["bonificaciones", "Bonificaciones"],
  ["alquiler", "Alquilar o comprar"],
  ["asistente", "Asistente IA"],
] as const;
type Tab = (typeof TABS)[number][0];

export function App() {
  const [profile, update] = useProfile();
  const status = useStatus();
  const [tab, setTab] = useStored<Tab>("hs.tab", "simulador");
  useEffect(() => {
    // enlaces directos a una pestaña: http://localhost:5173/#hipotecas
    const fromHash = TABS.find(([id]) => id === location.hash.slice(1))?.[0];
    if (fromHash) setTab(fromHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const budget = useMemo(() => affordability(profile), [profile]);
  const [price, setPrice] = useStored<number>("hs.price", () => budget.maxPrice || 150000);
  const maxYears = maxTermYears(profile.age);

  const simulate = (p: number) => {
    setPrice(p);
    setTab("simulador");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>⌂</span>
          <div>
            <h1>Hipoteca Searcher</h1>
            <p>Tu hipoteca y tu casa, en un solo sitio</p>
          </div>
        </div>
        <div className="status">
          <span className="pill">Tipos actualizados el {dateEs(RATES.updated)}</span>
          <span className="pill">Euríbor {RATES.euribor.monthlyAvg.toLocaleString("es-ES")} %</span>
          {status && <span className={`pill ${status.idealista ? "on" : "off"}`}>Idealista: {status.idealista ? "API real" : "datos de ejemplo"}</span>}
          {status && <span className={`pill ${status.ai ? "on" : "off"}`}>IA: {status.ai ? "activa" : "sin clave"}</span>}
        </div>
      </header>

      <div className="layout">
        <aside className="panel profile">
          <h2>Tu perfil</h2>
          <ProfileForm profile={profile} update={update} maxYears={maxYears} />
        </aside>

        <main>
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
          {tab === "casas" && <Casas profile={profile} budget={budget} onSimulate={simulate} />}
          {tab === "hipotecas" && <Hipotecas profile={profile} update={update} price={price} />}
          {tab === "plan" && <PlanAhorro profile={profile} price={price} setPrice={setPrice} />}
          {tab === "amortizar" && <Amortizar profile={profile} price={price} />}
          {tab === "bonificaciones" && <Bonificaciones profile={profile} price={price} />}
          {tab === "alquiler" && <AlquilarComprar profile={profile} price={price} />}
          {tab === "asistente" && <Asistente profile={profile} aiReady={status?.ai ?? null} onSimulate={simulate} />}

          <footer className="foot">
            Cálculos orientativos: no son una oferta ni asesoramiento financiero. Los impuestos y tipos reducidos dependen de requisitos que debes
            confirmar con la comunidad autónoma o un notario, y las condiciones reales las fija cada banco.
          </footer>
        </main>
      </div>
    </div>
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
