// Importar un anuncio desde el navegador del usuario (marcador «Guardar en Bróker IA»).
//
// El agente no abre enlaces, y el servidor tampoco: los portales bloquean a los bots y sus condiciones
// prohíben el scraping. Quien lee la página es el usuario, en su navegador, con un marcador (bookmarklet):
// toma el texto del anuncio que tiene abierto y abre la app con ese texto en el fragmento de la URL
// (#importar=…), que nunca sale del navegador. La app lo manda al chat como si lo hubiera pegado.
//
// Cualquier web podría abrir la app con un #importar= inventado, así que el marcador lleva una clave que
// solo conoce este navegador (localStorage de la app). Sin la clave correcta el texto se deja escrito en
// el cuadro del chat para que el usuario lo revise, y no se envía.

/** Lo que el marcador lee de la página. */
export interface PageImport {
  url: string;
  title: string;
  text: string;
  /** el usuario tenía texto seleccionado y se ha usado solo eso */
  selection?: boolean;
}

/** Máximo de texto que se importa: el anuncio cabe de sobra y no se manda al modelo la página entera. */
export const IMPORT_MAX_CHARS = 8000;

export const IMPORT_HASH = "#importar=";

/**
 * Código del marcador. `appUrl` es la dirección de la app (location.origin), `user` el usuario de la
 * pestaña donde se creó y `token` la clave de este navegador. El código va entero en el href.
 */
export function bookmarkletCode(appUrl: string, user: string, token: string): string {
  const app = JSON.stringify(`${appUrl.replace(/\/$/, "")}/?u=${encodeURIComponent(user)}`);
  const body = `(function(){
var sel=String(window.getSelection?getSelection():"").trim();
var root=document.querySelector("main,[role=main],#main,article");
var text=sel.length>200?sel:((root&&root.innerText.length>500?root:document.body).innerText||"");
text=text.replace(/[ \\t]+/g," ").replace(/\\n\\s*\\n\\s*/g,"\\n\\n").trim().slice(0,${IMPORT_MAX_CHARS});
var data={k:${JSON.stringify(token)},url:location.href,title:document.title,text:text,selection:sel.length>200};
var w=window.open(${app}+"${IMPORT_HASH}"+encodeURIComponent(JSON.stringify(data)),"broker-ia");
if(!w)alert("Tu navegador ha bloqueado la ventana de Bróker IA. Permite las ventanas emergentes de esta web y vuelve a pulsar el marcador.");
})();`;
  return `javascript:${encodeURIComponent(body.replace(/\n/g, ""))}`;
}

/** Lee el fragmento #importar=… que deja el marcador. null si no es una importación válida. */
export function parseImportHash(hash: string): { token: string; page: PageImport } | null {
  if (!hash.startsWith(IMPORT_HASH)) return null;
  try {
    const d = JSON.parse(decodeURIComponent(hash.slice(IMPORT_HASH.length))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const url = str(d.url);
    const text = str(d.text).trim().slice(0, IMPORT_MAX_CHARS);
    if (!/^https?:\/\//.test(url) || !text) return null;
    return { token: str(d.k), page: { url, title: str(d.title).trim().slice(0, 200), text, selection: d.selection === true } };
  } catch {
    return null;
  }
}

/**
 * Mensaje del chat con la página importada. Pulsar «Guardar en Bróker IA» es pedir que se guarde, así
 * que el mensaje lo dice («Guarda este anuncio»): el anuncio se analiza y se guarda en el mismo turno.
 * El título va delante porque suele ser «Piso en venta en …» y de ahí sale el nombre de la vivienda.
 */
export function importMessage(p: PageImport): string {
  let host = "";
  try {
    host = new URL(p.url).hostname.replace(/^www\./, "");
  } catch {
    // url ya validada en parseImportHash
  }
  const title = p.title.replace(/\s*[—|-]\s*(idealista|fotocasa|habitaclia|pisos\.com)[^—|]*$/i, "").trim();
  return [`Guarda este anuncio${host ? ` de ${host}` : ""}: ${p.url}`, title, p.text].filter(Boolean).join("\n\n");
}
