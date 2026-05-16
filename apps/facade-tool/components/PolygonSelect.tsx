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
  depthMapUrl?: string;
}

interface DepthCache {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  refDepth: number;
}

type Phase = "drawing" | "done";

export default function PolygonSelect({
  imageUrl,
  imageWidth,
  imageHeight,
  onPolygonSet,
  reference,
  depthMapUrl,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const depthRef = useRef<DepthCache | null>(null);
  const [points, setPoints] = useState<Point[]>([]);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<Phase>("drawing");
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

  // Load depth map for segment length display
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
      depthRef.current = { data, width: img.width, height: img.height, refDepth: n > 0 ? sum / n : 128 };
      setDepthReady(true);
    };
    img.src = depthMapUrl;
  }, [depthMapUrl, reference, imageWidth, imageHeight]);

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
  }, [reference, imageWidth, imageHeight, depthReady]); // eslint-disable-line react-hooks/exhaustive-deps

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

    // Polygon fill + outline
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
        const bx = tx - tw / 2 - pad, by = ty - fontSize / 2 - pad / 2;
        const bw = tw + pad * 2, bh = fontSize + pad;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 4);
        ctx.fillStyle = "rgba(0,0,0,0.68)";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(label, tx, ty);
        ctx.restore();
      }
    }

    // Corner dots with numbers
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

  useEffect(() => { redraw(); }, [redraw]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "drawing") return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      setPoints((prev) => [...prev, {
        x: (e.clientX - rect.left) / scale,
        y: (e.clientY - rect.top) / scale,
      }]);
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
      {/* Instruction */}
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

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleCanvasClick}
          className={`block w-full ${phase === "drawing" ? "cursor-crosshair" : "cursor-default"}`}
        />
      </div>

      {/* Controls */}
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
