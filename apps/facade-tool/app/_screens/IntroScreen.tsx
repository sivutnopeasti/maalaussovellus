"use client";

import { Camera, Trash2 } from "lucide-react";
import type { FacadeProject } from "@/lib/wallHeight";

interface Props {
  project: FacadeProject | null;
  onOpenCamera: () => void;
  onClearProject: () => void;
}

/**
 * First-launch screen. Shows a brief 3-step explanation followed by the
 * "Open camera" CTA. If the user has an in-progress project (≥ 1 wall
 * measured), the screen offers to continue or to start over.
 */
export default function IntroScreen({
  project,
  onOpenCamera,
  onClearProject,
}: Props) {
  const wallCount = project?.measurements.length ?? 0;
  const hasProject = wallCount > 0;

  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Hero */}
      <div className="pt-8 pb-4 px-6 text-center">
        <div className="mx-auto w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-xl shadow-blue-200">
          <HouseIcon />
        </div>
        <h1 className="mt-4 text-2xl font-extrabold text-slate-900 leading-tight">
          Mittaa talosi seinät
          <br />
          <span className="text-blue-600">muutamassa minuutissa</span>
        </h1>
        <p className="mt-2 text-sm text-slate-600 px-2">
          Ota kuvat seinistä — sovellus laskee neliömetrit ja muodostaa tarjouksen.
        </p>
      </div>

      {/* Steps */}
      <div className="flex-1 px-5 pb-3 overflow-hidden">
        <ol className="space-y-2.5">
          <Step
            n={1}
            title="Ota kuva seinästä"
            body="Asetu suoraan seinän eteen. Vesivaaka näyttää kun puhelin on suorassa."
          />
          <Step
            n={2}
            title="Anna yksi tunnettu mitta"
            body="Esim. oven leveys (~90 cm). Sovellus laskee kaiken muun siitä."
          />
          <Step
            n={3}
            title="Klikkaa talon nurkat"
            body="Rajaa maalattava alue. Sovellus tunnistaa reunat automaattisesti."
          />
        </ol>
      </div>

      {/* CTA */}
      <div className="px-5 pb-6 pt-3 space-y-2">
        {hasProject && (
          <div className="text-center text-xs text-slate-500 mb-1">
            Sinulla on kesken {wallCount} mitattua seinää.
          </div>
        )}
        <button
          onClick={onOpenCamera}
          className="w-full py-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold text-base shadow-xl shadow-blue-200 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Camera className="w-5 h-5" />
          {hasProject ? "Jatka — avaa kamera" : "Avaa kamera ja ota kuvat"}
        </button>
        {hasProject && (
          <button
            onClick={onClearProject}
            className="w-full py-2.5 rounded-xl text-slate-500 text-sm font-medium hover:bg-slate-100 flex items-center justify-center gap-1.5"
          >
            <Trash2 className="w-4 h-4" />
            Aloita alusta
          </button>
        )}
      </div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex items-start gap-3 p-3 rounded-2xl bg-white border border-slate-200 shadow-sm">
      <span className="shrink-0 w-8 h-8 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center">
        {n}
      </span>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 text-sm">{title}</p>
        <p className="text-xs text-slate-500 leading-snug mt-0.5">{body}</p>
      </div>
    </li>
  );
}

function HouseIcon() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="white"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 11l9-8 9 8" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M10 21V14h4v7" />
    </svg>
  );
}
