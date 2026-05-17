"use client";

import { useEffect } from "react";
import { X, ChevronRight } from "lucide-react";

export type InstructionKind = "reference" | "polygon";

interface Props {
  kind: InstructionKind;
  onContinue: () => void;
  /** When auto-mode is active (subsequent walls), the modal shows a
   *  shorter copy that omits the "set reference" step. */
  autoMode?: boolean;
}

/**
 * Full-screen instruction overlay with an SVG animation. Shown between
 * the photo capture and the corresponding interaction step (reference
 * line or polygon). The user taps a single button to dismiss it.
 */
export default function InstructionModal({ kind, onContinue, autoMode }: Props) {
  // Disable background scrolling while the modal is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const isReference = kind === "reference";

  return (
    <div className="absolute inset-0 z-40 flex flex-col bg-slate-900/85 backdrop-blur-sm">
      <div className="flex-1 flex flex-col px-5 pt-6 pb-4 overflow-hidden">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-widest text-blue-200">
            {isReference ? "Vaihe 2 / 3" : "Vaihe 3 / 3"}
          </span>
          <button
            onClick={onContinue}
            className="p-1.5 rounded-full text-white/70 hover:text-white hover:bg-white/10"
            aria-label="Sulje"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <h2 className="mt-3 text-2xl font-bold text-white leading-tight">
          {isReference
            ? "Piirrä referenssimitta"
            : "Rajaa maalattava alue"}
        </h2>

        <p className="mt-1.5 text-sm text-blue-100/90">
          {isReference
            ? "Anna sovellukselle yksi tunnettu mitta leveyssuunnassa: mittaa aina vaakasuoraan (esim. oven leveys ~90 cm). Sovellus lukitsee viivan vaakasuoraksi."
            : "Klikkaa talon nurkat järjestyksessä myötäpäivään: alanurkka → yläkulmat → harja → toinen yläkulma → alanurkka."}
        </p>

        {/* Animation */}
        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <div className="w-full max-w-[280px] aspect-square">
            {isReference ? <ReferenceAnim /> : <PolygonAnim />}
          </div>
        </div>

        {/* Tip strip */}
        <div className="mt-3 mb-3 rounded-xl bg-white/10 border border-white/15 px-3 py-2.5 text-xs text-blue-50 flex items-start gap-2">
          <span className="text-base leading-none">💡</span>
          <span>
            {isReference ? (
              <>
                Vinkki: <strong>Vaakasuora</strong> viiva (oven yläreuna,
                sokkeli) — älä mittaa pystysuorassa. Viiva lukittuu vaakasuoraan
                ja pisteet voivat snäpätä tunnistettuun reunaan. Zoomaa sormilla.
              </>
            ) : (
              <>
                Vinkki: Sovellus <strong>napsauttaa pisteet talon reunoille</strong>{" "}
                automaattisesti. Vihreä = nurkka, syaani = viiva.
              </>
            )}
          </span>
        </div>

        <button
          onClick={onContinue}
          className="w-full py-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold text-base shadow-lg shadow-blue-900/40 flex items-center justify-center gap-2"
        >
          {autoMode && isReference
            ? "Hyppää suoraan rajaukseen"
            : "Selvä, jatketaan"}
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Inline SVG animations. Both use the same little stylised house and replay
// every 4 s. Kept deliberately small (~150 lines) so they don't pull in any
// extra runtime dependency.

function HouseSilhouette() {
  return (
    <>
      {/* Wall */}
      <rect
        x="40"
        y="80"
        width="160"
        height="100"
        fill="#1e3a8a"
        stroke="#3b82f6"
        strokeWidth="1.5"
        rx="2"
      />
      {/* Roof (gable) */}
      <polygon
        points="40,80 200,80 120,30"
        fill="#1e293b"
        stroke="#3b82f6"
        strokeWidth="1.5"
      />
      {/* Door */}
      <rect
        x="105"
        y="125"
        width="30"
        height="55"
        fill="#0f172a"
        stroke="#60a5fa"
        strokeWidth="1"
        rx="1"
      />
      {/* Windows */}
      <rect
        x="60"
        y="100"
        width="25"
        height="20"
        fill="#0f172a"
        stroke="#60a5fa"
        strokeWidth="1"
      />
      <rect
        x="155"
        y="100"
        width="25"
        height="20"
        fill="#0f172a"
        stroke="#60a5fa"
        strokeWidth="1"
      />
    </>
  );
}

function ReferenceAnim() {
  // Reference line is drawn across the door (~30px wide, labelled "0,9 m").
  // Two animated dots mark the start/end, then the line grows between them.
  return (
    <svg
      viewBox="0 0 240 200"
      className="w-full h-full"
      role="img"
      aria-label="Animaatio referenssimitan piirtämisestä oven leveydeltä"
    >
      <HouseSilhouette />

      {/* Animated reference line (door width = 30px = 0.9 m) */}
      <g style={{ animation: "pulse-soft 4s ease-in-out infinite" }}>
        <line
          x1="105"
          y1="118"
          x2="135"
          y2="118"
          stroke="#fbbf24"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="40"
          strokeDashoffset="40"
          style={{
            ["--len" as unknown as keyof React.CSSProperties]: "40",
            animation: "draw-line 4s ease-in-out infinite both",
          } as React.CSSProperties}
        />
        {/* Endpoints */}
        <circle
          cx="105"
          cy="118"
          r="5"
          fill="#fbbf24"
          stroke="white"
          strokeWidth="2"
          style={{
            transformOrigin: "105px 118px",
            animation: "pop-dot 4s ease-out infinite both",
          }}
        />
        <circle
          cx="135"
          cy="118"
          r="5"
          fill="#fbbf24"
          stroke="white"
          strokeWidth="2"
          style={{
            transformOrigin: "135px 118px",
            animation: "pop-dot 4s ease-out infinite both",
            animationDelay: "0.6s",
          }}
        />
        {/* Label */}
        <g
          style={{
            animation: "fade-label 4s ease-out infinite both",
          }}
        >
          <rect
            x="98"
            y="98"
            width="44"
            height="16"
            rx="4"
            fill="white"
            stroke="#fbbf24"
            strokeWidth="1.5"
          />
          <text
            x="120"
            y="110"
            textAnchor="middle"
            fontSize="11"
            fontWeight="700"
            fill="#b45309"
          >
            0,9 m
          </text>
        </g>
      </g>

      {/* Caption */}
      <text
        x="120"
        y="195"
        textAnchor="middle"
        fontSize="10"
        fill="#cbd5e1"
        fontWeight="500"
      >
        Esim. oven leveys = 0,9 m
      </text>
    </svg>
  );
}

function PolygonAnim() {
  // Five points placed in sequence (clockwise, with ridge) at:
  //   1 (40,180)  2 (40,80)  3 (120,30)  4 (200,80)  5 (200,180)
  // Each appears with a small delay; the polygon line follows.
  const pts: [number, number][] = [
    [40, 180],
    [40, 80],
    [120, 30],
    [200, 80],
    [200, 180],
  ];
  const pathPoints = pts.map(([x, y]) => `${x},${y}`).join(" ");

  return (
    <svg
      viewBox="0 0 240 200"
      className="w-full h-full"
      role="img"
      aria-label="Animaatio talon rajauksesta klikkaamalla nurkat"
    >
      <HouseSilhouette />

      {/* Polygon line — drawn after the dots */}
      <polygon
        points={pathPoints}
        fill="rgba(34, 197, 94, 0.15)"
        stroke="#22c55e"
        strokeWidth="2.5"
        strokeLinejoin="round"
        strokeDasharray="500"
        strokeDashoffset="500"
        style={{
          ["--len" as unknown as keyof React.CSSProperties]: "500",
          animation: "draw-line 4s ease-in-out infinite both",
          animationDelay: "0.5s",
        } as React.CSSProperties}
      />

      {/* Dots — each pops in sequence */}
      {pts.map(([x, y], i) => (
        <circle
          key={i}
          cx={x}
          cy={y}
          r="6"
          fill="#22c55e"
          stroke="white"
          strokeWidth="2"
          style={{
            transformOrigin: `${x}px ${y}px`,
            animation: "pop-dot 4s ease-out infinite both",
            animationDelay: `${i * 0.5}s`,
          }}
        />
      ))}

      {/* Index labels */}
      {pts.map(([x, y], i) => (
        <text
          key={`l-${i}`}
          x={x}
          y={y + 2}
          textAnchor="middle"
          fontSize="9"
          fontWeight="700"
          fill="white"
          style={{
            animation: "pop-dot 4s ease-out infinite both",
            animationDelay: `${i * 0.5}s`,
          }}
        >
          {i + 1}
        </text>
      ))}

      {/* Caption */}
      <text
        x="120"
        y="195"
        textAnchor="middle"
        fontSize="10"
        fill="#cbd5e1"
        fontWeight="500"
      >
        Klikkaa nurkat 1 → 5
      </text>
    </svg>
  );
}
