import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { redFlags, sameListingUrl, toHomeListing } from "../shared/broker.ts";
import { TOOL_LABEL, type ChatEvent, type DisplayMsg, type HomeCardData, type ImageInput } from "../shared/chat.ts";
import { analyzePurchase, type Profile } from "../shared/finance.ts";
import type { HomesStore, Provider } from "./lib.ts";
import { ListingCard } from "./ListingCard.tsx";
import { Mascot, type Mood } from "./Mascot.tsx";

/** Markdown mínimo (negritas, cursivas, listas, títulos y enlaces) sin inyectar HTML. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|_[^_\n]+_|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.length > 2 && part.startsWith("_") && part.endsWith("_")) return <em key={i}>{part.slice(1, -1)}</em>;
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

const blank = (role: DisplayMsg["role"], text = "", images = 0): DisplayMsg => ({ role, text, images, tools: [], homes: [] });

interface Props {
  profile: Profile;
  known: boolean | null;
  provider: Provider | null;
  conversationId: string | null;
  onConversation: (id: string) => void;
  /** al terminar cada turno: recargar conversaciones, perfil y viviendas */
  onTurnDone: () => void;
  onProfileChanged: () => void;
  homes: HomesStore;
  onSimulate: (price: number) => void;
  /** texto para dejar escrito en el cuadro (desde el panel «Lo que sé de ti») */
  seed: { text: string; n: number; send?: boolean; notice?: string } | null;
}

export function Chat({ profile, known, provider, conversationId, onConversation, onTurnDone, onProfileChanged, homes, onSimulate, seed }: Props) {
  const [messages, setMessages] = useState<DisplayMsg[]>([]);
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [images, setImages] = useState<{ preview: string; image: ImageInput }[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);
  /** el turno acaba de terminar bien: la casita lo celebra un momento */
  const [cheer, setCheer] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const box = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  /** id que acaba de crear este componente: no hay que volver a cargarlo del servidor */
  const ownId = useRef<string | null>(null);
  const vision = provider?.vision ?? false;

  useEffect(() => {
    if (conversationId === ownId.current) return;
    abort.current?.abort();
    setExpanded(new Set());
    stick.current = true;
    if (!conversationId) return setMessages([]);
    setLoading(true);
    fetch(`/api/conversations/${conversationId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { messages: DisplayMsg[] }) => setMessages(d.messages))
      .catch(() => setMessages([]))
      .finally(() => setLoading(false));
  }, [conversationId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, loading]);
  useEffect(() => () => abort.current?.abort(), []);

  const resize = () => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };
  useEffect(resize, [input]);

  useEffect(() => {
    if (!cheer) return;
    const t = setTimeout(() => setCheer(false), 2400);
    return () => clearTimeout(t);
  }, [cheer]);

  /** último seed atendido: StrictMode ejecuta los efectos dos veces y un anuncio importado se enviaría dos */
  const seen = useRef(0);
  useEffect(() => {
    if (!seed || seen.current === seed.n) return;
    seen.current = seed.n;
    if (seed.notice) setNotice(seed.notice);
    if (seed.send) return void send(seed.text);
    setInput(seed.text);
    requestAnimationFrame(() => {
      box.current?.focus();
      box.current?.setSelectionRange(seed.text.length, seed.text.length);
    });
  }, [seed]);

  async function addFiles(files: Iterable<File>) {
    const list = [...files].filter((f) => f.type.startsWith("image/"));
    if (!list.length) return;
    if (!vision) return setNotice("Para leer capturas hace falta Claude. Con la IA local, copia el texto del anuncio (Ctrl+A y Ctrl+C en la página) y pégalo aquí.");
    for (const f of list) {
      try {
        const image = await toImageInput(f);
        setImages((all) => [...all, { preview: `data:image/jpeg;base64,${image.data}`, image }].slice(0, 5));
      } catch {
        setNotice("No he podido leer esa imagen.");
      }
    }
  }

  async function send(text: string) {
    const question = text.trim() || (images.length ? "Te paso un anuncio, ¿qué te parece?" : "");
    if (!question || busy) return;
    const attached = images.map((i) => i.image);
    stick.current = true;
    setMessages((all) => [...all, blank("user", question, attached.length), blank("assistant")]);
    setInput("");
    setImages([]);
    setNotice(null);
    setCheer(false);
    setBusy(true);
    let failed = false;
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
          if (e.type === "conversation") {
            ownId.current = e.id;
            onConversation(e.id);
          } else if (e.type === "text") patch((m) => ({ ...m, text: m.text + e.text }));
          else if (e.type === "tool") patch((m) => ({ ...m, tools: [...m.tools, e.name] }));
          else if (e.type === "home") {
            patch((m) => ({ ...m, homes: [...m.homes.filter((h) => h.listing.title !== e.listing.title || h.listing.price !== e.listing.price), { listing: e.listing, savedId: e.savedId }] }));
            if (e.savedId) homes.reload();
          } else if (e.type === "profile") onProfileChanged();
          else if (e.type === "error") {
            failed = true;
            patch((m) => ({ ...m, error: e.message }));
          }
        }
      }
    } catch (err) {
      failed = true;
      if ((err as Error).name !== "AbortError") {
        const message = err instanceof TypeError ? "No hay conexión con el servidor. ¿Está arrancado?" : (err as Error).message;
        patch((m) => ({ ...m, error: message }));
      }
    } finally {
      setBusy(false);
      if (!failed) setCheer(true);
      onTurnDone();
      box.current?.focus();
    }
  }

  function homeCard(card: HomeCardData, key: number) {
    const saved = homes.homes.find(
      (h) =>
        h.id === card.savedId ||
        (card.listing.url != null && sameListingUrl(h.listing.url, card.listing.url)) ||
        (h.listing.title === card.listing.title && h.listing.price === Math.round(card.listing.price)),
    );
    const l = toHomeListing(card.listing, saved?.id ?? `card-${key}`);
    const p = { ...profile, ccaa: l.ccaa ?? profile.ccaa, newBuild: l.newDevelopment || profile.newBuild };
    return (
      <ListingCard
        key={key}
        listing={l}
        analysis={analyzePurchase(p, l.price)}
        flags={redFlags(l)}
        status={saved?.status}
        onStatus={saved ? (status) => homes.patch(saved.id, { status }) : undefined}
        onSave={() => homes.save(card.listing)}
        onSimulate={() => onSimulate(l.price)}
      />
    );
  }

  // Cada vivienda se pinta una vez por conversación: al guardarla, su tarjeta (la de arriba) pasa a «guardada».
  const shown = new Set<string>();
  const firstTime = (card: HomeCardData) => {
    const key = `${card.listing.title}|${Math.round(card.listing.price)}`;
    if (shown.has(key)) return false;
    shown.add(key);
    return true;
  };

  const lastUserText = [...messages].reverse().find((m) => m.role === "user")?.text;
  const empty = messages.length === 0 && !loading;
  // cara de la casita: piensa hasta que llega texto, habla mientras escribe y celebra al terminar
  const lastMsg = messages[messages.length - 1];
  const mood: Mood = busy ? (lastMsg?.text ? "talking" : "thinking") : lastMsg?.error ? "worried" : cheer ? "happy" : "idle";
  const doing = busy && lastMsg && !lastMsg.text ? `${TOOL_LABEL[lastMsg.tools[lastMsg.tools.length - 1]] ?? "Pensando"}…` : null;

  return (
    <section
      className={`chat${dragging ? " dragging" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <div
        className="chat-scroll"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="chat-column">
          {empty && (
            <div className="welcome">
              <div className="hero-mascot">
                <Mascot size={136} live />
              </div>
              <h2>{known ? "¿Qué miramos hoy?" : "Hola, soy tu bróker"}</h2>
              <p className="muted">
                {known
                  ? "Pégame un anuncio, pregúntame por tu presupuesto o cuéntame si algo ha cambiado."
                  : "Te digo cuánto puedes comprar, reviso los anuncios que encuentres y te ayudo con la hipoteca. Me acuerdo de todo entre conversaciones."}
              </p>
              <div className="starters">
                {!known && (
                  <button className="starter primary" onClick={() => send("Hola, quiero comprar mi primera casa")} disabled={busy}>
                    <strong>Empezar</strong>
                    <span>Unas pocas preguntas sobre ahorros y sueldo, y te doy tu presupuesto</span>
                  </button>
                )}
                <button
                  className="starter"
                  onClick={() => {
                    box.current?.focus();
                    setNotice("Abre el anuncio en Idealista, selecciona todo (Ctrl+A), copia (Ctrl+C) y pega aquí (Ctrl+V).");
                  }}
                >
                  <strong>Revisar un anuncio</strong>
                  <span>Pega el texto{vision ? " o una captura" : ""} y te digo si te encaja, el coste real y las alertas</span>
                </button>
                {known && (
                  <button className="starter" onClick={() => send("¿Cuánto puedo permitirme?")} disabled={busy}>
                    <strong>Mi presupuesto</strong>
                    <span>Precio máximo y qué te limita, ahorros o sueldo</span>
                  </button>
                )}
                {known && homes.homes.some((h) => h.status !== "descartada") && (
                  <button className="starter" onClick={() => send("Compara mis viviendas guardadas")} disabled={busy}>
                    <strong>Comparar mis viviendas</strong>
                    <span>Recalculadas con tu situación de hoy</span>
                  </button>
                )}
                <button className="starter" onClick={() => send("¿Qué hipoteca me conviene?")} disabled={busy}>
                  <strong>Hipotecas</strong>
                  <span>Las cuotas más bajas para lo que puedes pedir</span>
                </button>
              </div>
            </div>
          )}
          {loading && <p className="muted center">Cargando conversación…</p>}

          {messages.map((m, i) => {
            const last = i === messages.length - 1;
            const working = last && busy && m.role === "assistant";
            if (m.role === "user") {
              const long = m.text.length > 420;
              const open = expanded.has(i);
              return (
                <div key={i} className="msg user">
                  <p className={long && !open ? "clamp" : undefined}>{m.text}</p>
                  {long && (
                    <button className="link on-accent" onClick={() => setExpanded((s) => new Set(open ? [...s].filter((x) => x !== i) : [...s, i]))}>
                      {open ? "Ver menos" : "Ver todo"}
                    </button>
                  )}
                  {m.images > 0 && <p className="small">📎 {m.images === 1 ? "1 captura" : `${m.images} capturas`}</p>}
                </div>
              );
            }
            const steps = [...new Set(m.tools)];
            const cards = m.homes.filter(firstTime);
            return (
              <div key={i} className="msg assistant">
                <span className="avatar">
                  <Mascot size={36} mood={working ? mood : m.error ? "worried" : "idle"} />
                </span>
                <div className="msg-body">
                  {steps.length > 0 && (
                    <p className="steps">
                      {steps.map((t, j) => (
                        <span key={t} className={`step${working && j === steps.length - 1 && !m.text ? " active" : ""}`}>
                          {TOOL_LABEL[t] ?? t}
                        </span>
                      ))}
                    </p>
                  )}
                  {m.text && <Markdown text={m.text} />}
                  {working && !m.text && (
                    <p className="typing" aria-label="Escribiendo">
                      <i />
                      <i />
                      <i />
                    </p>
                  )}
                  {cards.length > 0 && <div className="cards">{cards.map((c, j) => homeCard(c, i * 100 + j))}</div>}
                  {m.error && (
                    <p className="note bad">
                      {m.error}{" "}
                      {last && lastUserText && !busy && (
                        <button className="link" onClick={() => send(lastUserText)}>
                          Reintentar
                        </button>
                      )}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="composer-wrap">
        <div className="chat-column">
          {(!empty || notice) && (
            <div className={`companion${empty ? " bare" : ""}`}>
              {!empty && <Mascot size={62} mood={mood} live />}
              {notice ? (
                <p className="bubble">
                  {notice}
                  <button className="link" onClick={() => setNotice(null)} aria-label="Cerrar aviso">
                    Entendido
                  </button>
                </p>
              ) : (
                doing && (
                  <p className="bubble doing" aria-live="polite">
                    {doing}
                  </p>
                )
              )}
            </div>
          )}
          {images.length > 0 && (
            <div className="attachments">
              {images.map((img, i) => (
                <button key={i} className="attachment" title="Quitar" onClick={() => setImages((all) => all.filter((_, j) => j !== i))}>
                  <img src={img.preview} alt={`Captura ${i + 1}`} />
                  <span aria-hidden>×</span>
                </button>
              ))}
            </div>
          )}
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {vision && (
              <button type="button" className="icon" title="Adjuntar captura del anuncio" onClick={() => fileInput.current?.click()} disabled={busy}>
                📎
              </button>
            )}
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
              ref={box}
              value={input}
              rows={1}
              autoFocus
              onChange={(e) => setInput(e.target.value)}
              onPaste={(e) => {
                const files = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
                if (files.length) {
                  e.preventDefault();
                  addFiles(files);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(input);
                }
              }}
              placeholder={known ? "Escribe o pega un anuncio…" : "Cuéntame tu situación o pega un anuncio…"}
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
          <p className="composer-hint">
            {provider ? <span title={provider.hint ?? undefined}>{provider.label}</span> : "Conectando…"} · Enter envía, Mayús+Enter salto de línea · Los cálculos
            son orientativos
          </p>
        </div>
      </div>
      {dragging && <div className="drop-hint">Suelta la captura del anuncio</div>}
    </section>
  );
}
