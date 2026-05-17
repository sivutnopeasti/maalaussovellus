"use client";

import { ZoomIn, ZoomOut, Maximize2 } from "lucide-react";
import { ZOOM_STEP } from "@/lib/useCanvasViewport";

interface Props {
  zoom: number;
  zoomBy: (factor: number) => void;
  reset: () => void;
  /** Optional override of the floating position class. Default is
   *  bottom-right corner of the parent canvas wrapper. */
  className?: string;
}

/**
 * Floating zoom toolbar overlay. Place this inside a relatively-
 * positioned canvas wrapper. Three buttons: zoom in, zoom out, reset.
 */
export default function ZoomControls({
  zoom,
  zoomBy,
  reset,
  className,
}: Props) {
  return (
    <div
      className={
        className ??
        "absolute bottom-3 right-3 flex flex-col gap-1.5 bg-white/90 backdrop-blur rounded-xl shadow-md border border-slate-200 p-1"
      }
    >
      <button
        onClick={() => zoomBy(ZOOM_STEP)}
        disabled={zoom >= 7.9}
        title="Zoomaa lähemmäs"
        aria-label="Zoomaa lähemmäs"
        className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ZoomIn className="w-4 h-4" />
      </button>
      <button
        onClick={() => zoomBy(1 / ZOOM_STEP)}
        disabled={zoom <= 1.01}
        title="Zoomaa kauemmas"
        aria-label="Zoomaa kauemmas"
        className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <ZoomOut className="w-4 h-4" />
      </button>
      <button
        onClick={reset}
        disabled={zoom <= 1.01}
        title="Palauta zoom"
        aria-label="Palauta zoom"
        className="w-9 h-9 flex items-center justify-center text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <Maximize2 className="w-4 h-4" />
      </button>
      {zoom > 1.01 && (
        <div className="text-[10px] font-mono text-center text-slate-500 px-1 pb-0.5">
          {zoom.toFixed(1)}×
        </div>
      )}
    </div>
  );
}
