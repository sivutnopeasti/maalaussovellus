"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Layers, RefreshCw } from "lucide-react";
import type { MaskResult, MaskCategory } from "@/lib/types";

const CATEGORY_COLORS: Record<MaskCategory, string> = {
  wall: "#22C55E",
  opening: "#EF4444",
  ignored: "#94A3B8",
};

const OVERLAY_RGBA: Record<MaskCategory, [number, number, number, number]> = {
  wall:    [34,  197,  94,  140], // green, ~55% opacity
  opening: [239,  68,  68,  140], // red,   ~55% opacity
  ignored: [  0,   0,   0,    0], // transparent
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
  isAutoClassifying?: boolean;
  onMasksUpdated: (masks: MaskResult[]) => void;
}

export default function SegmentationOverlay({
  masks,
  originalImageUrl,
  isAutoClassifying,
  onMasksUpdated,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [showList, setShowList] = useState(true);

  const walls = masks.filter((m) => m.category === "wall");
  const openings = masks.filter((m) => m.category === "opening");
  const ignored = masks.filter((m) => m.category === "ignored");

  // ── Canvas composite ────────────────────────────────────────────────────────
  const renderComposite = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsRendering(true);

    try {
      // 1. Load original image and set canvas size
      const origImg = await loadImg(originalImageUrl);
      canvas.width = origImg.width;
      canvas.height = origImg.height;
      const ctx = canvas.getContext("2d")!;

      // 2. Draw original image as base layer
      ctx.drawImage(origImg, 0, 0);

      // 3. For each non-ignored mask, build a colored RGBA overlay and draw it
      const visible = masks.filter((m) => m.category !== "ignored");
      for (const mask of visible) {
        const [r, g, b, a] = OVERLAY_RGBA[mask.category];
        try {
          const maskImg = await loadImg(mask.url);

          // Offscreen canvas: convert grayscale mask → colored RGBA layer
          const off = document.createElement("canvas");
          off.width = origImg.width;
          off.height = origImg.height;
          const octx = off.getContext("2d")!;

          // Scale mask to match original image dimensions
          octx.drawImage(maskImg, 0, 0, origImg.width, origImg.height);
          const imgData = octx.getImageData(0, 0, origImg.width, origImg.height);
          const d = imgData.data;

          // For each masked pixel (R > 127): replace with color + alpha
          // For non-masked pixels: set alpha = 0 (fully transparent → original shows through)
          for (let i = 0; i < d.length; i += 4) {
            if (d[i] > 127) {
              d[i]     = r;
              d[i + 1] = g;
              d[i + 2] = b;
              d[i + 3] = a;
            } else {
              d[i + 3] = 0; // fully transparent
            }
          }
          octx.putImageData(imgData, 0, 0);

          // Composite the colored layer over the original image
          ctx.drawImage(off, 0, 0);
        } catch {
          // Skip masks that fail to load
        }
      }
    } finally {
      setIsRendering(false);
    }
  }, [masks, originalImageUrl]);

  useEffect(() => {
    if (!isAutoClassifying) {
      renderComposite();
    }
  }, [renderComposite, isAutoClassifying]);

  const setCategory = (index: number, category: MaskCategory) => {
    const updated = masks.map((m) =>
      m.index === index ? { ...m, category } : m,
    );
    onMasksUpdated(updated);
  };

  return (
    <div className="space-y-4">
      {/* ── Canvas preview ──────────────────────────────────────────────── */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
        {(isRendering || isAutoClassifying) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 z-10 text-white text-sm">
            <RefreshCw className="w-5 h-5 animate-spin" />
            {isAutoClassifying ? "Luokitellaan automaattisesti..." : "Renderöidään..."}
          </div>
        )}

        <canvas
          ref={canvasRef}
          className="w-full block"
          style={{ imageRendering: "auto" }}
        />

        {/* Legend */}
        <div className="absolute bottom-2 left-2 flex gap-2">
          <LegendChip color="#22C55E" label="Seinä" />
          <LegendChip color="#EF4444" label="Aukko" />
        </div>
      </div>

      {/* ── Summary + list toggle ──────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap gap-2 text-xs">
          <span className="px-2 py-1 bg-green-100 text-green-700 rounded-full font-semibold">
            {walls.length} seinäaluetta
          </span>
          <span className="px-2 py-1 bg-red-100 text-red-700 rounded-full font-semibold">
            {openings.length} aukkoa
          </span>
          <span className="px-2 py-1 bg-slate-100 text-slate-500 rounded-full">
            {ignored.length} ohitettu
          </span>
        </div>
        <button
          onClick={() => setShowList((v) => !v)}
          className="text-xs text-blue-600 hover:underline"
        >
          {showList ? "Piilota lista" : "Muokkaa alueita"}
        </button>
      </div>

      {/* ── Manual correction list ─────────────────────────────────────── */}
      {showList && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500 uppercase tracking-wide px-1">
            <Layers className="w-3.5 h-3.5" />
            Tarkista ja korjaa tarvittaessa
          </div>

          <div className="grid grid-cols-1 gap-1.5 max-h-80 overflow-y-auto pr-0.5">
            {masks.map((mask) => (
              <div
                key={mask.index}
                className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 bg-white hover:border-slate-200 transition-colors"
              >
                {/* Category dot */}
                <div
                  className="w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[mask.category] }}
                />

                {/* Label */}
                <span className="flex-1 text-xs text-slate-600 truncate">
                  Alue {mask.index + 1}
                  {mask.pixelCount != null && (
                    <span className="text-slate-400 ml-1">
                      ({(mask.pixelCount / 1000).toFixed(0)} kpx)
                    </span>
                  )}
                  <span
                    className="ml-1.5 font-medium"
                    style={{ color: CATEGORY_COLORS[mask.category] }}
                  >
                    · {CATEGORY_LABELS[mask.category]}
                  </span>
                </span>

                {/* Buttons */}
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
                      className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                        mask.category === cat
                          ? "text-white"
                          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
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
        </div>
      )}
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1 px-2 py-0.5 bg-black/60 rounded text-white text-xs backdrop-blur-sm">
      <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: color, opacity: 0.85 }} />
      {label}
    </div>
  );
}

function loadImg(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Cannot load ${url}`));
    img.src = url;
  });
}
