import { useCallback, useEffect, useState } from "react";
import { dateEs, eur } from "./lib.ts";

/** Lo que devuelve /api/finance-link (server/finance-link.ts). Solo el objetivo de vivienda. */
interface FinanceLink {
  linked: boolean;
  mode: "finanzas" | "manual";
  share: { goal: string; saved: number; target: number; monthlyContribution: number | null; updatedAt: string } | null;
  syncedAt: string | null;
  error: string | null;
  url?: string;
}

const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

/**
 * «Ahorros desde Finanzas», en «Lo que sé de ti». Conectar con un token que se crea en la app de Finanzas;
 * a partir de ahí los ahorros salen de su objetivo de vivienda y mandan, salvo que se pida ignorarla.
 */
export function FinanceLinkPanel({ onChanged }: { onChanged: () => void }) {
  const [link, setLink] = useState<FinanceLink | null>(null);
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  const load = useCallback(
    () =>
      fetch("/api/finance-link")
        .then((r) => (r.ok ? r.json() : null))
        .then((l: FinanceLink | null) => l && setLink(l))
        .catch(() => {}),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  async function send(method: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const r = await fetch("/api/finance-link", json(method, body)).catch(() => null);
    const data = await r?.json().catch(() => null);
    setBusy(false);
    if (!r?.ok) return setError((data as { error?: string } | null)?.error ?? "No he podido conectar con Finanzas.");
    setToken("");
    setOpen(false);
    await load();
    onChanged();
  }

  if (!link) return null;
  const s = link.share;

  return (
    <section className="panel finance-link">
      <div className="panel-head">
        <h3 className="eyebrow">Ahorros desde Finanzas</h3>
        {link.linked && <span className={`pill ${link.mode === "finanzas" ? "on" : "off"}`}>{link.mode === "finanzas" ? "Manda Finanzas" : "Ignorada"}</span>}
      </div>

      {!link.linked ? (
        <>
          <p className="muted small">
            Conecta tu app de Finanzas y tus ahorros se pondrán al día solos con lo que tengas asignado a la compra de vivienda. Solo verá ese objetivo: nunca tus
            cuentas ni tus movimientos.
          </p>
          {open ? (
            <form
              className="finance-link-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (token.trim()) send("PUT", { token: token.trim() });
              }}
            >
              <input type="text" value={token} onChange={(e) => setToken(e.target.value)} placeholder="fin_…" aria-label="Token de Finanzas" autoComplete="off" spellCheck={false} />
              <button type="submit" disabled={busy || !token.trim()}>
                Conectar
              </button>
              <p className="muted small">
                Créalo en Finanzas → Configuración → Compartir con Bróker IA
                {link.url && (
                  <>
                    {" "}
                    (
                    <a href={link.url} target="_blank" rel="noreferrer">
                      abrir Finanzas ↗
                    </a>
                    )
                  </>
                )}
                .
              </p>
            </form>
          ) : (
            <button className="small-btn" onClick={() => setOpen(true)}>
              Conectar Finanzas
            </button>
          )}
        </>
      ) : (
        <>
          {s ? (
            <>
              <p className="finance-link-amount">
                <strong>{eur(s.saved)}</strong> <span className="muted">de {eur(s.target)}</span>
              </p>
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={s.target} aria-valuenow={s.saved}>
                <i style={{ width: `${Math.min(100, (s.saved / Math.max(1, s.target)) * 100)}%` }} />
              </div>
              <p className="muted small">
                «{s.goal}»{s.monthlyContribution ? ` · ${eur(s.monthlyContribution)}/mes` : ""} · actualizado el {dateEs(s.updatedAt)}
              </p>
            </>
          ) : (
            <p className="muted small">Conectada, pero aún no he podido leer el objetivo de vivienda.</p>
          )}
          {link.error && <p className="note warn small">{link.error}</p>}
          {link.mode === "manual" && <p className="small">Estás usando la cifra que me dices tú, no la de Finanzas.</p>}
          <div className="finance-link-actions">
            {link.mode === "finanzas" ? (
              <button className="link" disabled={busy} onClick={() => send("PATCH", { mode: "manual" })}>
                Ignorar Finanzas
              </button>
            ) : (
              <button className="link" disabled={busy} onClick={() => send("PATCH", { mode: "finanzas" })}>
                Volver a usar Finanzas
              </button>
            )}
            <button className="link danger" disabled={busy} onClick={() => confirm("¿Desconectar la app de Finanzas? Tus ahorros se quedan como están.") && send("DELETE")}>
              Desconectar
            </button>
          </div>
        </>
      )}
      {error && <p className="note bad small">{error}</p>}
    </section>
  );
}
