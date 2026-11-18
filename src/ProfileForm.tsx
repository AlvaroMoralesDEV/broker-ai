import { maxTermYears, type Profile } from "../shared/finance.ts";
import { CCAA_LIST, type CCAA } from "../shared/taxes.ts";
import { Field, Num } from "./ui.tsx";

/** Formulario del perfil en «Calculadoras»: lo mismo que el bróker apunta en el chat, editable a mano. */
export function ProfileForm({ profile, update, maxYears }: { profile: Profile; update: (p: Partial<Profile>) => void; maxYears: number }) {
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
