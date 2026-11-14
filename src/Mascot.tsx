import { useEffect, useRef, useState } from "react";

/** Estado de ánimo de la casita. Lo decide quien la pinta (el chat sabe si está pensando o hablando). */
export type Mood = "idle" | "thinking" | "talking" | "happy" | "worried" | "sleeping";

interface Props {
  mood?: Mood;
  size?: number;
  /** viva: sigue el puntero con la mirada, parpadea, se duerme si no pasa nada y reacciona al clic */
  live?: boolean;
}

/** tiempo sin actividad antes de dormirse */
const SLEEP_AFTER = 90_000;
/** unidades del viewBox que se desplazan los ojos como máximo */
const LOOK = 3.2;

/**
 * La mascota del bróker: una casita con ojos. Es decorativa (aria-hidden): todo lo que
 * comunica con su cara también está escrito en la interfaz.
 */
export function Mascot({ mood = "idle", size = 40, live = false }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const [asleep, setAsleep] = useState(false);
  const [poked, setPoked] = useState(false);

  useEffect(() => {
    if (!live) return;
    let frame = 0;
    let timer = 0;
    const wake = () => {
      setAsleep(false);
      clearTimeout(timer);
      timer = window.setTimeout(() => setAsleep(true), SLEEP_AFTER);
    };
    const look = (e: PointerEvent) => {
      wake();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const el = svg.current;
        if (!el) return;
        const box = el.getBoundingClientRect();
        const dx = e.clientX - (box.left + box.width / 2);
        const dy = e.clientY - (box.top + box.height * 0.62);
        const dist = Math.hypot(dx, dy) || 1;
        const reach = Math.min(1, dist / 180) * LOOK;
        el.style.setProperty("--look-x", `${((dx / dist) * reach).toFixed(2)}px`);
        el.style.setProperty("--look-y", `${((dy / dist) * reach).toFixed(2)}px`);
      });
    };
    wake();
    window.addEventListener("pointermove", look, { passive: true });
    window.addEventListener("keydown", wake);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      window.removeEventListener("pointermove", look);
      window.removeEventListener("keydown", wake);
    };
    // al cambiar de ánimo se reinicia la cuenta: no se duerme justo después de contestar
  }, [live, mood]);

  useEffect(() => {
    if (!poked) return;
    const t = setTimeout(() => setPoked(false), 900);
    return () => clearTimeout(t);
  }, [poked]);

  const shown: Mood = mood !== "idle" ? mood : poked ? "happy" : asleep ? "sleeping" : "idle";

  return (
    <svg
      ref={svg}
      className={`mascot mood-${shown}${live ? " live" : ""}`}
      viewBox="0 0 120 120"
      width={size}
      height={size}
      aria-hidden
      onClick={live ? () => setPoked(true) : undefined}
    >
      <ellipse className="m-shadow" cx="60" cy="111" rx="30" ry="4" />
      <g className="m-body">
        <g className="m-smoke">
          <circle cx="84" cy="12" r="4" />
          <circle cx="84" cy="12" r="4" />
          <circle cx="84" cy="12" r="4" />
        </g>
        <g className="m-zzz">
          <text x="94" y="34">z</text>
          <text x="102" y="22">z</text>
        </g>
        <rect className="m-chimney" x="78" y="16" width="13" height="30" rx="3" />
        <rect className="m-wall" x="24" y="48" width="72" height="58" rx="15" />
        <path className="m-roof" d="M60 16 L104 55 H16 Z" />
        <path className="m-shine" d="M58 26 L36 46" />

        <g className="m-eyes">
          <g className="m-eye">
            <ellipse cx="46" cy="77" rx="5.5" ry="7" />
            <circle className="m-glint" cx="44.2" cy="74.2" r="1.9" />
          </g>
          <g className="m-eye">
            <ellipse cx="74" cy="77" rx="5.5" ry="7" />
            <circle className="m-glint" cx="72.2" cy="74.2" r="1.9" />
          </g>
        </g>
        <path className="m-line m-joy" d="M40 80 q6 -8 12 0 M68 80 q6 -8 12 0" />
        <path className="m-line m-shut" d="M40 77 q6 5 12 0 M68 77 q6 5 12 0" />
        <path className="m-line m-brows" d="M39 66 l10 -3.5 M81 66 l-10 -3.5" />
        <circle className="m-cheek" cx="35" cy="89" r="5" />
        <circle className="m-cheek" cx="85" cy="89" r="5" />

        <path className="m-line m-smile" d="M53 89 q7 7 14 0" />
        <path className="m-fill m-grin" d="M51 87 q9 13 18 0 z" />
        <ellipse className="m-fill m-talk" cx="60" cy="92" rx="5" ry="4.5" />
        <circle className="m-fill m-o" cx="60" cy="92" r="3" />
        <path className="m-line m-frown" d="M53 94 q7 -6 14 0" />
      </g>
    </svg>
  );
}
