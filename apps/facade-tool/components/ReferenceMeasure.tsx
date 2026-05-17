"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Ruler, RotateCcw, Check } from "lucide-react";
import type { Point, ReferenceData } from "@/lib/types";
import { useCanvasViewport } from "@/lib/useCanvasViewport";
import ZoomControls from "./ZoomControls";

interface Props {
  imageDataUrl: string;
  onReferenceSet: (data: ReferenceData) => void;
}

type Phase = "point1" | "point2" | "input";

export default function ReferenceMeasure({ imageDataUrl, onReferenceSet }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [phase, setPhase] = useState<Phase>("point1");
  const [points, setPoints] = useState<Point[]>([]);
  const [meters, setMeters] = useState("");
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  const viewport = useCanvasViewport({
    imageScale: scale,
    canvasW: canvasSize.w,
    canvasH: canvasSize.h,
  });

  // Track wrapper size so the canvas always fits the available area —
  // both width AND height. Previously we only used the width, which
  // caused the image to overflow vertically on phones.
  useEffect(() => {
    const el = canvasWrapperRef.current;
    if (!el) return;
    const update = () => {
      setContainerSize({ w: el.clientWidth, h: el.clientHeight });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      setImgDims({ w: img.width, h: img.height });
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

  // Recompute canvas size whenever the image OR the container resizes.
  useEffect(() => {
    if (imgDims.w === 0 || containerSize.w === 0 || containerSize.h === 0) {
      return;
    }
    const s = Math.min(
      containerSize.w / imgDims.w,
      containerSize.h / imgDims.h,
      1,
    );
    setScale(s);
    setCanvasSize({
      w: Math.round(imgDims.w * s),
      h: Math.round(imgDims.h * s),
    });
  }, [imgDims, containerSize]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || canvasSize.w === 0) return;
    const ctx = canvas.getContext("2d")!;
    viewport.resetTransform(ctx);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    viewport.applyTransform(ctx);
    ctx.drawImage(img, 0, 0, canvasSize.w, canvasSize.h);

    if (points.length === 0) return;

    const sx = (p: Point) => p.x * scale;
    const sy = (p: Point) => p.y * scale;

    ctx.strokeStyle = "#EF4444";
    ctx.fillStyle = "#EF4444";
    ctx.lineWidth = viewport.strokeWidth(2);

    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      ctx.lineTo(sx(points[1]), sy(points[1]));
      ctx.stroke();
    }

    const dotR = viewport.dotRadius(6);
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(sx(p), sy(p), dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = viewport.strokeWidth(1.5);
      ctx.strokeStyle = "#fff";
      ctx.stroke();
      ctx.strokeStyle = "#EF4444";
    }

    if (points.length >= 2 && meters) {
      const mx = (sx(points[0]) + sx(points[1])) / 2;
      const my = (sy(points[0]) + sy(points[1])) / 2 - viewport.dotRadius(12);
      const fontPx = viewport.strokeWidth(14);
      ctx.font = `bold ${fontPx}px sans-serif`;
      const label = `${meters} m`;
      const tw = ctx.measureText(label).width;
      const padX = viewport.strokeWidth(4);
      const padY = viewport.strokeWidth(3);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(
        mx - tw / 2 - padX,
        my - fontPx + padY,
        tw + padX * 2,
        fontPx + padY * 2,
      );
      ctx.fillStyle = "#EF4444";
      ctx.fillText(label, mx - tw / 2, my);
    }
  }, [points, canvasSize, scale, meters, viewport]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (viewport.consumeClickSuppression()) return;
      if (phase !== "point1" && phase !== "point2") return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const screenX = (e.clientX - rect.left) * sx;
      const screenY = (e.clientY - rect.top) * sy;
      const { x, y } = viewport.screenToImage(screenX, screenY);

      if (phase === "point1") {
        setPoints([{ x, y }]);
        setPhase("point2");
      } else {
        setPoints((prev) => [prev[0], { x, y }]);
        setPhase("input");
      }
    },
    [phase, viewport],
  );

  const handleConfirm = () => {
    const m = parseFloat(meters);
    if (!m || m <= 0 || points.length < 2) return;
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    const pixelsPerMeter = pixelDist / m;
    const angleDeg = Math.atan2(dy, dx) * (180 / Math.PI);
    onReferenceSet({
      point1: points[0],
      point2: points[1],
      meters: m,
      pixelsPerMeter,
      pixelDistance: pixelDist,
      angleDeg,
    });
  };

  const reset = () => {
    setPoints([]);
    setMeters("");
    setPhase("point1");
    viewport.reset();
  };

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      {/* Compact one-line phase prompt — replaces the long static
          instruction block. Long-form guidance is available via the
          "Ohjeet" button in the page header. */}
      <div className="flex items-center gap-2 text-sm shrink-0">
        <Ruler className="w-4 h-4 text-blue-600 shrink-0" />
        {phase === "point1" && (
          <span className="text-blue-700 font-medium">
            Klikkaa viivan <strong>alkupiste</strong> (esim. oven vasen reuna).
          </span>
        )}
        {phase === "point2" && (
          <span className="text-blue-700 font-medium">
            Klikkaa viivan <strong>loppupiste</strong>.
          </span>
        )}
        {phase === "input" && (
          <span className="text-green-700 font-medium">
            Syötä viivan pituus metreissä.
          </span>
        )}
      </div>

      {/* Canvas wrapper — flex-1 + min-h-0 makes it shrink to fit the
          available space. The canvas inside is sized in pixels so it
          respects both width AND height of this container. */}
      <div
        ref={canvasWrapperRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900 flex items-center justify-center"
      >
        {canvasSize.w > 0 && (
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            onClick={handleCanvasClick}
            {...viewport.eventProps}
            className={`block select-none ${
              viewport.isPanning
                ? "cursor-grabbing"
                : phase === "point1" || phase === "point2"
                  ? "cursor-crosshair"
                  : viewport.zoom > 1
                    ? "cursor-grab"
                    : "cursor-default"
            }`}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
            }}
          />
        )}
        {canvasSize.w > 0 && (
          <ZoomControls
            zoom={viewport.zoom}
            zoomBy={viewport.zoomBy}
            reset={viewport.reset}
          />
        )}
      </div>

      {/* Inline controls — only the meter input when we're collecting
          the length. The "Vahvista" confirm + reset live in the page
          footer so this section stays compact. */}
      {phase === "input" && (
        <div className="flex items-center gap-2 shrink-0">
          <input
            type="number"
            min="0.1"
            step="0.1"
            value={meters}
            onChange={(e) => setMeters(e.target.value)}
            placeholder="esim. 0,9"
            className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
          />
          <span className="text-sm text-slate-600 shrink-0">m</span>
          <button
            onClick={handleConfirm}
            disabled={!meters || parseFloat(meters) <= 0}
            className="flex items-center gap-1 px-4 py-2.5 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold shrink-0"
          >
            <Check className="w-4 h-4" />
            OK
          </button>
        </div>
      )}

      {points.length > 0 && phase !== "input" && (
        <button
          onClick={reset}
          className="self-start flex items-center gap-1 px-3 py-1.5 text-slate-500 hover:text-slate-700 text-xs"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Aloita alusta
        </button>
      )}
    </div>
  );
}
