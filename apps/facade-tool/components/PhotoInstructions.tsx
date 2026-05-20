"use client";

import { useEffect, useState } from "react";

// House bounds in the 200×145 SVG viewport
const H = { x: 55, y: 32, w: 90, h: 66 };

const STEPS = [
  { label: "Seinä 1 / 4", side: "top",    cx: 100, cy: 9,   angle: 180 },
  { label: "Seinä 2 / 4", side: "right",  cx: 170, cy: 65,  angle: 270 },
  { label: "Seinä 3 / 4", side: "bottom", cx: 100, cy: 122, angle: 0   },
  { label: "Seinä 4 / 4", side: "left",   cx: 30,  cy: 65,  angle: 90  },
] as const;

type Side = (typeof STEPS)[number]["side"];

function wallEndpoints(side: Side): [number, number, number, number] {
  switch (side) {
    case "top":    return [H.x, H.y,        H.x + H.w, H.y         ];
    case "right":  return [H.x + H.w, H.y,  H.x + H.w, H.y + H.h  ];
    case "bottom": return [H.x, H.y + H.h,  H.x + H.w, H.y + H.h  ];
    case "left":   return [H.x, H.y,        H.x,        H.y + H.h  ];
  }
}

export default function PhotoInstructions() {
  const [step, setStep] = useState(0);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    const id = setInterval(() => {
      // Simulate shutter: flash briefly, then change wall mid-flash
      setFlash(true);
      setTimeout(() => {
        setStep((s) => (s + 1) % STEPS.length);
        setTimeout(() => setFlash(false), 160);
      }, 160);
    }, 2400);
    return () => clearInterval(id);
  }, []);

  const cur = STEPS[step];
  const [wx1, wy1, wx2, wy2] = wallEndpoints(cur.side);
  const wallMidX = (wx1 + wx2) / 2;
  const wallMidY = (wy1 + wy2) / 2;

  return (
    <div className="rounded-2xl overflow-hidden border border-blue-200 bg-gradient-to-b from-blue-50 to-white">
      {/* ── Animated diagram ── */}
      <div className="px-3 pt-3 pb-1">
        <svg
          viewBox="0 0 200 140"
          className="w-full max-h-44 mx-auto block"
          aria-label="Ohjeanimaatio: ota kuva kohtisuoraan jokaisesta seinästä"
        >
          {/* Background */}
          <rect width="200" height="140" fill="#eff6ff" />

          {/* House fill */}
          <rect
            x={H.x} y={H.y} width={H.w} height={H.h}
            fill="#dde4ef" stroke="#9babc0" strokeWidth="1.5"
          />
          {/* Simple interior cross to look like a floor plan */}
          <line x1={H.x + H.w / 2} y1={H.y} x2={H.x + H.w / 2} y2={H.y + H.h}
                stroke="#c4cedb" strokeWidth="0.8" />
          <line x1={H.x} y1={H.y + H.h / 2} x2={H.x + H.w} y2={H.y + H.h / 2}
                stroke="#c4cedb" strokeWidth="0.8" />

          {/* Active wall — bright blue line on the outer edge */}
          <line
            x1={wx1} y1={wy1} x2={wx2} y2={wy2}
            stroke="#2563eb" strokeWidth="4.5" strokeLinecap="round"
          />

          {/* Right-angle indicator at wall midpoint */}
          <circle cx={wallMidX} cy={wallMidY} r="3" fill="#2563eb" opacity="0.7" />

          {/* Dashed line from phone to wall */}
          <line
            x1={cur.cx} y1={cur.cy} x2={wallMidX} y2={wallMidY}
            stroke="#2563eb" strokeWidth="1.2"
            strokeDasharray="4 3" opacity="0.5"
          />

          {/* Phone icon — top-down view, lens at "top" (0°), rotated toward wall */}
          <g transform={`translate(${cur.cx} ${cur.cy}) rotate(${cur.angle})`}>
            {/* Phone body */}
            <rect x="-7" y="-14" width="14" height="27" rx="3" fill="#0f172a" />
            {/* Screen */}
            <rect x="-5.5" y="-8" width="11" height="16" rx="1.5" fill="#1e3a5f" />
            {/* Camera lens ring */}
            <circle cy="-10.5" r="3.8" fill="#1e293b" />
            <circle cy="-10.5" r="2.6" fill="#334155" />
            <circle cy="-10.5" r="1.4" fill="#60a5fa" opacity="0.9" />
            {/* Flash */}
            <circle cx="4" cy="-10.5" r="1.1" fill="#fbbf24" />
          </g>

          {/* Shutter flash — white overlay during step transition */}
          {flash && (
            <rect width="200" height="140" fill="white" opacity="0.65" />
          )}

          {/* Step label */}
          <text
            x="100" y="136"
            textAnchor="middle"
            fill="#2563eb" fontSize="9.5" fontWeight="600"
            fontFamily="system-ui, sans-serif"
          >
            {cur.label} — seiso suoraan edessä
          </text>
        </svg>
      </div>

      {/* ── Tips ── */}
      <div className="px-4 py-3 border-t border-blue-100 space-y-1.5">
        <p className="text-xs font-bold text-slate-700 mb-2">Näin otat hyvän kuvan:</p>
        {[
          "Seiso kohtisuoraan seinän edessä — ei kulmasta",
          "Ota yksi kuva per maalattava seinä",
          "Peru taaksepäin kunnes koko seinä mahtuu kuvaan",
        ].map((tip) => (
          <div key={tip} className="flex items-start gap-2">
            <span className="text-green-500 font-bold text-sm leading-none mt-0.5">✓</span>
            <p className="text-xs text-slate-600 leading-snug">{tip}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
