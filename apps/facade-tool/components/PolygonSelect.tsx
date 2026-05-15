"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Hexagon, RotateCcw, Check, Undo2 } from "lucide-react";
import type { Point, PolygonData } from "@/lib/types";

interface Props {
  imageDataUrl: string;
  onPolygonSet: (data: PolygonData) => void;
}

type Phase = "idle" | "drawing" | "done";

export default function PolygonSelect({ imageDataUrl, onPolygonSet }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<Phase>("idle");

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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    if (points.length === 0) return;

    const sx = (p: Point) => p.x * scale;
    const sy = (p: Point) => p.y * scale;

    // Polygon fill + stroke
    if (points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(sx(points[i]), sy(points[i]));
      ctx.closePath();
      ctx.fillStyle = "rgba(34, 197, 94, 0.22)";
      ctx.fill();
      ctx.strokeStyle = "#16a34a";
      ctx.lineWidth = 2.5;
      ctx.setLineDash(phase === "done" ? [] : [8, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      ctx.lineTo(sx(points[1]), sy(points[1]));
      ctx.strokeStyle = "#16a34a";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw numbered corner circles
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const isFirst = i === 0;
      const r = isFirst ? 9 : 7;
      ctx.beginPath();
      ctx.arc(sx(p), sy(p), r, 0, Math.PI * 2);
      ctx.fillStyle = phase === "done" ? "#16a34a" : isFirst ? "#f59e0b" : "#22c55e";
      ctx.fill();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = `bold ${r + 3}px sans-serif`;
      ctx.fillStyle = "#ffffff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), sx(p), sy(p));
    }

    // Tip: show "snap to start" hint when close enough to first point
    if (phase === "drawing" && points.length >= 3) {
      const fp = points[0];
      ctx.font = "12px sans-serif";
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      const tip = "Klikkaa Valmis tai jatka pisteiden lisäämistä";
      const tw = ctx.measureText(tip).width;
      ctx.fillRect(sx(fp) + 12, sy(fp) - 24, tw + 10, 20);
      ctx.fillStyle = "#fff";
      ctx.textAlign = "left";
      ctx.fillText(tip, sx(fp) + 17, sy(fp) - 14);
    }
  }, [points, canvasSize, scale, phase]);

  useEffect(() => { redraw(); }, [redraw]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "drawing") return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / scale;
      const y = (e.clientY - rect.top) / scale;
      setPoints((prev) => [...prev, { x, y }]);
    },
    [phase, scale],
  );

  const handleConfirm = () => {
    if (points.length < 3) return;
    setPhase("done");
    onPolygonSet({ points });
  };

  const handleUndo = () => {
    setPoints((prev) => prev.slice(0, -1));
  };

  const handleReset = () => {
    setPoints([]);
    setPhase("idle");
  };

  // Compute area preview (Shoelace) to show user estimated pixel count
  const shoelaceArea = (() => {
    if (points.length < 3) return 0;
    let a = 0;
    for (let i = 0; i < points.length; i++) {
      const j = (i + 1) % points.length;
      a += points[i].x * points[j].y - points[j].x * points[i].y;
    }
    return Math.abs(a) / 2;
  })();

  return (
    <div className="space-y-3">
      {/* Instruction text */}
      <div className="flex items-start gap-2 text-sm text-slate-600">
        <Hexagon className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
        {phase === "idle" && (
          <span>
            Klikkaa <strong>&quot;Merkitse nurkat&quot;</strong> ja klikkaa talon
            nurkat järjestyksessä — <strong>räystäät, harjapiste ja kaikki seinän kulmat</strong>.
            Mikä tahansa muoto toimii, myös harjakatto.
          </span>
        )}
        {phase === "drawing" && (
          <span className="font-medium text-green-700">
            Klikkaa nurkat järjestyksessä (myötä- tai vastapäivään).{" "}
            {points.length < 3
              ? `Tarvitaan vähintään 3 pistettä. (${points.length} lisätty)`
              : `${points.length} pistettä — paina Valmis kun kaikki nurkat on merkitty.`}
          </span>
        )}
        {phase === "done" && (
          <span className="font-medium text-green-700">
            Julkisivu rajattu — {points.length} pistettä, pinta-ala n.{" "}
            {(shoelaceArea / 1000).toFixed(0)} kpx².
          </span>
        )}
      </div>

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleCanvasClick}
          className={`block w-full ${phase === "drawing" ? "cursor-crosshair" : "cursor-default"}`}
        />
        {phase === "drawing" && (
          <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 text-white text-xs rounded-lg backdrop-blur-sm">
            Klikkaile nurkat → Valmis
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {phase === "idle" && (
          <button
            onClick={() => setPhase("drawing")}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            <Hexagon className="w-4 h-4" />
            Merkitse nurkat
          </button>
        )}

        {phase === "drawing" && points.length >= 3 && (
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            <Check className="w-4 h-4" />
            Valmis ({points.length} pistettä)
          </button>
        )}

        {phase === "drawing" && points.length > 0 && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-2 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm"
          >
            <Undo2 className="w-4 h-4" />
            Poista viimeinen
          </button>
        )}

        {phase !== "idle" && (
          <button
            onClick={handleReset}
            className="flex items-center gap-1.5 px-3 py-2 text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors text-sm"
          >
            <RotateCcw className="w-4 h-4" />
            Aloita alusta
          </button>
        )}
      </div>
    </div>
  );
}
