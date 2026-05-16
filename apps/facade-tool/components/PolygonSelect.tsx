"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Hexagon, RotateCcw, Check, Undo2 } from "lucide-react";
import type { Point, PolygonData, ReferenceData } from "@/lib/types";

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onPolygonSet: (data: PolygonData) => void;
  reference?: ReferenceData;
}

type Phase = "drawing" | "done";

export default function PolygonSelect({
  imageUrl,
  imageWidth,
  imageHeight,
  onPolygonSet,
  reference,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<Phase>("drawing");

  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageRef.current = img;
      const container = canvasRef.current?.parentElement;
      const maxW = container?.clientWidth ?? 640;
      const s = Math.min(1, maxW / img.width);
      setScale(s);
      setCanvasSize({ w: Math.round(img.width * s), h: Math.round(img.height * s) });
    };
    img.src = imageUrl;
  }, [imageUrl]);

  // Segment length = raw pixel distance / pixelsPerMeter.
  // Photos are taken head-on (perpendicular to the wall) so no perspective
  // correction is needed for individual line segments.
  const getSegmentLength = useCallback(
    (a: Point, b: Point): number | null => {
      if (!reference || reference.pixelsPerMeter <= 0) return null;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const pixLen = Math.sqrt(dx * dx + dy * dy);
      return pixLen / reference.pixelsPerMeter;
    },
    [reference],
  );

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

    if (points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(sx(points[i]), sy(points[i]));
      ctx.closePath();
      ctx.fillStyle = "rgba(34, 197, 94, 0.18)";
      ctx.fill();
      ctx.strokeStyle = phase === "done" ? "#16a34a" : "#f59e0b";
      ctx.lineWidth = 2.5;
      ctx.setLineDash(phase === "done" ? [] : [8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      ctx.lineTo(sx(points[1]), sy(points[1]));
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (points.length >= 2 && reference) {
      const closed = points.length >= 3;
      const segCount = closed ? points.length : points.length - 1;
      const fontSize = Math.max(11, Math.round(canvas.width / 45));
      for (let i = 0; i < segCount; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const meters = getSegmentLength(a, b);
        if (meters === null || meters < 0.05) continue;
        const label = meters >= 10 ? `${meters.toFixed(1)} m` : `${meters.toFixed(2)} m`;
        const mx = (sx(a) + sx(b)) / 2;
        const my = (sy(a) + sy(b)) / 2;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const offset = fontSize + 4;
        const tx = mx - Math.sin(angle) * offset;
        const ty = my + Math.cos(angle) * offset;
        ctx.save();
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(label).width;
        const pad = 4;
        const bx = tx - tw / 2 - pad;
        const by = ty - fontSize / 2 - pad / 2;
        const bw = tw + pad * 2;
        const bh = fontSize + pad;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 4);
        ctx.fillStyle = "rgba(0,0,0,0.68)";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(label, tx, ty);
        ctx.restore();
      }
    }

    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      ctx.beginPath();
      ctx.arc(sx(p), sy(p), 7, 0, Math.PI * 2);
      ctx.fillStyle = phase === "done" ? "#16a34a" : "#f59e0b";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = "bold 10px sans-serif";
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), sx(p), sy(p));
    }
  }, [points, canvasSize, scale, phase, reference, getSegmentLength]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "drawing") return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      setPoints((prev) => [
        ...prev,
        {
          x: (e.clientX - rect.left) / scale,
          y: (e.clientY - rect.top) / scale,
        },
      ]);
    },
    [phase, scale],
  );

  const handleConfirm = () => {
    if (points.length < 3) return;
    setPhase("done");
    onPolygonSet({ points });
  };

  const handleUndo = () => {
    if (phase === "done") setPhase("drawing");
    setPoints((prev) => prev.slice(0, -1));
  };

  const handleReset = () => {
    setPoints([]);
    setPhase("drawing");
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 text-sm">
        <Hexagon className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
        {phase === "drawing" ? (
          <span className="text-slate-700">
            Klikkaa talon nurkat <strong>järjestyksessä</strong> — ala vasemmalta, kierry myötäpäivään.
            {points.length === 0 && " Tarvitaan vähintään 3 pistettä."}
            {points.length > 0 && points.length < 3 && ` ${points.length} pistettä — lisää vähintään ${3 - points.length} lisää.`}
            {points.length >= 3 && <span className="text-green-700 font-medium"> {points.length} pistettä — paina Valmis kun kaikki kulmat on merkitty.</span>}
          </span>
        ) : (
          <span className="text-green-700 font-medium">
            Julkisivu rajattu — {points.length} pistettä.
          </span>
        )}
      </div>

      <div className="relative rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleCanvasClick}
          className={`block w-full ${phase === "drawing" ? "cursor-crosshair" : "cursor-default"}`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {phase === "drawing" && points.length >= 3 && (
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
          >
            <Check className="w-4 h-4" />
            Valmis ({points.length} pistettä)
          </button>
        )}
        {points.length > 0 && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 text-sm"
          >
            <Undo2 className="w-4 h-4" />
            Poista viimeinen
          </button>
        )}
        {points.length > 0 && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-50 text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            Aloita alusta
          </button>
        )}
      </div>
    </div>
  );
}
