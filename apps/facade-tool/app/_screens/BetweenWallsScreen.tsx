"use client";

import { Camera, Check, Plus, Sparkles } from "lucide-react";
import type { FacadeProject } from "@/lib/wallHeight";
import { projectTotalM2 } from "@/lib/wallHeight";

interface Props {
  project: FacadeProject;
  /** Wall height carried into the next photo (null = manual ref needed). */
  storedWallHeightM: number | null;
  onNextWall: () => void;
  onFinish: () => void;
}

/**
 * Quick interstitial after a wall has been measured. Shows the measured
 * area, the running project total, and the two next-action buttons.
 *
 * Designed to fit a phone screen with no scrolling — the project list
 * scrolls internally if it grows long.
 */
export default function BetweenWallsScreen({
  project,
  storedWallHeightM,
  onNextWall,
  onFinish,
}: Props) {
  const total = projectTotalM2(project);
  const wallCount = project.measurements.length;
  const last = project.measurements[wallCount - 1];

  // Predicted area assuming symmetry — useful preview before the user
  // commits to finishing with fewer than four walls.
  const symmetric =
    wallCount === 1
      ? total * 4
      : wallCount === 2
        ? total * 2
        : wallCount === 3
          ? total + Math.max(...project.measurements.map((m) => m.areaM2))
          : total;

  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-br from-emerald-50 via-white to-blue-50">
      {/* Top: success badge */}
      <div className="pt-8 px-5 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center shadow-md ring-4 ring-emerald-50">
          <Check className="w-8 h-8 text-emerald-600" strokeWidth={3} />
        </div>
        <h2 className="mt-3 text-xl font-bold text-slate-900">
          {last?.label} mitattu!
        </h2>
        <p className="text-3xl font-extrabold text-emerald-600 mt-1 font-mono">
          {last?.areaM2.toFixed(1)} m²
        </p>
      </div>

      {/* Middle: wall list (scrolls internally if it overflows) */}
      <div className="flex-1 min-h-0 px-5 mt-4 overflow-hidden flex flex-col">
        <div className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden flex flex-col min-h-0">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-500">
            <span>Tähän mennessä</span>
            <span>{wallCount} seinää</span>
          </div>
          <ul className="flex-1 min-h-0 overflow-y-auto">
            {project.measurements.map((m, idx) => (
              <li
                key={idx}
                className="flex items-center justify-between px-4 py-2 border-b border-slate-100 last:border-b-0 text-sm"
              >
                <span className="flex items-center gap-2 text-slate-700">
                  <Check className="w-3.5 h-3.5 text-emerald-500" />
                  {m.label}
                </span>
                <span className="font-mono text-slate-900">
                  {m.areaM2.toFixed(2)} m²
                </span>
              </li>
            ))}
          </ul>
          <div className="px-4 py-2.5 bg-emerald-50 border-t border-emerald-200 flex items-center justify-between">
            <span className="text-sm font-semibold text-emerald-900">Yhteensä</span>
            <span className="text-lg font-bold font-mono text-emerald-700">
              {total.toFixed(2)} m²
            </span>
          </div>
        </div>

        {/* Auto-reference hint */}
        {storedWallHeightM ? (
          <div className="mt-3 flex items-start gap-2 px-3 py-2 rounded-xl bg-emerald-100/60 border border-emerald-200 text-xs text-emerald-800">
            <Sparkles className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <span>
              Seuraava kuva mittaa automaattisesti — nurkkakorkeus{" "}
              <strong className="font-mono">
                {storedWallHeightM.toFixed(2)} m
              </strong>{" "}
              on tallessa.
            </span>
          </div>
        ) : (
          <div className="mt-3 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800">
            Seuraavaan seinään tarvitaan oma referenssimitta.
          </div>
        )}

        {/* Symmetry preview */}
        {wallCount < 4 && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-blue-50 border border-blue-200 text-xs text-blue-800 flex items-start gap-2">
            <span className="text-base leading-none">📐</span>
            <span>
              {wallCount === 1 && (
                <>
                  Jos lopetat nyt, lasketaan kaikki neljä seinää samanlaisina ={" "}
                  <strong>{symmetric.toFixed(1)} m²</strong>.
                </>
              )}
              {wallCount === 2 && (
                <>
                  Jos lopetat nyt, oletetaan että vastapäiset seinät ovat samanlaiset ={" "}
                  <strong>{symmetric.toFixed(1)} m²</strong> yhteensä.
                </>
              )}
              {wallCount === 3 && (
                <>
                  Jos lopetat nyt, lisätään neljäs seinä keskimääräisellä koolla ={" "}
                  <strong>{symmetric.toFixed(1)} m²</strong>.
                </>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Bottom CTAs */}
      <div className="px-5 pb-6 pt-3 space-y-2 shrink-0">
        <button
          onClick={onNextWall}
          className="w-full py-3.5 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold text-base shadow-xl shadow-blue-200 flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <Camera className="w-5 h-5" />
          Mittaa seuraava seinä
          <Plus className="w-4 h-4" />
        </button>
        <button
          onClick={onFinish}
          className="w-full py-3 rounded-2xl bg-white border-2 border-emerald-300 hover:bg-emerald-50 text-emerald-700 font-semibold text-sm"
        >
          {wallCount >= 2 ? "Olen valmis — laske tarjous" : "Riittää tämä — jatka"}
        </button>
      </div>
    </div>
  );
}
