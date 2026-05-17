"use client";

import { useState } from "react";
import { ArrowLeft, Check, Info, RotateCcw } from "lucide-react";
import type { FacadeProject } from "@/lib/wallHeight";
import { projectTotalM2 } from "@/lib/wallHeight";
import QuoteForm from "@/components/QuoteForm";

interface Props {
  project: FacadeProject;
  onBack: () => void;
  onStartOver: () => void;
}

/**
 * Final results page. This is the ONLY screen that scrolls vertically,
 * because the quote form below the breakdown extends past the viewport
 * on smaller phones.
 *
 * Symmetry rule (per user spec):
 *   1 wall   → ×4 (assume all sides equal)
 *   2 walls  → ×2 (assume the two opposite walls are equal)
 *   3 walls  → add a fourth equal to the average of the measured ones
 *   4+ walls → sum as-is
 */
export default function FinalSummaryScreen({
  project,
  onBack,
  onStartOver,
}: Props) {
  const measured = projectTotalM2(project);
  const walls = project.measurements;
  const n = walls.length;

  let totalArea = measured;
  let multiplierNote = "";
  let multiplier = 1;
  if (n === 1) {
    totalArea = measured * 4;
    multiplier = 4;
    multiplierNote =
      "Yksi seinä mitattu — oletetaan että kaikki neljä seinää ovat samankokoiset (×4).";
  } else if (n === 2) {
    totalArea = measured * 2;
    multiplier = 2;
    multiplierNote =
      "Kaksi seinää mitattu — oletetaan että vastapäiset seinät ovat samanlaiset (×2).";
  } else if (n === 3) {
    const avg = measured / 3;
    totalArea = measured + avg;
    multiplier = 1.333;
    multiplierNote =
      "Kolme seinää mitattu — lisätty neljäs seinä keskimääräisellä koolla.";
  }

  const [isSaving, setIsSaving] = useState(false);
  const handleSave = async (data: {
    unitPrice: number;
    fixedCosts: number;
    totalPrice: number;
    notes: string;
    projectId: string;
  }) => {
    setIsSaving(true);
    try {
      await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: data.projectId || null,
          imageUrl: null,
          visualizedUrl: null,
          wallAreaM2: totalArea,
          unitPrice: data.unitPrice,
          fixedCosts: data.fixedCosts,
          notes: data.notes,
        }),
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-slate-50" data-scroll="true">
      {/* Header — sticky */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 px-4 py-3 flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-slate-100"
          aria-label="Takaisin"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <h1 className="flex-1 font-bold text-slate-900">Yhteenveto</h1>
        <button
          onClick={onStartOver}
          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          aria-label="Aloita alusta"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </header>

      {/* Scrollable content */}
      <div className="flex-1 px-4 py-4 space-y-4">
        {/* Big total */}
        <div className="bg-gradient-to-br from-blue-500 to-blue-700 rounded-3xl p-6 text-white shadow-xl shadow-blue-200">
          <p className="text-xs uppercase tracking-widest text-blue-100">
            Maalattava pinta-ala yhteensä
          </p>
          <p className="mt-1 text-5xl font-extrabold tracking-tight">
            {totalArea.toFixed(1)}
            <span className="text-2xl font-bold ml-1 text-blue-100">m²</span>
          </p>
          <p className="mt-2 text-xs text-blue-100/90">
            Mitattu {measured.toFixed(1)} m² · arvioitu kerroin ×{multiplier.toFixed(multiplier === Math.floor(multiplier) ? 0 : 2)}
          </p>
        </div>

        {/* Breakdown */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Mitatut seinät ({n} kpl)
          </div>
          <ul>
            {walls.map((m, idx) => (
              <li
                key={idx}
                className="px-4 py-2.5 border-b border-slate-100 last:border-b-0 flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2 text-slate-700">
                  <Check className="w-4 h-4 text-emerald-500" />
                  {m.label}
                </span>
                <span className="font-mono font-semibold text-slate-900">
                  {m.areaM2.toFixed(2)} m²
                </span>
              </li>
            ))}
            <li className="px-4 py-2.5 bg-slate-50 flex items-center justify-between text-sm">
              <span className="font-semibold text-slate-700">Mitattu yhteensä</span>
              <span className="font-mono font-bold text-slate-900">
                {measured.toFixed(2)} m²
              </span>
            </li>
          </ul>
        </div>

        {/* Symmetry note */}
        {multiplierNote && (
          <div className="bg-blue-50 border border-blue-200 rounded-2xl p-3 flex items-start gap-2 text-xs text-blue-800">
            <Info className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
            <span>{multiplierNote}</span>
          </div>
        )}

        {/* Quote */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <QuoteForm
            wallAreaM2={totalArea}
            onSave={handleSave}
            isSaving={isSaving}
          />
        </div>

        <div className="h-6" />
      </div>
    </div>
  );
}
