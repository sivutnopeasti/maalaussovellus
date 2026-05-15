"use client";

/**
 * ClickSegment — interactive SAM 2 point-prompt segmentation
 *
 * Shows the original image. When click-mode is active the user
 * can tap any part of the image to add a wall or opening mask.
 * SAM 2 returns a precise binary mask for the clicked region.
 */

import { useRef, useState, useCallback } from "react";
import { MousePointerClick, Loader2, PlusCircle, MinusCircle, Trash2 } from "lucide-react";
import type { MaskResult, MaskCategory } from "@/lib/types";

interface PendingClick {
  xNorm: number;
  yNorm: number;
  label: 1 | 0;
}

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onMaskAdded: (mask: MaskResult) => void;
}

type ClickMode = "wall" | "opening" | "exclude";

const MODE_CONFIG: Record<ClickMode, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  cursor: string;
  label_value: 1 | 0;
  category: MaskCategory;
}> = {
  wall: {
    label: "Seinä",
    color: "text-green-700",
    bgColor: "bg-green-600",
    borderColor: "border-green-500",
    cursor: "cursor-crosshair",
    label_value: 1,
    category: "wall",
  },
  opening: {
    label: "Aukko (ikkuna/ovi)",
    color: "text-red-700",
    bgColor: "bg-red-600",
    borderColor: "border-red-500",
    cursor: "cursor-crosshair",
    label_value: 1,
    category: "opening",
  },
  exclude: {
    label: "Poista alue",
    color: "text-slate-700",
    bgColor: "bg-slate-500",
    borderColor: "border-slate-400",
    cursor: "cursor-not-allowed",
    label_value: 0,
    category: "ignored",
  },
};

export default function ClickSegment({
  imageUrl,
  imageWidth,
  imageHeight,
  onMaskAdded,
}: Props) {
  const imgRef = useRef<HTMLImageElement>(null);
  const [isActive, setIsActive] = useState(false);
  const [mode, setMode] = useState<ClickMode>("wall");
  const [isLoading, setIsLoading] = useState(false);
  const [clickDots, setClickDots] = useState<Array<{ x: number; y: number; mode: ClickMode }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);

  const handleImageClick = useCallback(
    async (e: React.MouseEvent<HTMLImageElement>) => {
      if (!isActive || isLoading) return;

      const rect = imgRef.current!.getBoundingClientRect();
      const xNorm = (e.clientX - rect.left) / rect.width;
      const yNorm = (e.clientY - rect.top) / rect.height;

      // Show dot immediately for feedback
      setClickDots((prev) => [...prev, { x: xNorm, y: yNorm, mode }]);
      setIsLoading(true);
      setError(null);

      const points: PendingClick[] = [
        { xNorm, yNorm, label: MODE_CONFIG[mode].label_value },
      ];

      try {
        const res = await fetch("/api/segment-click", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl, points, imageWidth, imageHeight }),
        });

        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error ?? "Segmentointi epäonnistui");
        }

        const { maskUrl, width, height } = await res.json();
        const cfg = MODE_CONFIG[mode];

        const newMask: MaskResult = {
          index: Date.now(), // unique id
          url: maskUrl,
          width,
          height,
          category: cfg.category,
        };

        onMaskAdded(newMask);
        setAddedCount((n) => n + 1);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Virhe segmentoinnissa");
        // Remove the dot on error
        setClickDots((prev) => prev.slice(0, -1));
      } finally {
        setIsLoading(false);
      }
    },
    [isActive, isLoading, mode, imageUrl, imageWidth, imageHeight, onMaskAdded],
  );

  const clearDots = () => setClickDots([]);

  return (
    <div className="space-y-3">
      {/* Header / activate button */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => {
            setIsActive((v) => !v);
            setError(null);
          }}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
            isActive
              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          <MousePointerClick className="w-4 h-4" />
          {isActive ? "Klikkausmoodi päällä" : "Klikkaa lisätäksesi alueita"}
        </button>

        {isActive && clickDots.length > 0 && (
          <button
            onClick={clearDots}
            className="flex items-center gap-1 px-2 py-2 text-xs text-slate-500 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Tyhjennä pisteet
          </button>
        )}
      </div>

      {/* Mode selector — only visible when active */}
      {isActive && (
        <div className="flex gap-2">
          {(["wall", "opening"] as ClickMode[]).map((m) => {
            const cfg = MODE_CONFIG[m];
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  mode === m
                    ? `${cfg.bgColor} text-white ${cfg.borderColor}`
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {m === "wall" ? (
                  <PlusCircle className="w-3.5 h-3.5" />
                ) : (
                  <MinusCircle className="w-3.5 h-3.5" />
                )}
                {cfg.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Hint text */}
      {isActive && (
        <p className="text-xs text-slate-500">
          {isLoading
            ? "SAM 2 analysoi aluetta..."
            : `Klikkaa kuvassa ${mode === "wall" ? "seinää" : "ikkunaa tai ovea"}. Jokainen klikkaus lisää maskin automaattisesti.`}
        </p>
      )}

      {/* Error */}
      {error && (
        <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
      )}

      {/* Image with click overlay */}
      <div className="relative overflow-hidden rounded-xl border border-slate-200">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Julkisivu"
          className={`w-full block select-none ${
            isActive
              ? isLoading
                ? "opacity-70 cursor-wait"
                : MODE_CONFIG[mode].cursor
              : "cursor-default"
          }`}
          onClick={handleImageClick}
          draggable={false}
        />

        {/* Click dots */}
        {clickDots.map((dot, idx) => (
          <div
            key={idx}
            className="absolute pointer-events-none"
            style={{
              left: `${dot.x * 100}%`,
              top: `${dot.y * 100}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className={`w-5 h-5 rounded-full border-2 border-white shadow-lg flex items-center justify-center ${
                dot.mode === "wall" ? "bg-green-500" : "bg-red-500"
              }`}
            >
              <div className="w-1.5 h-1.5 rounded-full bg-white" />
            </div>
          </div>
        ))}

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-xl">
            <div className="bg-white rounded-xl px-4 py-3 flex items-center gap-2 shadow-lg text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span className="text-slate-700">SAM 2 segmentoi...</span>
            </div>
          </div>
        )}

        {/* Active mode badge */}
        {isActive && !isLoading && (
          <div
            className={`absolute top-2 right-2 px-2 py-1 rounded-lg text-xs font-medium text-white shadow ${
              mode === "wall" ? "bg-green-600" : "bg-red-600"
            }`}
          >
            {MODE_CONFIG[mode].label}
          </div>
        )}
      </div>

      {/* Added count */}
      {addedCount > 0 && (
        <p className="text-xs text-green-700 text-center">
          ✓ {addedCount} aluetta lisätty klikkauksella
        </p>
      )}
    </div>
  );
}
