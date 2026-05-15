"use client";

/**
 * ClickSegment — interactive SAM 2 segmentation
 *
 * Two selection modes:
 *  • Point click  — tap any spot, SAM segments the region under the cursor
 *  • Box draw     — drag a rectangle, SAM segments everything inside it
 *                   (best for multi-pane windows, complex shapes)
 */

import { useRef, useState, useCallback } from "react";
import {
  MousePointerClick,
  RectangleHorizontal,
  Loader2,
  PlusCircle,
  MinusCircle,
  Trash2,
} from "lucide-react";
import type { MaskResult, MaskCategory } from "@/lib/types";

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onMaskAdded: (mask: MaskResult) => void;
}

type SelectionTool = "point" | "box";
type TargetCategory = "wall" | "opening";

interface ClickDot {
  x: number;
  y: number;
  category: TargetCategory;
}

interface DrawBox {
  x1: number; y1: number;
  x2: number; y2: number;
  category: TargetCategory;
}

const CATEGORY_STYLE: Record<TargetCategory, { bg: string; border: string; label: string }> = {
  wall:    { bg: "bg-green-600",  border: "border-green-500",  label: "Seinä" },
  opening: { bg: "bg-red-600",    border: "border-red-500",    label: "Aukko (ikkuna/ovi)" },
};

export default function ClickSegment({ imageUrl, imageWidth, imageHeight, onMaskAdded }: Props) {
  const imgRef       = useRef<HTMLImageElement>(null);
  const overlayRef   = useRef<HTMLCanvasElement>(null);

  const [isActive,   setIsActive]   = useState(false);
  const [tool,       setTool]       = useState<SelectionTool>("point");
  const [category,   setCategory]   = useState<TargetCategory>("wall");
  const [isLoading,  setIsLoading]  = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [dots,       setDots]       = useState<ClickDot[]>([]);
  const [boxes,      setBoxes]      = useState<DrawBox[]>([]);

  // Box-drawing state
  const dragging      = useRef(false);
  const dragStart     = useRef<{ x: number; y: number } | null>(null);
  const currentBox    = useRef<{ x1: number; y1: number; x2: number; y2: number } | null>(null);

  // ── Canvas overlay helpers ──────────────────────────────────────────────────
  const getImgRect = () => imgRef.current!.getBoundingClientRect();

  const normToDisplay = (n: number, total: number, dispSize: number) =>
    (n / total) * dispSize;

  const redrawOverlay = useCallback(() => {
    const canvas = overlayRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const rect = img.getBoundingClientRect();
    canvas.width  = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sx = rect.width  / imageWidth;
    const sy = rect.height / imageHeight;

    // Draw committed boxes
    boxes.forEach(({ x1, y1, x2, y2, category: cat }) => {
      const color = cat === "wall" ? "#22C55E" : "#EF4444";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.setLineDash([6, 3]);
      ctx.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy);
      ctx.setLineDash([]);
      ctx.fillStyle = color + "33";
      ctx.fillRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy);
    });

    // Draw in-progress box
    if (currentBox.current) {
      const { x1, y1, x2, y2 } = currentBox.current;
      const color = category === "wall" ? "#22C55E" : "#EF4444";
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.strokeRect(x1 * sx, y1 * sy, (x2 - x1) * sx, (y2 - y1) * sy);
      ctx.setLineDash([]);
    }

    // Draw click dots
    dots.forEach(({ x, y, category: cat }) => {
      const cx = x * sx, cy = y * sy;
      const color = cat === "wall" ? "#22C55E" : "#EF4444";
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fillStyle = "white";
      ctx.fill();
    });
  }, [dots, boxes, category, imageWidth, imageHeight]);

  // ── Send request to API ─────────────────────────────────────────────────────
  const sendRequest = useCallback(async (
    payload: { points?: { xNorm: number; yNorm: number; label: 1 | 0 }[]; box?: { xNorm: number; yNorm: number; wNorm: number; hNorm: number } },
    cat: TargetCategory,
  ) => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/segment-click", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl, imageWidth, imageHeight, ...payload }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail ?? json.error ?? "Segmentointi epäonnistui");
      const { maskUrl, width, height } = json;
      const newMask: MaskResult = {
        index: Date.now(),
        url: maskUrl,
        width,
        height,
        category: cat as MaskCategory,
      };
      onMaskAdded(newMask);
      setAddedCount((n) => n + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Virhe segmentoinnissa");
    } finally {
      setIsLoading(false);
    }
  }, [imageUrl, imageWidth, imageHeight, onMaskAdded]);

  // ── Point click ─────────────────────────────────────────────────────────────
  const handlePointClick = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isActive || isLoading || tool !== "point") return;
    const rect = getImgRect();
    const xNorm = (e.clientX - rect.left) / rect.width;
    const yNorm = (e.clientY - rect.top)  / rect.height;
    setDots((prev) => [...prev, { x: xNorm * imageWidth, y: yNorm * imageHeight, category }]);
    sendRequest({ points: [{ xNorm, yNorm, label: 1 }] }, category);
  }, [isActive, isLoading, tool, category, imageWidth, imageHeight, sendRequest]);

  // ── Box draw ─────────────────────────────────────────────────────────────────
  const getNorm = (clientX: number, clientY: number) => {
    const rect = getImgRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top)  / rect.height)),
    };
  };

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!isActive || tool !== "box") return;
    e.preventDefault();
    const { x, y } = getNorm(e.clientX, e.clientY);
    dragging.current  = true;
    dragStart.current = { x: x * imageWidth, y: y * imageHeight };
    currentBox.current = { x1: x * imageWidth, y1: y * imageHeight, x2: x * imageWidth, y2: y * imageHeight };
    redrawOverlay();
  }, [isActive, tool, imageWidth, imageHeight, redrawOverlay]);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!dragging.current || !dragStart.current) return;
    const { x, y } = getNorm(e.clientX, e.clientY);
    currentBox.current = {
      x1: dragStart.current.x,
      y1: dragStart.current.y,
      x2: x * imageWidth,
      y2: y * imageHeight,
    };
    redrawOverlay();
  }, [imageWidth, imageHeight, redrawOverlay]);

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLElement>) => {
    if (!dragging.current || !dragStart.current) return;
    dragging.current = false;
    const { x, y } = getNorm(e.clientX, e.clientY);
    const x1 = Math.min(dragStart.current.x, x * imageWidth);
    const y1 = Math.min(dragStart.current.y, y * imageHeight);
    const x2 = Math.max(dragStart.current.x, x * imageWidth);
    const y2 = Math.max(dragStart.current.y, y * imageHeight);
    const w = x2 - x1, h = y2 - y1;
    currentBox.current = null;

    // Ignore tiny accidental drags
    if (w < imageWidth * 0.01 || h < imageHeight * 0.01) { redrawOverlay(); return; }

    const newBox: DrawBox = { x1, y1, x2, y2, category };
    setBoxes((prev) => [...prev, newBox]);
    sendRequest({
      box: {
        xNorm: x1 / imageWidth,
        yNorm: y1 / imageHeight,
        wNorm: w / imageWidth,
        hNorm: h / imageHeight,
      }
    }, category);
    redrawOverlay();
  }, [imageWidth, imageHeight, category, sendRequest, redrawOverlay]);

  const reset = () => {
    setDots([]);
    setBoxes([]);
    currentBox.current = null;
    dragging.current   = false;
    dragStart.current  = null;
    redrawOverlay();
  };

  const catStyle = CATEGORY_STYLE[category];

  return (
    <div className="space-y-3">
      {/* Activate */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => { setIsActive((v) => !v); setError(null); }}
          className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition-all ${
            isActive
              ? "bg-blue-600 text-white border-blue-600 shadow-sm"
              : "bg-white text-slate-700 border-slate-300 hover:bg-slate-50"
          }`}
        >
          <MousePointerClick className="w-4 h-4" />
          {isActive ? "Valintamoodi päällä" : "Valitse alueita"}
        </button>
        {isActive && (dots.length > 0 || boxes.length > 0) && (
          <button onClick={reset} className="flex items-center gap-1 px-2 py-2 text-xs text-slate-500 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors">
            <Trash2 className="w-3.5 h-3.5" /> Tyhjennä
          </button>
        )}
      </div>

      {isActive && (
        <>
          {/* Tool selector */}
          <div className="flex gap-2">
            <button
              onClick={() => setTool("point")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                tool === "point" ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <MousePointerClick className="w-3.5 h-3.5" /> Klikkaus
            </button>
            <button
              onClick={() => setTool("box")}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                tool === "box" ? "bg-slate-700 text-white border-slate-700" : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              <RectangleHorizontal className="w-3.5 h-3.5" /> Piirrä alue
            </button>
          </div>

          {/* Category selector */}
          <div className="flex gap-2">
            {(["wall", "opening"] as TargetCategory[]).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategory(cat)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  category === cat
                    ? `${CATEGORY_STYLE[cat].bg} text-white ${CATEGORY_STYLE[cat].border}`
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {cat === "wall" ? <PlusCircle className="w-3.5 h-3.5" /> : <MinusCircle className="w-3.5 h-3.5" />}
                {CATEGORY_STYLE[cat].label}
              </button>
            ))}
          </div>

          {/* Hint */}
          <p className="text-xs text-slate-500">
            {isLoading
              ? "SAM 2 analysoi aluetta..."
              : tool === "box"
                ? `Vedä suorakaide ${category === "wall" ? "seinän" : "ikkunan tai oven"} ympärille — toimii myös säleikköikkunoihin.`
                : `Klikkaa ${category === "wall" ? "seinää" : "ikkunaa tai ovea"}.`}
          </p>
        </>
      )}

      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}

      {/* Image + overlay canvas */}
      <div
        className="relative overflow-hidden rounded-xl border border-slate-200 select-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={handlePointClick}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          ref={imgRef}
          src={imageUrl}
          alt="Julkisivu"
          className={`w-full block ${
            !isActive ? "cursor-default" : isLoading ? "cursor-wait" : tool === "box" ? "cursor-crosshair" : `cursor-crosshair`
          }`}
          draggable={false}
          onLoad={redrawOverlay}
        />

        {/* SVG/canvas overlay for boxes and dots */}
        <canvas
          ref={overlayRef}
          className="absolute inset-0 w-full h-full pointer-events-none"
          style={{ imageRendering: "pixelated" }}
        />

        {/* Loading overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/20 flex items-center justify-center rounded-xl">
            <div className="bg-white rounded-xl px-4 py-3 flex items-center gap-2 shadow-lg text-sm">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              <span className="text-slate-700">SAM 2 segmentoi...</span>
            </div>
          </div>
        )}

        {/* Active mode badge */}
        {isActive && !isLoading && (
          <div className={`absolute top-2 right-2 px-2 py-1 rounded-lg text-xs font-medium text-white shadow ${catStyle.bg}`}>
            {tool === "box" ? "Vedä alue" : "Klikkaa"} · {catStyle.label}
          </div>
        )}
      </div>

      {addedCount > 0 && (
        <p className="text-xs text-green-700 text-center">✓ {addedCount} aluetta lisätty</p>
      )}
    </div>
  );
}
