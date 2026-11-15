import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikeListing, parseListingText } from "./extract.ts";
import { IMPORT_HASH, IMPORT_MAX_CHARS, bookmarkletCode, importMessage, parseImportHash } from "./importer.ts";

const page = {
  url: "https://www.idealista.com/inmueble/12345678/",
  title: "Piso en venta en calle de Toledo, Embajadores-Lavapiés, Madrid — idealista",
  text: "Piso en venta en calle de Toledo\nEmbajadores-Lavapiés, Madrid\n289.000 €\n78 m² 3 hab. Planta 2ª exterior con ascensor\nComunidad 90 €/mes",
};

const hashOf = (data: unknown) => IMPORT_HASH + encodeURIComponent(JSON.stringify(data));

test("bookmarklet: es una URL javascript: con código válido, la app, el usuario y la clave", () => {
  const code = bookmarkletCode("http://localhost:8787/", "ana", "clave-123");
  assert.ok(code.startsWith("javascript:"));
  const js = decodeURIComponent(code.slice("javascript:".length));
  assert.doesNotThrow(() => new Function(js), "el navegador tiene que poder ejecutarlo");
  assert.match(js, /"http:\/\/localhost:8787\/\?u=ana"/);
  assert.match(js, /"clave-123"/);
  assert.match(js, new RegExp(`slice\\(0,${IMPORT_MAX_CHARS}\\)`));
  // ni saltos de línea ni espacios sin codificar: hay navegadores que los recortan del marcador
  assert.doesNotMatch(code, /[\n ]/);
});

test("bookmarklet: un usuario o una clave con comillas no rompen el código", () => {
  const js = decodeURIComponent(bookmarkletCode("http://localhost:5173", 'a"b', 'x"); alert(1); ("').slice("javascript:".length));
  assert.doesNotThrow(() => new Function(js));
});

test("parseImportHash: lee lo que deja el marcador", () => {
  const r = parseImportHash(hashOf({ k: "clave", ...page, selection: false }));
  assert.equal(r?.token, "clave");
  assert.equal(r?.page.url, page.url);
  assert.equal(r?.page.text, page.text);
  assert.equal(r?.page.selection, false);
});

test("parseImportHash: rechaza lo que no es una importación", () => {
  assert.equal(parseImportHash("#viviendas"), null);
  assert.equal(parseImportHash(IMPORT_HASH + "%7Bnope"), null, "JSON roto");
  assert.equal(parseImportHash(hashOf({ k: "x", url: "javascript:alert(1)", title: "", text: "hola" })), null, "solo http(s)");
  assert.equal(parseImportHash(hashOf({ k: "x", url: page.url, title: "", text: "   " })), null, "sin texto");
  assert.equal(parseImportHash(hashOf({ k: "x", url: page.url, title: "", text: "a".repeat(20000) }))?.page.text.length, IMPORT_MAX_CHARS);
});

test("importMessage: pide guardar, lleva el enlace y se lee como un anuncio", () => {
  const msg = importMessage(page);
  assert.match(msg, /^Guarda este anuncio de idealista\.com: https:\/\/www\.idealista\.com\/inmueble\/12345678\//);
  assert.doesNotMatch(msg, /— idealista/, "sin el nombre del portal en el título");
  assert.ok(looksLikeListing(msg));
  const l = parseListingText(msg)!;
  assert.equal(l.price, 289000);
  assert.equal(l.size, 78);
  assert.equal(l.rooms, 3);
  assert.equal(l.url, page.url);
  assert.equal(l.municipality, "Madrid");
});
