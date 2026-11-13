import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { redFlags, toHomeListing } from "../../shared/broker.ts";
import { TOOL_LABEL, type ChatEvent, type DisplayMsg, type HomeCardData, type ImageInput } from "../../shared/chat.ts";
import { analyzePurchase, type Profile } from "../../shared/finance.ts";
import { useStored } from "../lib.ts";
import { ListingCard } from "../ListingCard.tsx";

interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
}

const SUGGESTIONS = [
  "Hola, quiero comprar mi primera casa. Hazme las preguntas que necesites.",
  "¿Cuánto puedo permitirme y qué me limita más, los ahorros o el sueldo?",
  "Compara las viviendas que tengo guardadas",
  "¿Qué hipoteca me conviene más, fija o mixta?",
];

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

/** Reduce una captura a 1600 px de lado y la pasa a JPEG: menos tokens y peticiones más ligeras. */
function toImageInput(file: File): Promise<ImageInput> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve({ mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", 0.85).split(",")[1] });
    };
    img.onerror = () => reject(new Error("No he podido leer la imagen."));
    img.src = URL.createObjectURL(file);
  });
}

interface Props {
  profile: Profile;
  aiReady: boolean | null;
  onSimulate: (price: number) => void;
  onProfile: (p: Profile) => void;
}

export function Asistente({ profile, aiReady, onSimulate, onProfile }: Props) {
  const [conversationId, setConversationId] = useStored<string | null>("hs.conversation", null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<{ preview: string; image: ImageInput }[]>([]);
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadConversations = () =>
    fetch("/api/conversations")
      .then((r) => (r.ok ? r.json() : []))
      .then(setConversations)
      .catch(() => {});

  useEffect(() => {
    loadConversations();
  }, []);

  // carga la conversación guardada (si se está escribiendo en ella, no se pisa)
  useEffect(() => {
    if (busy) return;
    if (!conversationId) return setMessages([]);
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { messages: DisplayMsg[] }) => setMessages(d.messages))
      .catch(() => {
        setConversationId(null);
        setMessages([]);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  useEffect(() => () => abort.current?.abort(), []);

  async function addFiles(files: Iterable<File>) {
    for (const f of files) {
      if (!f.type.startsWith("image/")) continue;
      try {
        const image = await toImageInput(f);
        setImages((list) => [...list, { preview: `data:image/jpeg;base64,${image.data}`, image }].slice(0, 5));
      } catch {
        // imagen ilegible: se ignora
      }
    }
  }

  async function send(text: string) {
    const question = text.trim() || (images.length ? "Te paso un anuncio, ¿qué te parece?" : "");
    if (!question || busy) return;
    const attached = images.map((i) => i.image);
    setMessages((all) => [
      ...all,
      { role: "user", text: question, images: attached.length, tools: [], homes: [] },
      { role: "assistant", text: "", images: 0, tools: [], homes: [] },
    ]);
    setInput("");
    setImages([]);
    setBusy(true);
    const patch = (fn: (m: DisplayMsg) => DisplayMsg) => setMessages((all) => all.map((m, i) => (i === all.length - 1 ? fn(m) : m)));
    abort.current = new AbortController();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.current.signal,
        body: JSON.stringify({ conversationId: conversationId ?? undefined, text: question, images: attached.length ? attached : undefined }),
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
          const e = JSON.parse(chunk.slice(6)) as ChatEvent;
          if (e.type === "conversation") setConversationId(e.id);
          else if (e.type === "text") patch((m) => ({ ...m, text: m.text + e.text }));
          else if (e.type === "tool") patch((m) => ({ ...m, tools: [...m.tools, e.name] }));
          else if (e.type === "home") patch((m) => ({ ...m, homes: [...m.homes, { listing: e.listing, savedId: e.savedId }] }));
          else if (e.type === "profile") onProfile(e.profile);
          else if (e.type === "error") patch((m) => ({ ...m, error: e.message }));
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        const message = err instanceof TypeError ? "No hay conexión con el servidor local. ¿Está arrancado?" : (err as Error).message;
        patch((m) => ({ ...m, error: message }));
      }
    } finally {
      setBusy(false);
      loadConversations();
    }
  }

  function homeCard(card: HomeCardData, key: number) {
    const l = toHomeListing(card.listing, card.savedId ?? String(key));
    const p = { ...profile, ccaa: l.ccaa ?? profile.ccaa, newBuild: l.newDevelopment || profile.newBuild };
    return (
      <ListingCard
        key={key}
        listing={l}
        analysis={analyzePurchase(p, l.price)}
        flags={redFlags(l)}
        status={card.savedId ? "guardada" : undefined}
        onSimulate={() => onSimulate(l.price)}
      />
    );
  }

  return (
    <div className="stack">
      {aiReady === false && (
        <p className="note warn">
          Tu bróker necesita una clave de la API de Claude. Copia <code>.env.example</code> a <code>.env</code>, pon tu <code>ANTHROPIC_API_KEY</code> y reinicia.
          El resto de la aplicación funciona sin ella.
        </p>
      )}
      <div className="chat-bar">
        <select
          value={conversationId ?? ""}
          onChange={(e) => setConversationId(e.target.value || null)}
          disabled={busy}
          aria-label="Conversación"
        >
          <option value="">Nueva conversación</option>
          {conversations.map((c) => (
            <option key={c.id} value={c.id}>
              {new Date(c.updatedAt).toLocaleDateString("es-ES", { day: "numeric", month: "short" })} · {c.title}
            </option>
          ))}
        </select>
        {conversationId && (
          <button className="ghost" onClick={() => setConversationId(null)} disabled={busy}>
            + Nueva
          </button>
        )}
      </div>
      <section
        className="panel chat"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(e.dataTransfer.files);
        }}
      >
        {messages.length === 0 && (
          <div className="chat-empty">
            <h2>Habla con tu bróker</h2>
            <p className="muted">
              Cuéntale tu situación y te dirá cuánto puedes comprar. Pégale anuncios de Idealista (texto o captura) y te dirá si te encajan, qué
              alertas tienen y te los guarda. Se acuerda de todo entre conversaciones.
            </p>
            <div className="suggestions">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="ghost" onClick={() => send(s)} disabled={busy || aiReady === false}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => {
          const last = i === messages.length - 1;
          return (
            <div key={i} className={`msg ${m.role}`}>
              {m.tools.length > 0 && <p className="tools">{[...new Set(m.tools)].map((t) => TOOL_LABEL[t] ?? t).join(" · ")}</p>}
              {m.text ? <Markdown text={m.text} /> : last && busy && !m.error ? <p className="muted">Pensando…</p> : null}
              {m.images > 0 && <p className="small">📎 {m.images === 1 ? "1 imagen" : `${m.images} imágenes`}</p>}
              {m.error && <p className="note bad">{m.error}</p>}
              {m.homes.length > 0 && <div className="cards">{m.homes.map(homeCard)}</div>}
            </div>
          );
        })}
        <div ref={end} />
        {images.length > 0 && (
          <div className="attachments">
            {images.map((img, i) => (
              <button key={i} className="attachment" title="Quitar" onClick={() => setImages((list) => list.filter((_, j) => j !== i))}>
                <img src={img.preview} alt={`Adjunto ${i + 1}`} />
                <span aria-hidden>×</span>
              </button>
            ))}
          </div>
        )}
        <form
          className="chat-input"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <button type="button" className="ghost" title="Adjuntar captura" onClick={() => fileInput.current?.click()} disabled={busy}>
            📎
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onPaste={(e) => {
              const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
              if (files.length) {
                e.preventDefault();
                addFiles(files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
            rows={2}
            placeholder="Escribe, pega el texto de un anuncio o una captura (Ctrl+V)…"
          />
          {busy ? (
            <button type="button" className="ghost" onClick={() => abort.current?.abort()}>
              Parar
            </button>
          ) : (
            <button type="submit" disabled={!input.trim() && images.length === 0}>
              Enviar
            </button>
          )}
        </form>
      </section>
    </div>
  );
}
