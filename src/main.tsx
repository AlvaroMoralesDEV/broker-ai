import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import { installUserHeader, refreshRates } from "./lib.ts";
import "./styles.css";
import "./broker.css";
import "./mascot.css";

// cada llamada a /api lleva el usuario de esta pestaña
installUserHeader();
// los tipos de los bancos, antes de pintar nada que calcule con ellos
await refreshRates();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
