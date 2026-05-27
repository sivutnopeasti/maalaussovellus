"use client";

import { useState, useEffect } from "react";
import { Camera, Trash2, Settings } from "lucide-react";
import dynamic from "next/dynamic";
import type { FacadeProject } from "@/lib/wallHeight";
import { getStoredPhoneModel, type PhoneModel } from "@/lib/phoneModels";

const PhoneModelPicker = dynamic(
  () => import("@/components/PhoneModelPicker"),
  { ssr: false },
);

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

  const [phoneModel, setPhoneModel] = useState<PhoneModel | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    setPhoneModel(getStoredPhoneModel());
  }, []);

  const handleModelSaved = (model: PhoneModel) => {
    setPhoneModel(model);
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-gradient-to-br from-slate-50 via-white to-blue-50">
      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-6 pb-2">
        <div className="w-10" />
        <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-xl shadow-blue-200">
          <HouseIcon />
        </div>
        <button
          onClick={() => setShowPicker(true)}
          className="w-10 h-10 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition-colors"
          title="Asetukset — puhelinmalli"
          aria-label="Asetukset"
        >
          <Settings className="w-5 h-5" />
        </button>
      </div>

      <div className="px-6 pb-3 text-center">
        <h1 className="mt-2 text-2xl font-extrabold text-slate-900 leading-tight">
          Laske kohteen pinta-ala
          <br />
          <span className="text-blue-600">kentällä — sekunnissa</span>
        </h1>
        <p className="mt-2 text-sm text-slate-600 px-2">
          Ota kuva jokaisesta seinästä — sovellus laskee neliömetrit
          tarjouslaskentaa varten.
        </p>

        {/* Phone model badge */}
        <button
          onClick={() => setShowPicker(true)}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors"
          style={
            phoneModel
              ? { borderColor: "#bfdbfe", color: "#1d4ed8", background: "#eff6ff" }
              : { borderColor: "#e2e8f0", color: "#94a3b8", background: "#f8fafc" }
          }
        >
          <Settings className="w-3 h-3" />
          {phoneModel ? phoneModel.name : "Valitse puhelinmalli (suositeltava)"}
        </button>
      </div>

      <div className="flex-1 px-5 pb-3 overflow-hidden">
        <ol className="space-y-2.5">
          <Step
            n={1}
            title="Kuvaa seinä kohtisuoraan"
            body="Asetu suoraan seinän eteen — koko seinä kuvaan. Vesivaaka vihertää kun puhelin on suorassa. iPhonella: napauta Aktivoi vesivaaka kerran."
          />
          <Step
            n={2}
            title="Referenssimitta (vain 1. seinä)"
            body="Napauta oven tai ikkunan reunaan — viiva syntyy automaattisesti. Syötä aukon leveys (esim. ovi = 0,9 m). Seuraavilla seinillä mittakaava siirtyy automaattisesti."
          />
          <Step
            n={3}
            title="Rajaa maalattava alue"
            body="Napauta seinän nurkat — sovellus kiinnittyy reunoihin automaattisesti. Vähennä ikkunat ja ovet tarvittaessa. Neliöt lasketaan heti."
          />
        </ol>
      </div>

      <div className="px-5 pb-6 pt-3 space-y-2">
        {hasProject && (
          <div className="text-center text-xs text-slate-500 mb-1">
            Kohde kesken — {wallCount} seinää mitattu.
          </div>
        )}
        <button
          onClick={onOpenCamera}
          className="w-full py-4 rounded-2xl bg-gradient-to-br from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 text-white font-bold text-base shadow-xl shadow-blue-200 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
        >
          <Camera className="w-5 h-5" />
          {hasProject ? "Jatka mittausta" : "Aloita laskenta — avaa kamera"}
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

      {showPicker && (
        <PhoneModelPicker
          onClose={() => setShowPicker(false)}
          onSaved={handleModelSaved}
        />
      )}
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
      width="34"
      height="34"
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
