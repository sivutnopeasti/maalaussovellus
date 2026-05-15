"use client";

import { useState } from "react";
import { Layers, Eye, EyeOff } from "lucide-react";
import type { MaskResult, MaskCategory } from "@/lib/types";

const CATEGORY_COLORS: Record<MaskCategory, string> = {
  wall: "#22C55E",      // green
  opening: "#EF4444",   // red
  ignored: "#94A3B8",   // slate
};

const CATEGORY_LABELS: Record<MaskCategory, string> = {
  wall: "Seinä",
  opening: "Aukko (ikkuna/ovi)",
  ignored: "Ohita",
};

interface Props {
  masks: MaskResult[];
  originalImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onMasksUpdated: (masks: MaskResult[]) => void;
}

export default function SegmentationOverlay({
  masks,
  originalImageUrl,
  onMasksUpdated,
}: Props) {
  const [showOverlay, setShowOverlay] = useState(true);
  const [activeMaskIdx, setActiveMaskIdx] = useState<number | null>(null);

  const setCategory = (index: number, category: MaskCategory) => {
    const updated = masks.map((m) =>
      m.index === index ? { ...m, category } : m,
    );
    onMasksUpdated(updated);
    setActiveMaskIdx(null);
  };

  const walls = masks.filter((m) => m.category === "wall");
  const openings = masks.filter((m) => m.category === "opening");
  const ignored = masks.filter((m) => m.category === "ignored");

  return (
    <div className="space-y-4">
      {/* Image + mask overlay */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={originalImageUrl} alt="Julkisivu" className="w-full" />

        {showOverlay &&
          masks.map((mask) => (
            <img
              key={mask.index}
              src={mask.url}
              alt={`Alue ${mask.index + 1}`}
              className="absolute inset-0 w-full h-full object-contain pointer-events-none"
              style={{
                mixBlendMode: "screen",
                opacity: 0.5,
                filter: `hue-rotate(${mask.index * 47}deg) saturate(2)`,
              }}
            />
          ))}

        <button
          onClick={() => setShowOverlay((v) => !v)}
          className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 bg-black/60 text-white text-xs rounded-md hover:bg-black/80 transition-colors"
        >
          {showOverlay ? (
            <EyeOff className="w-3 h-3" />
          ) : (
            <Eye className="w-3 h-3" />
          )}
          {showOverlay ? "Piilota maskit" : "Näytä maskit"}
        </button>
      </div>

      {/* Mask categorisation list */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-slate-700">
          <Layers className="w-4 h-4 text-blue-600" />
          <span>
            Luokittele tunnistetut alueet ({masks.length} kpl)
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2 max-h-96 overflow-y-auto pr-1">
          {masks.map((mask) => (
            <div
              key={mask.index}
              className={`flex items-center gap-3 p-2 rounded-lg border transition-colors ${
                activeMaskIdx === mask.index
                  ? "border-blue-400 bg-blue-50"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              {/* Thumbnail */}
              <div className="shrink-0 w-16 h-12 rounded overflow-hidden bg-slate-900 border border-slate-200 relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={originalImageUrl}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={mask.url}
                  alt=""
                  className="absolute inset-0 w-full h-full object-cover"
                  style={{ mixBlendMode: "multiply", opacity: 0.7 }}
                />
              </div>

              {/* Label + pixel count */}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-slate-600">
                  Alue {mask.index + 1}
                  {mask.pixelCount != null && (
                    <span className="text-slate-400 ml-1">
                      ({(mask.pixelCount / 1000).toFixed(0)} kpx)
                    </span>
                  )}
                </p>
                <div
                  className="inline-flex items-center gap-1 mt-0.5 px-2 py-0.5 rounded-full text-xs font-medium text-white"
                  style={{ backgroundColor: CATEGORY_COLORS[mask.category] }}
                >
                  {CATEGORY_LABELS[mask.category]}
                </div>
              </div>

              {/* Category buttons */}
              <div className="flex gap-1 shrink-0">
                {(
                  [
                    ["wall", "Seinä"],
                    ["opening", "Aukko"],
                    ["ignored", "Ohita"],
                  ] as [MaskCategory, string][]
                ).map(([cat, label]) => (
                  <button
                    key={cat}
                    onClick={() => setCategory(mask.index, cat)}
                    className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                      mask.category === cat
                        ? "text-white"
                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                    style={
                      mask.category === cat
                        ? { backgroundColor: CATEGORY_COLORS[cat] }
                        : undefined
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Summary chips */}
        <div className="flex flex-wrap gap-2 pt-1 text-xs">
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full font-medium">
            {walls.length} seinäaluetta
          </span>
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full font-medium">
            {openings.length} aukkoa
          </span>
          <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-full">
            {ignored.length} ohitettu
          </span>
        </div>
      </div>
    </div>
  );
}
