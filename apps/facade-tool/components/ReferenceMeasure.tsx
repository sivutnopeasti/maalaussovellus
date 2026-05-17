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

type Phase = "idle" | "point1" | "point2" | "input";

export default function ReferenceMeasure({ imageDataUrl, onReferenceSet }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [points, setPoints] = useState<Point[]>([]);
  const [meters, setMeters] = useState("");
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);

  const viewport = useCanvasViewport({
    imageScale: scale,
    canvasW: canvasSize.w,
    canvasH: canvasSize.h,
  });

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imageRef.current = img;
      const container = canvasRef.current?.parentElement;
      const maxW = container?.clientWidth ?? 640;
      const s = Math.min(1, maxW / img.width);
      setScale(s);
      setCanvasSize({ w: Math.round(img.width * s), h: Math.round(img.height * s) });
    };
    img.src = imageDataUrl;
  }, [imageDataUrl]);

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
    setPhase("idle");
    viewport.reset();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 text-sm text-slate-600">
        <div className="flex items-start gap-2">
          <Ruler className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
          {phase === "idle" && (
            <span>
              Piirrä viiva pitkin jotain <strong>tunnetun mittaista</strong> rakennetta —
              esim. ulko-oven leveys (0,9 m) tai korkeus (2,0 m), sokkelin yläreuna,
              ikkuna. Viiva antaa mittakaavan koko kuvalle.
              <span className="block mt-1 text-xs text-slate-500">
                Tarkin tulos saadaan <strong>vaakasuoralla</strong> viivalla (esim. sokkelin reuna).
                Pystysuora viiva toimii myös, jos kuva on otettu suoraan edestä.
              </span>
              <span className="block mt-1 text-xs text-cyan-700">
                Vinkki: Zoomaa lähemmäs nappia (+) tai sormillasi nipistämällä —
                pisteet pysyvät tarkkoina ja ovat helpompia osua kohdalleen.
              </span>
            </span>
          )}
          {phase === "point1" && (
            <span className="font-medium text-blue-600">
              Klikkaa viivan <strong>alkupiste</strong>.
            </span>
          )}
          {phase === "point2" && (
            <span className="font-medium text-blue-600">
              Klikkaa viivan <strong>loppupiste</strong>.
            </span>
          )}
          {phase === "input" && (
            <span className="font-medium text-green-600">
              Syötä viivan todellinen pituus metreissä.
            </span>
          )}
        </div>
      </div>

      <div className="relative rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleCanvasClick}
          {...viewport.eventProps}
          className={`block w-full select-none ${
            viewport.isPanning
              ? "cursor-grabbing"
              : phase === "point1" || phase === "point2"
                ? "cursor-crosshair"
                : viewport.zoom > 1
                  ? "cursor-grab"
                  : "cursor-default"
          }`}
        />
        {canvasSize.w > 0 && (
          <ZoomControls
            zoom={viewport.zoom}
            zoomBy={viewport.zoomBy}
            reset={viewport.reset}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {phase === "idle" && (
          <button
            onClick={() => setPhase("point1")}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            <Ruler className="w-4 h-4" />
            Aloita mittaus
          </button>
        )}

        {phase === "input" && (
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={meters}
              onChange={(e) => setMeters(e.target.value)}
              placeholder="esim. 5.4"
              className="w-32 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              onKeyDown={(e) => e.key === "Enter" && handleConfirm()}
            />
            <span className="text-sm text-slate-600">metriä</span>
            <button
              onClick={handleConfirm}
              disabled={!meters || parseFloat(meters) <= 0}
              className="flex items-center gap-1 px-3 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors text-sm font-medium"
            >
              <Check className="w-4 h-4" />
              Vahvista
            </button>
          </div>
        )}

        {phase !== "idle" && (
          <button
            onClick={reset}
            className="flex items-center gap-1 px-3 py-2 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            Aloita alusta
          </button>
        )}
      </div>
    </div>
  );
}
