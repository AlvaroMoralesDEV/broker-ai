// Cliente de prueba del chat por terminal:  node scripts/chat.mjs [url] "mensaje 1" "mensaje 2" ...
// Mantiene la conversación entre mensajes y muestra herramientas, texto y tiempo de cada turno.
const [first, ...rest] = process.argv.slice(2);
const base = first?.startsWith("http") ? first : "http://127.0.0.1:8787";
const messages = first?.startsWith("http") ? rest : [first, ...rest];
let conversationId;
for (const text of messages) {
  const t0 = Date.now();
  const res = await fetch(`${base}/api/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, conversationId }) });
  let out = "", tools = [], cards = 0, firstByte = 0;
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      if (!p.startsWith("data: ")) continue;
      const e = JSON.parse(p.slice(6));
      if (e.type === "text") { firstByte ||= Date.now() - t0; out += e.text; }
      else if (e.type === "tool") tools.push(e.name);
      else if (e.type === "home") cards++;
      else if (e.type === "conversation") conversationId = e.id;
      else if (e.type === "error") out += `\n[ERROR] ${e.message}`;
    }
  }
  console.log(`\n\x1b[36m> ${text.slice(0, 90)}${text.length > 90 ? "…" : ""}\x1b[0m`);
  console.log(`[herramientas: ${tools.join(", ") || "-"} · tarjetas: ${cards} · primer texto ${firstByte} ms · total ${Date.now() - t0} ms]`);
  console.log(out);
}
