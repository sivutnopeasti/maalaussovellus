"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Ruler, RotateCcw, Check } from "lucide-react";
import type { Point, ReferenceData } from "@/lib/types";

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

  // Load the image and set canvas size
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

  // Redraw canvas whenever points or phase changes
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || canvasSize.w === 0) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (points.length === 0) return;

    const sx = (p: Point) => p.x * scale;
    const sy = (p: Point) => p.y * scale;

    ctx.lineWidth = 2;
    ctx.strokeStyle = "#EF4444";
    ctx.fillStyle = "#EF4444";

    // Draw line between the two points
    if (points.length >= 2) {
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      ctx.lineTo(sx(points[1]), sy(points[1]));
      ctx.stroke();
    }

    // Draw endpoint circles
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(sx(p), sy(p), 6, 0, Math.PI * 2);
      ctx.fill();
    }

    // Distance label
    if (points.length >= 2 && meters) {
      const mx = (sx(points[0]) + sx(points[1])) / 2;
      const my = (sy(points[0]) + sy(points[1])) / 2 - 12;
      ctx.font = "bold 14px sans-serif";
      ctx.fillStyle = "#FFFFFF";
      const label = `${meters} m`;
      const tw = ctx.measureText(label).width;
      ctx.fillRect(mx - tw / 2 - 4, my - 14, tw + 8, 20);
      ctx.fillStyle = "#EF4444";
      ctx.fillText(label, mx - tw / 2, my);
    }
  }, [points, canvasSize, scale, meters]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "point1" && phase !== "point2") return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      // Convert to original image coordinates
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;

      if (phase === "point1") {
        setPoints([{ x, y }]);
        setPhase("point2");
      } else {
        setPoints((prev) => [prev[0], { x, y }]);
        setPhase("input");
      }
    },
    [phase, scale],
  );

  const handleConfirm = () => {
    const m = parseFloat(meters);
    if (!m || m <= 0 || points.length < 2) return;
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);
    const pixelsPerMeter = pixelDist / m;
    onReferenceSet({
      point1: points[0],
      point2: points[1],
      meters: m,
      pixelsPerMeter,
      pixelDistance: pixelDist,
    });
  };

  const reset = () => {
    setPoints([]);
    setMeters("");
    setPhase("idle");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <Ruler className="w-4 h-4 text-blue-600" />
        {phase === "idle" && (
          <span>Klikkaa &quot;Aloita mittaus&quot; ja merkitse tunnettu mitta kuvaan.</span>
        )}
        {phase === "point1" && (
          <span className="font-medium text-blue-600">
            Klikkaa ensimmäinen piste kuvaan (esim. seinän vasen reuna).
          </span>
        )}
        {phase === "point2" && (
          <span className="font-medium text-blue-600">
            Klikkaa toinen piste (esim. seinän oikea reuna).
          </span>
        )}
        {phase === "input" && (
          <span className="font-medium text-green-600">
            Syötä mitattu etäisyys metreissä.
          </span>
        )}
      </div>

      <div className="relative rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleCanvasClick}
          className={`block w-full ${phase === "point1" || phase === "point2" ? "cursor-crosshair" : "cursor-default"}`}
        />
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
