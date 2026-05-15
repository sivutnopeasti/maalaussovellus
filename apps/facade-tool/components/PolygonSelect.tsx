"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Hexagon, RotateCcw, Check, Undo2, Wand2, Loader2 } from "lucide-react";
import type { Point, PolygonData } from "@/lib/types";
import { detectFacadeCorners } from "@/lib/cornerDetect";

interface Props {
  /** Image URL — accepts both data: URLs and https:// CDN URLs. */
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onPolygonSet: (data: PolygonData) => void;
  /** SAM 3 wall mask URL — when provided, auto-detects corners on mount. */
  autoDetectMaskUrl?: string | null;
  /** Pixels per meter from reference line — used to display segment lengths. */
  pixelsPerMeter?: number;
}

type Phase = "idle" | "detecting" | "review" | "drawing" | "done";

export default function PolygonSelect({
  imageUrl,
  imageWidth,
  imageHeight,
  onPolygonSet,
  autoDetectMaskUrl,
  pixelsPerMeter,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<Phase>(autoDetectMaskUrl ? "detecting" : "idle");
  const [detectError, setDetectError] = useState<string | null>(null);

  // Load image into canvas
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

  // Auto-detect corners from SAM 3 wall mask
  useEffect(() => {
    if (!autoDetectMaskUrl || phase !== "detecting") return;
    detectFacadeCorners(autoDetectMaskUrl, imageWidth, imageHeight)
      .then((pts) => {
        if (pts && pts.length >= 3) {
          setPoints(pts);
          setPhase("review");
        } else {
          setDetectError("Automaattinen tunnistus ei onnistunut — klikkaa nurkat itse.");
          setPhase("idle");
        }
      })
      .catch(() => {
        setDetectError("Automaattinen tunnistus ei onnistunut — klikkaa nurkat itse.");
        setPhase("idle");
      });
  }, [autoDetectMaskUrl, imageWidth, imageHeight, phase]);

  // Redraw canvas
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

    // Polygon fill
    if (points.length >= 3) {
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      for (let i = 1; i < points.length; i++) ctx.lineTo(sx(points[i]), sy(points[i]));
      ctx.closePath();
      ctx.fillStyle = "rgba(34, 197, 94, 0.20)";
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

    // Segment length labels
    if (points.length >= 2 && pixelsPerMeter && pixelsPerMeter > 0) {
      const closed = points.length >= 3;
      const segCount = closed ? points.length : points.length - 1;
      for (let i = 0; i < segCount; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const pixLen = Math.sqrt(dx * dx + dy * dy);
        const meters = pixLen / pixelsPerMeter;
        if (meters < 0.05) continue;

        const label = meters >= 10 ? `${meters.toFixed(1)} m` : `${meters.toFixed(2)} m`;

        // Midpoint in canvas coords
        const mx = (sx(a) + sx(b)) / 2;
        const my = (sy(a) + sy(b)) / 2;

        // Perpendicular offset so text sits beside the line, not on top of it
        const angle = Math.atan2(dy, dx);
        const offset = 14;
        // Offset above the line (flip if near edges)
        const ox = -Math.sin(angle) * offset;
        const oy = Math.cos(angle) * offset;

        const tx = mx + ox;
        const ty = my + oy;

        ctx.save();
        ctx.font = `bold ${Math.max(11, Math.round(canvas.width / 45))}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        // Text background pill
        const tw = ctx.measureText(label).width;
        const pad = 4;
        const rr = 4;
        const bx = tx - tw / 2 - pad;
        const by = ty - 8 - pad / 2;
        const bw = tw + pad * 2;
        const bh = 16 + pad;
        ctx.beginPath();
        ctx.moveTo(bx + rr, by);
        ctx.lineTo(bx + bw - rr, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + rr);
        ctx.lineTo(bx + bw, by + bh - rr);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - rr, by + bh);
        ctx.lineTo(bx + rr, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - rr);
        ctx.lineTo(bx, by + rr);
        ctx.quadraticCurveTo(bx, by, bx + rr, by);
        ctx.closePath();
        ctx.fillStyle = "rgba(0,0,0,0.65)";
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, tx, ty);
        ctx.restore();
      }
    }

    // Corner points with numbers
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const r = 7;
      ctx.beginPath();
      ctx.arc(sx(p), sy(p), r, 0, Math.PI * 2);
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
  }, [points, canvasSize, scale, phase, pixelsPerMeter]);

  useEffect(() => { redraw(); }, [redraw]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "drawing" && phase !== "review") return;
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
    setPhase(autoDetectMaskUrl ? "detecting" : "idle");
    setDetectError(null);
  };

  const handleStartManual = () => {
    setPoints([]);
    setPhase("drawing");
    setDetectError(null);
  };

  const handleReDetect = () => {
    setPoints([]);
    setPhase("detecting");
    setDetectError(null);
  };

  return (
    <div className="space-y-3">
      {/* Status text */}
      <div className="flex items-start gap-2 text-sm text-slate-600">
        <Hexagon className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
        {phase === "detecting" && (
          <span className="text-blue-700 font-medium flex items-center gap-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Tunnistetaan seinän rajoja automaattisesti...
          </span>
        )}
        {phase === "review" && (
          <span className="text-amber-700 font-medium">
            Tekoäly merkitsi <strong>{points.length} nurkkapistettä</strong> automaattisesti.
            Tarkista ja hyväksy, tai lisää/poista pisteitä.
          </span>
        )}
        {phase === "idle" && !detectError && (
          <span>
            Klikkaa <strong>&quot;Merkitse nurkat&quot;</strong> ja klikkaa talon
            nurkat järjestyksessä — räystäät, harjapiste ja kaikki kulmat.
          </span>
        )}
        {phase === "idle" && detectError && (
          <span className="text-red-600">{detectError}</span>
        )}
        {phase === "drawing" && (
          <span className="font-medium text-green-700">
            Klikkaa nurkat järjestyksessä.{" "}
            {points.length < 3
              ? `Tarvitaan vähintään 3 pistettä. (${points.length} lisätty)`
              : `${points.length} pistettä — paina Valmis.`}
          </span>
        )}
        {phase === "done" && (
          <span className="font-medium text-green-700">
            Julkisivu rajattu — {points.length} pistettä.
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
          className={`block w-full ${
            phase === "drawing" || phase === "review"
              ? "cursor-crosshair"
              : "cursor-default"
          }`}
        />
        {phase === "detecting" && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-white text-sm">
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Analysoidaan seinän rajoja...</span>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Auto-detected: accept or edit */}
        {phase === "review" && (
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            <Check className="w-4 h-4" />
            Hyväksy ({points.length} pistettä)
          </button>
        )}

        {/* Manual draw confirm */}
        {phase === "drawing" && points.length >= 3 && (
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            <Check className="w-4 h-4" />
            Valmis ({points.length} pistettä)
          </button>
        )}

        {/* Start manual drawing */}
        {(phase === "idle" || phase === "review") && (
          <button
            onClick={handleStartManual}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors text-sm"
          >
            <Hexagon className="w-4 h-4" />
            {phase === "review" ? "Piirrä itse" : "Merkitse nurkat"}
          </button>
        )}

        {/* Re-run auto detection */}
        {autoDetectMaskUrl && (phase === "idle" || phase === "review") && (
          <button
            onClick={handleReDetect}
            className="flex items-center gap-1.5 px-3 py-2 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm"
          >
            <Wand2 className="w-4 h-4" />
            Tunnista uudelleen
          </button>
        )}

        {/* Undo last point */}
        {(phase === "drawing" || phase === "review") && points.length > 0 && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-2 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm"
          >
            <Undo2 className="w-4 h-4" />
            Poista viimeinen
          </button>
        )}

        {/* Reset */}
        {phase !== "idle" && phase !== "detecting" && (
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
