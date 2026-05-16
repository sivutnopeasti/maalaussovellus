"use client";

import { useEffect, useRef, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import type { MaskResult, MaskCategory, Point } from "@/lib/types";

const OVERLAY_RGBA: Record<MaskCategory, [number, number, number, number]> = {
  wall:    [34,  197,  94,  140],
  opening: [239,  68,  68,  140],
  ignored: [  0,   0,   0,    0],
};

interface Props {
  masks: MaskResult[];
  originalImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  isAutoClassifying?: boolean;
  onMasksUpdated: (masks: MaskResult[]) => void;
  /** Polygon drawn by user — drawn as an amber dashed outline on the canvas. */
  polygonPoints?: Point[];
}

export default function SegmentationOverlay({
  masks,
  originalImageUrl,
  isAutoClassifying,
  polygonPoints,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const openings = masks.filter((m) => m.category === "opening");

  const renderComposite = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const origImg = await loadImg(originalImageUrl);
      canvas.width = origImg.width;
      canvas.height = origImg.height;
      const ctx = canvas.getContext("2d")!;

      ctx.drawImage(origImg, 0, 0);

      const visible = masks.filter((m) => m.category !== "ignored");
      for (const mask of visible) {
        const [r, g, b, a] = OVERLAY_RGBA[mask.category];
        try {
          const maskImg = await loadImg(mask.url);
          const off = document.createElement("canvas");
          off.width = origImg.width;
          off.height = origImg.height;
          const octx = off.getContext("2d")!;
          octx.drawImage(maskImg, 0, 0, origImg.width, origImg.height);
          const imgData = octx.getImageData(0, 0, origImg.width, origImg.height);
          const d = imgData.data;

          let hasTransparentPixels = false;
          for (let si = 3; si < Math.min(d.length, 400); si += 4) {
            if (d[si] < 10) { hasTransparentPixels = true; break; }
          }

          // Count pixels; skip tiny masks (< 0.4% of image = likely noise/fence)
          let pixCount = 0;
          for (let i = 0; i < d.length; i += 4) {
            if (hasTransparentPixels ? d[i + 3] > 127 : d[i] > 127) pixCount++;
          }
          const minPix = (origImg.width * origImg.height) * 0.004;
          if (mask.category === "opening" && pixCount < minPix) continue;

          for (let i = 0; i < d.length; i += 4) {
            const inMask = hasTransparentPixels ? d[i + 3] > 127 : d[i] > 127;
            if (inMask) {
              d[i]     = r;
              d[i + 1] = g;
              d[i + 2] = b;
              d[i + 3] = a;
            } else {
              d[i + 3] = 0;
            }
          }
          octx.putImageData(imgData, 0, 0);
          ctx.drawImage(off, 0, 0);
        } catch {
          // Skip masks that fail to load
        }
      }

      // Draw polygon outline
      if (polygonPoints && polygonPoints.length >= 3) {
        ctx.beginPath();
        ctx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
        for (let i = 1; i < polygonPoints.length; i++) {
          ctx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
        }
        ctx.closePath();
        ctx.strokeStyle = "#f59e0b";
        ctx.lineWidth = Math.max(2, origImg.width / 400);
        ctx.setLineDash([origImg.width / 80, origImg.width / 160]);
        ctx.stroke();
        ctx.setLineDash([]);

        for (const p of polygonPoints) {
          const dotR = Math.max(6, origImg.width / 180);
          ctx.beginPath();
          ctx.arc(p.x, p.y, dotR, 0, Math.PI * 2);
          ctx.fillStyle = "#f59e0b";
          ctx.fill();
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
    } catch {
      // ignore
    }
  }, [masks, originalImageUrl, polygonPoints]);

  useEffect(() => {
    if (!isAutoClassifying) {
      renderComposite();
    }
  }, [renderComposite, isAutoClassifying]);

  return (
    <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900">
      {isAutoClassifying && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/50 z-10 text-white text-sm">
          <RefreshCw className="w-5 h-5 animate-spin" />
          Analysoidaan...
        </div>
      )}

      <canvas
        ref={canvasRef}
        className="w-full block"
        style={{ imageRendering: "auto" }}
      />

      {/* Legend */}
      <div className="absolute bottom-2 left-2 flex gap-2">
        <LegendChip color="#f59e0b" label="Rajaus" />
        <LegendChip color="#EF4444" label="Aukko" />
      </div>

      {/* Counts overlay */}
      {openings.length > 0 && (
        <div className="absolute top-2 right-2">
          <span className="px-2 py-0.5 bg-red-600/90 text-white text-xs rounded-full font-semibold backdrop-blur-sm">
            {openings.length} aukkoa
          </span>
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
