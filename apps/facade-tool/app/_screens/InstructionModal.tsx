"use client";

import { useEffect } from "react";
import { X, ChevronRight } from "lucide-react";

export type InstructionKind = "reference" | "polygon";

interface Props {
  kind: InstructionKind;
  onContinue: () => void;
  /** Wall 2+: reference step was skipped; polygon uses stored corner height. */
  autoMode?: boolean;
}

/**
 * Full-screen instruction overlay with an SVG animation. Shown between
 * the photo capture and the corresponding interaction step (reference
 * line or polygon). The user taps a single button to dismiss it.
 */
export default function InstructionModal({ kind, onContinue, autoMode }: Props) {
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
            {isReference ? "Referenssimitta" : autoMode ? "Rajaus (automaattinen)" : "Rajaus"}
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
            ? "Anna yksi tunnettu leveys"
            : autoMode
              ? "Rajaa tämän seinän nurkat"
              : "Rajaa maalattava alue"}
        </h2>

        <p className="mt-1.5 text-sm text-blue-100/90 leading-relaxed">
          {isReference ? (
            <>
              <strong>Napauta oven tai ikkunan sisään</strong> (tumma alue
              viivakuvassa) — vaakaviiva syntyy automaattisesti. Syötä sitten
              aukon leveys metreissä (esim. ovi 0,9 m). Jos tunnistus epäonnistuu,
              käytä kahta napautusta (alku → loppu).
            </>
          ) : autoMode ? (
            <>
              Ensimmäisellä seinällä annoit referenssin — sovellus käyttää nyt{" "}
              <strong>tallennettua nurkkakorkeutta</strong> mittakaavana. Klikkaa
              vähintään kolme nurkkaa talon ulkoreunalle (aloita mieluiten
              pystysuoralta sivulta).
            </>
          ) : (
            <>
              Klikkaa talon <strong>ulkonurkat</strong> missä tahansa järjestyksessä
              — vähintään kolme pistettä. Sovellus kiinnittyy tunnistettuun reunaan
              ja valitsee ulomman nurkan (esim. laudan ulkoreuna).
            </>
          )}
        </p>

        <div className="mt-4 flex-1 min-h-0 flex items-center justify-center">
          <div className="w-full max-w-[280px] aspect-square">
            {isReference ? <ReferenceAnim /> : <PolygonAnim autoMode={autoMode} />}
          </div>
        </div>

        <div className="mt-3 mb-3 rounded-xl bg-white/10 border border-white/15 px-3 py-2.5 text-xs text-blue-50 flex items-start gap-2">
          <span className="text-base leading-none">💡</span>
          <span>
            {isReference ? (
              <>
                Viivakuva kuvan alla näyttää tunnistetut reunat.{" "}
                <strong>Pinch-zoom</strong> tai +/- -napit tarkentavat.{" "}
                <strong>Aloita alusta</strong> kumoaa valinnan. Viiva pysyy aina
                vaakasuorana.
              </>
            ) : (
              <>
                <strong>Vihreä</strong> esikatselu = nurkka,{" "}
                <strong>syaani</strong> = viiva. Voit raahata pisteitä ja zoomata.
                Kun nurkkia on vähintään kolme, paina <strong>Valmis</strong>.
              </>
            )}
          </span>
        </div>

        <button
          onClick={onContinue}
          className="w-full py-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-semibold text-base shadow-lg shadow-blue-900/40 flex items-center justify-center gap-2"
        >
          Selvä, jatketaan
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}

function HouseSilhouette() {
  return (
    <>
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
      <polygon
        points="40,80 200,80 120,30"
        fill="#1e293b"
        stroke="#3b82f6"
        strokeWidth="1.5"
      />
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

/** One-tap inside opening → auto horizontal span → enter meters. */
function ReferenceAnim() {
  return (
    <svg
      viewBox="0 0 240 200"
      className="w-full h-full"
      role="img"
      aria-label="Animaatio: napauta aukon sisään, viiva syntyy automaattisesti"
    >
      <HouseSilhouette />

      {/* MLSD-style line overlay hint */}
      <line x1="40" y1="80" x2="200" y2="80" stroke="#94a3b8" strokeWidth="1" opacity="0.5" />
      <line x1="40" y1="180" x2="200" y2="180" stroke="#94a3b8" strokeWidth="1" opacity="0.5" />
      <line x1="40" y1="80" x2="40" y2="180" stroke="#94a3b8" strokeWidth="1" opacity="0.5" />
      <line x1="200" y1="80" x2="200" y2="180" stroke="#94a3b8" strokeWidth="1" opacity="0.5" />

      <g style={{ animation: "pulse-soft 4s ease-in-out infinite" }}>
        {/* Blue translucent opening band */}
        <rect
          x="105"
          y="108"
          width="30"
          height="44"
          fill="rgba(59, 130, 246, 0.28)"
          rx="2"
          style={{
            opacity: 0,
            animation: "fade-label 4s ease-out infinite both",
            animationDelay: "1.2s",
          }}
        />

        {/* Auto reference line across door */}
        <line
          x1="105"
          y1="130"
          x2="135"
          y2="130"
          stroke="#2563eb"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray="40"
          strokeDashoffset="40"
          style={{
            ["--len" as unknown as keyof React.CSSProperties]: "40",
            animation: "draw-line 4s ease-in-out infinite both",
            animationDelay: "0.9s",
          } as React.CSSProperties}
        />

        {/* Tap indicator inside door */}
        <circle
          cx="120"
          cy="145"
          r="7"
          fill="#2563eb"
          stroke="white"
          strokeWidth="2"
          style={{
            transformOrigin: "120px 145px",
            animation: "tap-pulse 4s ease-out infinite both",
          }}
        />

        {/* Endpoint ticks */}
        <line x1="105" y1="122" x2="105" y2="138" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"
          style={{ opacity: 0, animation: "fade-label 4s ease-out infinite both", animationDelay: "1.1s" }} />
        <line x1="135" y1="122" x2="135" y2="138" stroke="#2563eb" strokeWidth="2" strokeLinecap="round"
          style={{ opacity: 0, animation: "fade-label 4s ease-out infinite both", animationDelay: "1.1s" }} />

        <g style={{ animation: "fade-label 4s ease-out infinite both", animationDelay: "1.6s" }}>
          <rect x="98" y="98" width="44" height="16" rx="4" fill="white" stroke="#2563eb" strokeWidth="1.5" />
          <text x="120" y="110" textAnchor="middle" fontSize="11" fontWeight="700" fill="#1d4ed8">
            0,9 m
          </text>
        </g>
      </g>

      <text x="120" y="195" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontWeight="500">
        Napauta aukon sisään → syötä leveys
      </text>
    </svg>
  );
}

function PolygonAnim({ autoMode }: { autoMode?: boolean }) {
  const pts: [number, number][] = [
    [40, 180],
    [40, 80],
    [200, 80],
    [200, 180],
  ];
  const pathPoints = `${pts.map(([x, y]) => `${x},${y}`).join(" ")} ${pts[0][0]},${pts[0][1]}`;

  return (
    <svg
      viewBox="0 0 240 200"
      className="w-full h-full"
      role="img"
      aria-label="Animaatio: klikkaa talon nurkat vapaassa järjestyksessä"
    >
      <HouseSilhouette />

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
          animationDelay: "1.2s",
        } as React.CSSProperties}
      />

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
            animationDelay: `${[0, 0.7, 1.4, 0.35][i]}s`,
          }}
        />
      ))}

      {/* Snap guide lines to outer corners */}
      <line x1="40" y1="80" x2="40" y2="180" stroke="rgba(34,211,238,0.6)" strokeWidth="1.5" strokeDasharray="4 3"
        style={{ opacity: 0, animation: "fade-label 4s ease-out infinite both", animationDelay: "0.5s" }} />
      <line x1="200" y1="80" x2="200" y2="180" stroke="rgba(34,211,238,0.6)" strokeWidth="1.5" strokeDasharray="4 3"
        style={{ opacity: 0, animation: "fade-label 4s ease-out infinite both", animationDelay: "0.9s" }} />

      <text x="120" y="195" textAnchor="middle" fontSize="10" fill="#cbd5e1" fontWeight="500">
        {autoMode ? "≥ 3 nurkkaa — automaattinen mittakaava" : "≥ 3 nurkkaa — mikä tahansa järjestys"}
      </text>
    </svg>
  );
}
