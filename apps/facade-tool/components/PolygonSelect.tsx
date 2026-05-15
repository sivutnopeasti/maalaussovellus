"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Hexagon, RotateCcw, Check, Undo2, Wand2, Loader2 } from "lucide-react";
import type { Point, PolygonData, ReferenceData } from "@/lib/types";
import { detectFacadeCorners } from "@/lib/cornerDetect";

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onPolygonSet: (data: PolygonData) => void;
  autoDetectMaskUrl?: string | null;
  /** Reference data — provides pixelsPerMeter and line position for depth sampling. */
  reference?: ReferenceData;
  /** Depth map URL — enables per-segment depth-corrected length display. */
  depthMapUrl?: string;
}

/** Cached depth map data for synchronous per-pixel sampling in redraw. */
interface DepthCache {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  refDepth: number;
}

type Phase = "idle" | "detecting" | "review" | "drawing" | "done";

export default function PolygonSelect({
  imageUrl,
  imageWidth,
  imageHeight,
  onPolygonSet,
  autoDetectMaskUrl,
  reference,
  depthMapUrl,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const depthRef = useRef<DepthCache | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<Phase>(autoDetectMaskUrl ? "detecting" : "idle");
  const [detectError, setDetectError] = useState<string | null>(null);
  const [depthReady, setDepthReady] = useState(false);

  // Load main image
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

  // Load depth map and precompute reference depth
  useEffect(() => {
    if (!depthMapUrl || !reference) return;
    depthRef.current = null;
    setDepthReady(false);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, img.width, img.height);

      // Sample reference depth along the user-drawn reference line
      const sx = img.width / imageWidth;
      const sy = img.height / imageHeight;
      const p1 = { x: reference.point1.x * sx, y: reference.point1.y * sy };
      const p2 = { x: reference.point2.x * sx, y: reference.point2.y * sy };
      const steps = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y), 1);
      let sum = 0, n = 0;
      for (let t = 0; t <= steps; t++) {
        const x = Math.round(p1.x + (p2.x - p1.x) * t / steps);
        const y = Math.round(p1.y + (p2.y - p1.y) * t / steps);
        if (x >= 0 && y >= 0 && x < img.width && y < img.height) {
          sum += data[(y * img.width + x) * 4];
          n++;
        }
      }
      const refDepth = n > 0 ? sum / n : 128;
      depthRef.current = { data, width: img.width, height: img.height, refDepth };
      setDepthReady(true);
    };
    img.src = depthMapUrl;
  }, [depthMapUrl, reference, imageWidth, imageHeight]);

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

  /**
   * Compute depth-corrected segment length in meters.
   * Samples N points along the segment, averages depth correction per point:
   *   correctedMeters = rawMeters × (refDepth / avgDepth)
   * Closer pixels (high depth value) → over-counted → scale down.
   * Farther pixels (low depth value) → under-counted → scale up.
   */
  const getSegmentLength = useCallback((a: Point, b: Point): number | null => {
    if (!reference || reference.pixelsPerMeter <= 0) return null;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const pixLen = Math.sqrt(dx * dx + dy * dy);
    const rawMeters = pixLen / reference.pixelsPerMeter;

    const dc = depthRef.current;
    if (!dc || dc.refDepth < 1) return rawMeters;

    const N = Math.max(8, Math.round(pixLen / 8));
    let corrSum = 0;
    for (let t = 0; t <= N; t++) {
      const px = a.x + dx * t / N;
      const py = a.y + dy * t / N;
      const dpx = Math.min(Math.round(px / imageWidth * dc.width), dc.width - 1);
      const dpy = Math.min(Math.round(py / imageHeight * dc.height), dc.height - 1);
      const d = dc.data[(dpy * dc.width + dpx) * 4];
      corrSum += d > 0 ? Math.max(0.2, Math.min(5.0, dc.refDepth / d)) : 1;
    }
    return rawMeters * (corrSum / (N + 1));
  }, [reference, imageWidth, imageHeight]);

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

        // Midpoint + perpendicular offset
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

        // Background pill
        const tw = ctx.measureText(label).width;
        const pad = 4;
        const bx = tx - tw / 2 - pad;
        const by = ty - fontSize / 2 - pad / 2;
        const bw = tw + pad * 2;
        const bh = fontSize + pad;
        const rr = 4;
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
        ctx.fillStyle = "rgba(0,0,0,0.70)";
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.fillText(label, tx, ty);
        ctx.restore();
      }
    }

    // Corner dots with numbers
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
  }, [points, canvasSize, scale, phase, reference, getSegmentLength, depthReady]); // depthReady triggers redraw when depth loads

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

  const handleUndo = () => setPoints((prev) => prev.slice(0, -1));

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
      {/* Status */}
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
            {depthMapUrl && depthReady && (
              <span className="text-slate-500 font-normal"> Pituudet syvyyskorjattu.</span>
            )}
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
            phase === "drawing" || phase === "review" ? "cursor-crosshair" : "cursor-default"
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
        {phase === "review" && (
          <button
            onClick={handleConfirm}
            className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium"
          >
            <Check className="w-4 h-4" />
            Hyväksy ({points.length} pistettä)
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
        {(phase === "idle" || phase === "review") && (
          <button
            onClick={handleStartManual}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 text-slate-600 rounded-lg hover:bg-slate-50 transition-colors text-sm"
          >
            <Hexagon className="w-4 h-4" />
            {phase === "review" ? "Piirrä itse" : "Merkitse nurkat"}
          </button>
        )}
        {autoDetectMaskUrl && (phase === "idle" || phase === "review") && (
          <button
            onClick={handleReDetect}
            className="flex items-center gap-1.5 px-3 py-2 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm"
          >
            <Wand2 className="w-4 h-4" />
            Tunnista uudelleen
          </button>
        )}
        {(phase === "drawing" || phase === "review") && points.length > 0 && (
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-2 text-slate-600 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors text-sm"
          >
            <Undo2 className="w-4 h-4" />
            Poista viimeinen
          </button>
        )}
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
