import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { analyzePurchase, type Profile } from "../../shared/finance.ts";
import type { Listing, SearchResult } from "../../shared/listings.ts";
import { ListingCard } from "../ListingCard.tsx";
import { useStored } from "../lib.ts";

interface Msg {
  role: "user" | "assistant";
  content: string;
  tools?: string[];
  listings?: Listing[];
  result?: Pick<SearchResult, "source" | "ccaa" | "notice">;
  error?: string;
}

const SUGGESTIONS = [
  "¿Cuánto puedo permitirme y qué me limita más, los ahorros o el sueldo?",
  "Busca pisos de 2 habitaciones en Valencia que encajen con mi presupuesto",
  "¿Qué hipoteca fija me conviene y cuánto pagaría al mes?",
  "¿Qué cambia si consigo una hipoteca al 90 %?",
];

const TOOL_LABEL: Record<string, string> = {
  get_profile: "Leyendo tu perfil",
  max_budget: "Calculando tu presupuesto",
  analyze_purchase: "Analizando la compra",
  search_homes: "Buscando viviendas",
  mortgage_offers: "Comparando hipotecas",
  web_search: "Buscando en la web",
};

/** Markdown mínimo (negritas, listas, títulos y enlaces) sin inyectar HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) blocks.push(<ul key={blocks.length}>{list.map((li, i) => <li key={i}>{inline(li)}</li>)}</ul>);
    list = [];
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const item = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (item) {
      list.push(item[1]);
      continue;
    }
    flush();
    if (!line) continue;
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    blocks.push(heading ? <h4 key={blocks.length}>{inline(heading[1])}</h4> : <p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return <>{blocks}</>;
}

export function Asistente({ profile, aiReady, onSimulate }: { profile: Profile; aiReady: boolean | null; onSimulate: (price: number) => void }) {
  const [messages, setMessages] = useStored<Msg[]>("hs.chat", []);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  async function send(text: string) {
    const question = text.trim();
    if (!question || busy) return;
    const history = [...messages, { role: "user" as const, content: question }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    const patch = (fn: (m: Msg) => Msg) => setMessages((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
    abort.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify({
          profile,
          messages: history.filter((m) => m.content.trim()).map(({ role, content }) => ({ role, content })),
        }),
      });
      if (!res.ok || !res.body) throw new Error((await res.json().catch(() => null))?.error ?? `Error ${res.status}`);

      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const chunk of events) {
          if (!chunk.startsWith("data: ")) continue;
          const e = JSON.parse(chunk.slice(6));
          if (e.type === "text") patch((m) => ({ ...m, content: m.content + e.text }));
          else if (e.type === "tool") patch((m) => ({ ...m, tools: [...(m.tools ?? []), e.name] }));
          else if (e.type === "listings") patch((m) => ({ ...m, listings: e.listings, result: e.result }));
          else if (e.type === "error") patch((m) => ({ ...m, error: e.message }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const message = err instanceof TypeError ? "No hay conexión con el servidor local. ¿Está arrancado con npm run dev?" : (err as Error).message;
        patch((m) => ({ ...m, error: message }));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      {aiReady === false && (
        <p className="note warn">
          El asistente necesita una clave de la API de Claude. Copia <code>.env.example</code> a <code>.env</code>, pon tu <code>ANTHROPIC_API_KEY</code> y
          reinicia <code>npm run dev</code>. El resto de la aplicación funciona sin ella.
        </p>
      )}
      <section className="panel chat">
        {messages.length === 0 && (
          <div className="chat-empty">
            <h2>Pregúntale a tu asistente</h2>
            <p className="muted">Conoce tu perfil, hace los números con el mismo motor que el simulador y busca viviendas por ti.</p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ghost" onClick={() => send(s)} disabled={busy}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const last = i === messages.length - 1;
          const p = m.result?.ccaa ? { ...profile, ccaa: m.result.ccaa } : profile;
          return (
            <div key={i} className={`msg ${m.role}`}>
              {m.tools && m.tools.length > 0 && (
                <p className="tools">{[...new Set(m.tools)].map((t) => TOOL_LABEL[t] ?? t).join(" · ")}</p>
              )}
              {m.content ? <Markdown text={m.content} /> : last && busy && !m.error ? <p className="muted">Pensando…</p> : null}
              {m.error && <p className="note bad">{m.error}</p>}
              {m.listings && m.listings.length > 0 && (
                <>
                  {m.result?.source === "ejemplo" && <p className="note warn">Viviendas de ejemplo (inventadas): no son anuncios reales.</p>}
                  <div className="cards">
                    {m.listings.slice(0, 6).map((l) => (
                      <ListingCard
                        key={l.id}
                        listing={l}
                        analysis={analyzePurchase({ ...p, newBuild: l.newDevelopment || p.newBuild }, l.price)}
                        onSimulate={() => onSimulate(l.price)}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
        <div ref={end} />
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="Busca pisos en Getafe de menos de 200.000 € y dime cuál me conviene…"
          />
          {busy ? (
            <button type="button" className="ghost" onClick={() => abort.current?.abort()}>
              Parar
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}>
              Enviar
            </button>
          )}
        </form>
        {messages.length > 0 && !busy && (
          <button className="link" onClick={() => setMessages([])}>
            Borrar conversación
          </button>
        )}
      </section>
    </div>
  );
}
