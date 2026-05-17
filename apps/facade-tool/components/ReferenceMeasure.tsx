"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { Ruler, RotateCcw, Check } from "lucide-react";
import type { Point, ReferenceData } from "@/lib/types";
import { useCanvasViewport } from "@/lib/useCanvasViewport";
import { drawLoupe } from "@/lib/canvasLoupe";
import ZoomControls from "./ZoomControls";

interface Props {
  imageDataUrl: string;
  onReferenceSet: (data: ReferenceData) => void;
}

type Phase = "point1" | "point2" | "input";

/** Hit-area radius in *screen* pixels for grabbing an existing point.
 *  ~28 px feels right on a phone (a finger pad is ~10-12 mm = ~40 px). */
const HIT_RADIUS_PX = 28;

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
  /** Index of the point currently being dragged (null = no drag). */
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
  /** Index of the point under the cursor right now — used to show
   *  the grab cursor before the user starts dragging. */
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  /** Bookkeeping for the in-flight drag pointer. */
  const dragInfoRef = useRef<{
    pointerId: number;
    moved: boolean;
  } | null>(null);
  /** When a drag ends, suppress the synthetic click that would
   *  otherwise fire and place an unwanted point. */
  const suppressClickRef = useRef(false);

  const viewport = useCanvasViewport({
    imageScale: scale,
    canvasW: canvasSize.w,
    canvasH: canvasSize.h,
  });

  // Track wrapper size so the canvas fits the available area both
  // horizontally and vertically.
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

  // ── Drawing ────────────────────────────────────────────────────────

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

    // Connecting line between the two endpoints.
    if (points.length >= 2) {
      ctx.strokeStyle = "#EF4444";
      ctx.lineWidth = viewport.strokeWidth(2);
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      ctx.lineTo(sx(points[1]), sy(points[1]));
      ctx.stroke();
    }

    // Endpoint markers — thin vertical tick lines instead of dots.
    // A vertical tick is easier to align with a pixel-precise feature
    // (door edge, sokkeli corner) than a circular dot.
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const cx = sx(p);
      const cy = sy(p);
      const active = draggingIdx === i || hoverIdx === i;

      // Half-length of the tick on screen (radius idea — kept constant
      // regardless of zoom).
      const halfLen = viewport.dotRadius(active ? 18 : 14);
      const tickWidth = viewport.strokeWidth(active ? 3 : 2);

      // White outline so the tick remains visible on every photo.
      ctx.strokeStyle = "#FFFFFF";
      ctx.lineWidth = tickWidth + viewport.strokeWidth(2);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(cx, cy - halfLen);
      ctx.lineTo(cx, cy + halfLen);
      ctx.stroke();

      // Red tick on top.
      ctx.strokeStyle = active ? "#DC2626" : "#EF4444";
      ctx.lineWidth = tickWidth;
      ctx.beginPath();
      ctx.moveTo(cx, cy - halfLen);
      ctx.lineTo(cx, cy + halfLen);
      ctx.stroke();

      // Small centre handle so the user knows the tick is interactive.
      const handleR = viewport.dotRadius(active ? 4 : 3);
      ctx.beginPath();
      ctx.arc(cx, cy, handleR, 0, Math.PI * 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.lineWidth = viewport.strokeWidth(1.5);
      ctx.strokeStyle = active ? "#DC2626" : "#EF4444";
      ctx.stroke();

      ctx.lineCap = "butt";
    }

    // Magnifying loupe — only while the user is actively dragging a
    // point. The loupe is drawn AFTER everything else and in screen-
    // space (= identity transform) so it always renders crisp and
    // never gets distorted by the current zoom.
    if (draggingIdx !== null && points[draggingIdx]) {
      const p = points[draggingIdx];
      const canvasPoint = {
        x: p.x * scale * viewport.zoom + viewport.pan.x,
        y: p.y * scale * viewport.zoom + viewport.pan.y,
      };
      ctx.save();
      viewport.resetTransform(ctx);
      drawLoupe(ctx, {
        imagePoint: p,
        canvasPoint,
        source: img,
        canvasW: canvas.width,
        canvasH: canvas.height,
        radius: 64,
        magnification: 2.5,
        accent: "#EF4444",
      });
      ctx.restore();
      viewport.applyTransform(ctx);
    }

    // Optional length label, rendered once the user has entered a value.
    if (points.length >= 2 && meters) {
      const mx = (sx(points[0]) + sx(points[1])) / 2;
      const my = (sy(points[0]) + sy(points[1])) / 2 - viewport.dotRadius(22);
      const fontPx = viewport.strokeWidth(14);
      const label = `${meters} m`;

      ctx.save();
      ctx.font = `bold ${fontPx}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const tw = ctx.measureText(label).width;
      const padX = viewport.strokeWidth(8);
      const padY = viewport.strokeWidth(5);
      const bw = tw + padX * 2;
      const bh = fontPx + padY * 2;
      const bx = mx - bw / 2;
      const by = my - bh / 2;
      // Fully-rounded pill (radius = half height)
      const radius = bh / 2;

      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, radius);
      ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
      ctx.fill();

      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(label, mx, my);
      ctx.restore();
    }
  }, [points, canvasSize, scale, meters, viewport, draggingIdx, hoverIdx]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // ── Pointer / touch handling ──────────────────────────────────────

  /** Convert a clientX/clientY pair (from a pointer/touch event) to
   *  image-space coordinates. */
  const eventToImage = useCallback(
    (clientX: number, clientY: number): Point => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const screenX = (clientX - rect.left) * sx;
      const screenY = (clientY - rect.top) * sy;
      return viewport.screenToImage(screenX, screenY);
    },
    [viewport],
  );

  /** Returns the index of the closest existing point within the hit
   *  radius, or null. The radius is constant in screen-pixels (so it
   *  feels the same on a phone whether you're zoomed in or out). */
  const hitTest = useCallback(
    (img: Point): number | null => {
      if (points.length === 0) return null;
      const imgRadius = HIT_RADIUS_PX / (scale * viewport.zoom);
      let bestIdx = -1;
      let bestDist = Infinity;
      for (let i = 0; i < points.length; i++) {
        const d = Math.hypot(points[i].x - img.x, points[i].y - img.y);
        if (d < imgRadius && d < bestDist) {
          bestDist = d;
          bestIdx = i;
        }
      }
      return bestIdx === -1 ? null : bestIdx;
    },
    [points, scale, viewport.zoom],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Only react to primary buttons / touches.
      if (e.pointerType !== "touch" && e.button !== 0) {
        viewport.eventProps.onPointerDown(e);
        return;
      }
      const img = eventToImage(e.clientX, e.clientY);
      const hit = hitTest(img);
      if (hit !== null) {
        e.currentTarget.setPointerCapture(e.pointerId);
        dragInfoRef.current = { pointerId: e.pointerId, moved: false };
        setDraggingIdx(hit);
        return;
      }
      viewport.eventProps.onPointerDown(e);
    },
    [eventToImage, hitTest, viewport.eventProps],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragInfoRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        drag.moved = true;
        const img = eventToImage(e.clientX, e.clientY);
        // Clamp to image bounds so the user can't accidentally drag a
        // point off-canvas.
        const x = Math.max(0, Math.min(imgDims.w - 1, img.x));
        const y = Math.max(0, Math.min(imgDims.h - 1, img.y));
        setPoints((prev) => {
          if (draggingIdx === null) return prev;
          const next = [...prev];
          next[draggingIdx] = { x, y };
          return next;
        });
        return;
      }

      // No drag active — update the hover indicator so the user can
      // see which tick they're about to grab. Cheap (one hit-test per
      // pointermove).
      const img = eventToImage(e.clientX, e.clientY);
      const hover = hitTest(img);
      if (hover !== hoverIdx) setHoverIdx(hover);

      viewport.eventProps.onPointerMove(e);
    },
    [eventToImage, hitTest, hoverIdx, imgDims, draggingIdx, viewport.eventProps],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragInfoRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        if (drag.moved) suppressClickRef.current = true;
        dragInfoRef.current = null;
        setDraggingIdx(null);
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* may already be released */
        }
        return;
      }
      viewport.eventProps.onPointerUp(e);
    },
    [viewport.eventProps],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (dragInfoRef.current) {
        dragInfoRef.current = null;
        setDraggingIdx(null);
        return;
      }
      viewport.eventProps.onPointerCancel(e);
    },
    [viewport.eventProps],
  );

  const onPointerLeave = useCallback(() => {
    setHoverIdx(null);
  }, []);

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      // Two-finger pinch starts → abort any in-progress drag so the
      // user can zoom freely.
      if (e.touches.length >= 2 && dragInfoRef.current) {
        dragInfoRef.current = null;
        setDraggingIdx(null);
      }
      viewport.eventProps.onTouchStart(e);
    },
    [viewport.eventProps],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      // While a single-finger drag of an existing point is active, do
      // NOT let the viewport interpret it as a pan (which would move
      // the picture under the finger). The pointer-move handler above
      // already updates the point's coordinates.
      if (dragInfoRef.current && e.touches.length === 1) {
        e.preventDefault();
        return;
      }
      viewport.eventProps.onTouchMove(e);
    },
    [viewport.eventProps],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      viewport.eventProps.onTouchEnd(e);
    },
    [viewport.eventProps],
  );

  // ── Click → place the next point ──────────────────────────────────

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (suppressClickRef.current) {
        suppressClickRef.current = false;
        return;
      }
      if (viewport.consumeClickSuppression()) return;
      if (phase !== "point1" && phase !== "point2") return;

      const img = eventToImage(e.clientX, e.clientY);

      // If the click is on top of an existing point, ignore it — that
      // tap was meant to grab the point, not place a new one. (Drag
      // handling above already covered the case where the user moved.)
      if (hitTest(img) !== null) return;

      const x = Math.max(0, Math.min(imgDims.w - 1, img.x));
      const y = Math.max(0, Math.min(imgDims.h - 1, img.y));

      if (phase === "point1") {
        setPoints([{ x, y }]);
        setPhase("point2");
      } else {
        setPoints((prev) => [prev[0], { x, y }]);
        setPhase("input");
      }
    },
    [phase, viewport, eventToImage, hitTest, imgDims],
  );

  // ── Confirm / reset ────────────────────────────────────────────────

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
    setDraggingIdx(null);
    setHoverIdx(null);
    viewport.reset();
  };

  const cursorClass =
    draggingIdx !== null
      ? "cursor-grabbing"
      : hoverIdx !== null
        ? "cursor-grab"
        : viewport.isPanning
          ? "cursor-grabbing"
          : phase === "point1" || phase === "point2"
            ? "cursor-crosshair"
            : viewport.zoom > 1
              ? "cursor-grab"
              : "cursor-default";

  return (
    <div className="flex flex-col h-full min-h-0 gap-2">
      {/* Compact one-line phase prompt. Long-form guidance lives in the
          page header's "Ohjeet" button. */}
      <div className="flex items-center gap-2 text-sm shrink-0">
        <Ruler className="w-4 h-4 text-blue-600 shrink-0" />
        {phase === "point1" && (
          <span className="text-blue-700 font-medium">
            Aseta viivan <strong>alkupiste</strong> (vedä tarvittaessa
            tarkemmaksi).
          </span>
        )}
        {phase === "point2" && (
          <span className="text-blue-700 font-medium">
            Aseta viivan <strong>loppupiste</strong> — molemmat tikut
            ovat raahattavissa.
          </span>
        )}
        {phase === "input" && (
          <span className="text-green-700 font-medium">
            Syötä viivan pituus metreissä.
          </span>
        )}
      </div>

      {/* Canvas wrapper — flex-1 + min-h-0 makes it shrink to fit. */}
      <div
        ref={canvasWrapperRef}
        className="relative flex-1 min-h-0 rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900 flex items-center justify-center"
      >
        {canvasSize.w > 0 && (
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            // Apply viewport props first so we can override the pointer
            // handlers below with the drag-aware versions.
            {...viewport.eventProps}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={onPointerLeave}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onClick={handleCanvasClick}
            className={`block select-none ${cursorClass}`}
            style={{
              maxWidth: "100%",
              maxHeight: "100%",
              touchAction: "none",
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

      {/* Inline meter input — only while collecting the length. */}
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
