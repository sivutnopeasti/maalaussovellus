"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Hexagon, RotateCcw, Check, Undo2, Magnet } from "lucide-react";
import type { Point, PolygonData, ReferenceData } from "@/lib/types";
import { findReferenceVerticalEdge } from "@/lib/wallHeight";
import {
  buildLineMap,
  snapToNearestLine,
  snapToNearestCorner,
  type LineMapData,
} from "@/lib/lineSnap";
import { useCanvasViewport } from "@/lib/useCanvasViewport";
import { drawLoupe } from "@/lib/canvasLoupe";
import ZoomControls from "./ZoomControls";

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onPolygonSet: (data: PolygonData) => void;
  reference?: ReferenceData;
  /**
   * When set, the polygon's longest near-vertical edge is treated as a wall
   * corner of this real-world height (m). The scale (px/m) is derived live
   * from that edge, so all segment lengths are labelled in metres exactly
   * like in the first photo. Used when subsequent photos auto-reference
   * against a previously measured corner height.
   */
  autoWallHeightM?: number;
  /**
   * URL of the M-LSD line map (white lines on black background). When
   * provided, clicks are snapped to the nearest detected structural line
   * within ~5% of the image diagonal — making polygon corner placement
   * pixel-accurate.
   */
  mlsdMapUrl?: string;
  /**
   * Temporary debug mode. When true, the M-LSD raster is rendered below
   * the picker (with the same polygon overlay drawn on top) so the user
   * can verify exactly which edges are being detected, and a snap log
   * panel shows the last few clicks with their raw-vs-snapped position.
   */
  showMlsdDebug?: boolean;
}

type Phase = "drawing" | "done";

/** Snap radii as a fraction of the image diagonal.
 *
 *  Corners get a much larger search radius (12%) than regular line
 *  pixels (5%): a building corner is an unambiguous "anchor" the user
 *  is clearly aiming at, so we want to forgive imprecise taps and still
 *  catch the right point. Regular lines stay at a tighter radius so the
 *  fallback doesn't yank the click toward a nearby unrelated edge. */
const CORNER_SNAP_RADIUS_FRACTION = 0.12;
const LINE_SNAP_RADIUS_FRACTION = 0.05;

export default function PolygonSelect({
  imageUrl,
  imageWidth,
  imageHeight,
  onPolygonSet,
  reference,
  autoWallHeightM,
  mlsdMapUrl,
  showMlsdDebug = false,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasWrapperRef = useRef<HTMLDivElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const mlsdImageRef = useRef<HTMLImageElement | null>(null);
  const lineMapRef = useRef<LineMapData | null>(null);
  const [lineMapReady, setLineMapReady] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [imgDims, setImgDims] = useState({ w: 0, h: 0 });
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  /** True while the user is actively touching the canvas (or holding
   *  a mouse button down). Drives the loupe so it only appears when the
   *  finger / cursor is engaging the picker — not just hovering on
   *  desktop. */
  const [pointerActive, setPointerActive] = useState(false);
  const [points, setPoints] = useState<Point[]>([]);
  const [snapHint, setSnapHint] = useState<{ from: Point; to: Point } | null>(
    null,
  );
  /** Live preview of where a click at the current mouse position would
   *  land after snapping. Drawn under the cursor while the user is
   *  drawing, so they know exactly which edge the click will snap to
   *  before committing. `kind` tells whether the snap is to a corner
   *  (preferred — green) or a regular line pixel (cyan). */
  const [hoverSnap, setHoverSnap] = useState<{
    cursor: Point;
    snapped: Point | null;
    kind: "corner" | "line" | null;
  } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<Phase>("drawing");
  /** MLSD load state — surfaced to the user so they know whether snap
   *  is actually engaged. */
  const [mlsdStatus, setMlsdStatus] = useState<
    "idle" | "loading" | "ready" | "cors-error" | "load-error"
  >("idle");
  const [mlsdStats, setMlsdStats] = useState<{
    whitePixels: number;
    whiteRatio: number;
    width: number;
    height: number;
  } | null>(null);
  /** Rolling log of the last few clicks: raw → snapped, distance.
   *  Visible only in `showMlsdDebug` mode. */
  const [snapLog, setSnapLog] = useState<
    Array<{
      raw: Point;
      snapped: Point | null;
      kind: "corner" | "line" | null;
      distPx: number | null;
      radiusPx: number;
      ts: number;
    }>
  >([]);

  const viewport = useCanvasViewport({
    imageScale: scale,
    canvasW: canvasSize.w,
    canvasH: canvasSize.h,
  });
  // Debug stats are no longer rendered in the UI — kept in console
  // logs only.

  // Track wrapper size so the canvas always fits the available area —
  // both width AND height. Without this the image overflows vertically
  // on phones.
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
    img.crossOrigin = "anonymous";
    img.onload = () => {
      imageRef.current = img;
      setImgDims({ w: img.width, h: img.height });
    };
    img.src = imageUrl;
  }, [imageUrl]);

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

  // Load and decode the M-LSD line map for click snapping. We do this
  // off-screen as soon as the URL is available — typically before the
  // user has finished placing their first point. The decoded HTMLImage
  // is also kept so the debug-canvas below can render it.
  useEffect(() => {
    if (!mlsdMapUrl) {
      setMlsdStatus("idle");
      return;
    }
    let cancelled = false;
    setMlsdStatus("loading");
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const lm = buildLineMap(img);
        lineMapRef.current = lm;
        mlsdImageRef.current = img;
        setLineMapReady(true);
        setMlsdStatus("ready");
        setMlsdStats({
          whitePixels: lm.whitePixels,
          whiteRatio: lm.whiteRatio,
          width: lm.width,
          height: lm.height,
        });
        console.log("[snap] MLSD map decoded", {
          mlsd: `${lm.width}×${lm.height}`,
          source: `${imageWidth}×${imageHeight}`,
          whitePixels: lm.whitePixels,
          whiteRatio: (lm.whiteRatio * 100).toFixed(2) + "%",
        });
      } catch (err) {
        // getImageData throws a SecurityError when the CDN response
        // doesn't include CORS headers — the most common failure mode
        // for Fal-hosted line maps.
        const msg = err instanceof Error ? err.message : String(err);
        const isCors = /tainted|cors|cross.?origin|security/i.test(msg);
        setMlsdStatus(isCors ? "cors-error" : "load-error");
        console.warn("[snap] failed to decode MLSD map", err);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setMlsdStatus("load-error");
        console.warn("[snap] MLSD image failed to load");
      }
    };
    img.src = mlsdMapUrl;
    return () => {
      cancelled = true;
    };
  }, [mlsdMapUrl, imageWidth, imageHeight]);

  // Effective pixels-per-meter for the segment labels. Two sources:
  //  1) Manual reference (`reference.pixelsPerMeter`) — used in photo 1.
  //  2) Auto reference (`autoWallHeightM`) — used in subsequent photos. The
  //     scale is derived from the polygon's longest near-vertical edge,
  //     since on every face of the same house the wall corner has the same
  //     real-world height.
  //
  // The auto-derived scale only becomes available once the polygon has at
  // least one vertical edge (typically after the user has clicked the first
  // two corner points). Before that, no labels are shown.
  const effectivePpm = useMemo<number | null>(() => {
    if (reference && reference.pixelsPerMeter > 0) return reference.pixelsPerMeter;
    if (autoWallHeightM && autoWallHeightM > 0 && points.length >= 2) {
      const edge = findReferenceVerticalEdge(points);
      if (edge) return edge.pixelLength / autoWallHeightM;
    }
    return null;
  }, [reference, autoWallHeightM, points]);

  const getSegmentLength = useCallback(
    (a: Point, b: Point): number | null => {
      if (effectivePpm === null) return null;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const pixLen = Math.sqrt(dx * dx + dy * dy);
      return pixLen / effectivePpm;
    },
    [effectivePpm],
  );

  /** Pure draw function — draws polygon points, edges and labels onto
   *  whatever canvas is supplied. Used by both the main canvas (over
   *  the source photo) and the debug canvas (over the MLSD line map).
   *  Caller has already applied the viewport transform (zoom + pan),
   *  so coordinates here are in canvas-base (pre-zoom) pixels. */
  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
    if (points.length === 0 && !hoverSnap) return;

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
      ctx.lineWidth = viewport.strokeWidth(2.5);
      const dashLen = viewport.strokeWidth(8);
      const dashGap = viewport.strokeWidth(4);
      ctx.setLineDash(phase === "done" ? [] : [dashLen, dashGap]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else if (points.length === 2) {
      ctx.beginPath();
      ctx.moveTo(sx(points[0]), sy(points[0]));
      ctx.lineTo(sx(points[1]), sy(points[1]));
      ctx.strokeStyle = "#f59e0b";
      ctx.lineWidth = viewport.strokeWidth(2);
      ctx.stroke();
    }

    if (points.length >= 2 && effectivePpm !== null) {
      const closed = points.length >= 3;
      const segCount = closed ? points.length : points.length - 1;
      const fontSize = viewport.strokeWidth(
        Math.max(11, Math.round(canvas.width / 45)),
      );
      for (let i = 0; i < segCount; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        const meters = getSegmentLength(a, b);
        if (meters === null || meters < 0.05) continue;
        const label = meters >= 10 ? `${meters.toFixed(1)} m` : `${meters.toFixed(2)} m`;
        const mx = (sx(a) + sx(b)) / 2;
        const my = (sy(a) + sy(b)) / 2;
        const angle = Math.atan2(b.y - a.y, b.x - a.x);
        const offset = fontSize + viewport.strokeWidth(6);
        const tx = mx - Math.sin(angle) * offset;
        const ty = my + Math.cos(angle) * offset;
        ctx.save();
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const tw = ctx.measureText(label).width;
        const padX = viewport.strokeWidth(8);
        const padY = viewport.strokeWidth(5);
        const bw = tw + padX * 2;
        const bh = fontSize + padY * 2;
        const bx = tx - bw / 2;
        const by = ty - bh / 2;
        // Fully-rounded "pill" — radius equals half the box height.
        const radius = bh / 2;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, radius);
        ctx.fillStyle = "rgba(15, 23, 42, 0.72)";
        ctx.fill();
        ctx.fillStyle = "#fff";
        ctx.fillText(label, tx, ty);
        ctx.restore();
      }
    }

    const dotR = viewport.dotRadius(7);
    const dotStroke = viewport.strokeWidth(2);
    const dotFontSize = viewport.strokeWidth(10);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      ctx.beginPath();
      ctx.arc(sx(p), sy(p), dotR, 0, Math.PI * 2);
      ctx.fillStyle = phase === "done" ? "#16a34a" : "#f59e0b";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = dotStroke;
      ctx.stroke();
      ctx.font = `bold ${dotFontSize}px sans-serif`;
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), sx(p), sy(p));
    }

    // Snap hint — flash showing how the click was nudged onto a
    // detected building edge. The "from" marker (where the user
    // actually tapped) is drawn in red and the "to" marker (where it
    // snapped to) in bright pink with a thick concentric halo, so the
    // jump from tap → snap is impossible to miss.
    if (snapHint) {
      const fx = sx(snapHint.from);
      const fy = sy(snapHint.from);
      const tx = sx(snapHint.to);
      const ty = sy(snapHint.to);
      ctx.save();
      // Faint red "missed" target ring at the raw tap position.
      ctx.strokeStyle = "rgba(239, 68, 68, 0.9)";
      ctx.fillStyle = "rgba(239, 68, 68, 0.18)";
      ctx.lineWidth = viewport.strokeWidth(2);
      ctx.beginPath();
      ctx.arc(fx, fy, viewport.dotRadius(11), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Thick pink arrow from raw to snap.
      ctx.strokeStyle = "#ec4899";
      ctx.lineWidth = viewport.strokeWidth(4);
      ctx.setLineDash([viewport.strokeWidth(6), viewport.strokeWidth(4)]);
      ctx.beginPath();
      ctx.moveTo(fx, fy);
      ctx.lineTo(tx, ty);
      ctx.stroke();
      ctx.setLineDash([]);
      // Pink target halo (large, semi-transparent) — the eye is drawn
      // to it instantly.
      ctx.fillStyle = "rgba(236, 72, 153, 0.28)";
      ctx.beginPath();
      ctx.arc(tx, ty, viewport.dotRadius(22), 0, Math.PI * 2);
      ctx.fill();
      // Crisp pink ring on top.
      ctx.strokeStyle = "#ec4899";
      ctx.lineWidth = viewport.strokeWidth(3);
      ctx.beginPath();
      ctx.arc(tx, ty, viewport.dotRadius(15), 0, Math.PI * 2);
      ctx.stroke();
      // Inner solid dot to mark the exact snap pixel.
      ctx.fillStyle = "#ec4899";
      ctx.beginPath();
      ctx.arc(tx, ty, viewport.dotRadius(4), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Live hover preview — shows where a click at the current cursor
    // position would land after snapping. Color encodes the snap type:
    //   green  = corner (intersection of two lines, preferred)
    //   cyan   = regular line pixel
    if (hoverSnap && phase === "drawing") {
      ctx.save();
      if (hoverSnap.snapped) {
        const isCorner = hoverSnap.kind === "corner";
        const colorFill = isCorner ? "#10b981" : "#22d3ee";
        const colorGuide = isCorner
          ? "rgba(16, 185, 129, 0.75)"
          : "rgba(34, 211, 238, 0.7)";
        const cx = sx(hoverSnap.cursor);
        const cy = sy(hoverSnap.cursor);
        const tx = sx(hoverSnap.snapped);
        const ty = sy(hoverSnap.snapped);
        ctx.strokeStyle = colorGuide;
        ctx.lineWidth = viewport.strokeWidth(1.5);
        ctx.setLineDash([viewport.strokeWidth(2), viewport.strokeWidth(3)]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        // Snap target: larger filled dot when it's a corner, plus a
        // small cross-hair to make the intent obvious.
        const dotR = viewport.dotRadius(isCorner ? 7 : 6);
        ctx.beginPath();
        ctx.arc(tx, ty, dotR, 0, Math.PI * 2);
        ctx.fillStyle = colorFill;
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = viewport.strokeWidth(1.5);
        ctx.stroke();
        if (isCorner) {
          // Cross-hair through the corner — a subtle but clear "this is
          // a corner, not just any line pixel" indicator.
          const armOuter = viewport.dotRadius(12);
          const armInner = viewport.dotRadius(9);
          ctx.strokeStyle = colorFill;
          ctx.lineWidth = viewport.strokeWidth(1.5);
          ctx.beginPath();
          ctx.moveTo(tx - armOuter, ty);
          ctx.lineTo(tx - armInner, ty);
          ctx.moveTo(tx + armInner, ty);
          ctx.lineTo(tx + armOuter, ty);
          ctx.moveTo(tx, ty - armOuter);
          ctx.lineTo(tx, ty - armInner);
          ctx.moveTo(tx, ty + armInner);
          ctx.lineTo(tx, ty + armOuter);
          ctx.stroke();
        }
      } else {
        const cx = sx(hoverSnap.cursor);
        const cy = sy(hoverSnap.cursor);
        ctx.beginPath();
        ctx.arc(cx, cy, viewport.dotRadius(5), 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.6)";
        ctx.lineWidth = viewport.strokeWidth(1.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [points, scale, phase, effectivePpm, getSegmentLength, snapHint, hoverSnap, viewport]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || canvasSize.w === 0) return;
    const ctx = canvas.getContext("2d")!;
    viewport.resetTransform(ctx);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    viewport.applyTransform(ctx);
    ctx.drawImage(img, 0, 0, canvasSize.w, canvasSize.h);
    drawOverlay(ctx, canvas);

    // Loupe — only while the user is actively touching/holding the
    // canvas (so it appears on mobile during a tap-and-hold but stays
    // hidden when the user is just looking). Tracks the current
    // cursor/finger position and shows the snap correction live so the
    // user can release with confidence.
    if (pointerActive && hoverSnap && phase === "drawing") {
      const canvasPoint = {
        x: hoverSnap.cursor.x * scale * viewport.zoom + viewport.pan.x,
        y: hoverSnap.cursor.y * scale * viewport.zoom + viewport.pan.y,
      };
      ctx.save();
      viewport.resetTransform(ctx);
      drawLoupe(ctx, {
        imagePoint: hoverSnap.cursor,
        canvasPoint,
        source: img,
        canvasW: canvas.width,
        canvasH: canvas.height,
        shape: "rounded",
        width: 160,
        height: 110,
        borderRadius: 18,
        magnification: 1.7,
        snapPoint: hoverSnap.snapped,
        accent:
          hoverSnap.kind === "corner"
            ? "#10b981"
            : hoverSnap.kind === "line"
              ? "#22d3ee"
              : "#94a3b8",
      });
      ctx.restore();
      viewport.applyTransform(ctx);
    }
  }, [canvasSize, drawOverlay, viewport, pointerActive, hoverSnap, phase, scale]);

  /** Debug canvas — same dimensions as the main one. Draws the
   *  currently-active snap mask underneath (raw MLSD lines OR the
   *  MLSD ∩ depth-edge intersection) so the user can visually verify
   *  that polygon clicks land on detected silhouette edges. */
  /** Debug canvas — same dimensions as the main one, but the M-LSD line
   *  raster underneath instead of the source photo. Lets the user check
   *  visually whether the polygon edges they're drawing land on detected
   *  building lines. Temporary feature. */
  const redrawDebug = useCallback(() => {
    const canvas = debugCanvasRef.current;
    const mlsd = mlsdImageRef.current;
    if (!canvas || !mlsd || canvasSize.w === 0) return;
    const ctx = canvas.getContext("2d")!;
    viewport.resetTransform(ctx);
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    viewport.applyTransform(ctx);
    ctx.drawImage(mlsd, 0, 0, canvasSize.w, canvasSize.h);
    drawOverlay(ctx, canvas);
  }, [canvasSize, drawOverlay, viewport]);

  useEffect(() => {
    redraw();
    redrawDebug();
  }, [redraw, redrawDebug, lineMapReady]);

  /** Resolve the snap target for a given raw point in image-space.
   *  Two-stage strategy:
   *    1. Try to find a CORNER (line intersection / endpoint) within
   *       the snap radius. House corners, eaves/ridge joins and opening
   *       corners are all intersections, so this catches them.
   *    2. If no corner is in range, fall back to the nearest line pixel
   *       (regular line snap, as before).
   *  Shared between mouseMove (live preview) and click (commit). */
  const resolveSnap = useCallback(
    (
      raw: Point,
    ): {
      snapped: Point | null;
      distPx: number | null;
      radius: number;
      kind: "corner" | "line" | null;
    } => {
      const diag = Math.hypot(imageWidth, imageHeight);
      const cornerRadius = diag * CORNER_SNAP_RADIUS_FRACTION;
      const lineRadius = diag * LINE_SNAP_RADIUS_FRACTION;
      if (!snapEnabled || !lineMapRef.current) {
        return { snapped: null, distPx: null, radius: cornerRadius, kind: null };
      }
      const lm = lineMapRef.current;
      const lmScaleX = lm.width / imageWidth;
      const lmScaleY = lm.height / imageHeight;

      // Stage 1 — corner (wide net so off-target taps still snap home)
      const corner = snapToNearestCorner(
        raw,
        lm,
        cornerRadius,
        lmScaleX,
        lmScaleY,
      );
      if (corner) {
        return {
          snapped: corner,
          distPx: Math.hypot(corner.x - raw.x, corner.y - raw.y),
          radius: cornerRadius,
          kind: "corner",
        };
      }

      // Stage 2 — generic line pixel (tighter)
      const line = snapToNearestLine(raw, lm, lineRadius, lmScaleX, lmScaleY);
      if (line) {
        return {
          snapped: line,
          distPx: Math.hypot(line.x - raw.x, line.y - raw.y),
          radius: lineRadius,
          kind: "line",
        };
      }

      return { snapped: null, distPx: null, radius: cornerRadius, kind: null };
    },
    [snapEnabled, imageWidth, imageHeight],
  );

  /** Convert any event with clientX/clientY (Mouse, Pointer or Touch
   *  via constructed object) into image-space coordinates, accounting
   *  for the canvas's CSS scale and the current zoom/pan. */
  const eventToImage = useCallback(
    (e: { clientX: number; clientY: number }): Point => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width;
      const sy = canvas.height / rect.height;
      const screenX = (e.clientX - rect.left) * sx;
      const screenY = (e.clientY - rect.top) * sy;
      return viewport.screenToImage(screenX, screenY);
    },
    [viewport],
  );

  // Composite pointer handlers — these delegate the pan/pinch logic
  // to the viewport hook and additionally maintain the hover-snap
  // preview and the `pointerActive` flag that drives the loupe.

  const updateHover = useCallback(
    (e: { clientX: number; clientY: number }) => {
      if (phase !== "drawing") return;
      const cursor = eventToImage(e);
      const { snapped, kind } = resolveSnap(cursor);
      setHoverSnap({ cursor, snapped, kind });
    },
    [phase, eventToImage, resolveSnap],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      viewport.eventProps.onPointerDown(e);
      setPointerActive(true);
      updateHover(e);
    },
    [viewport.eventProps, updateHover],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      viewport.eventProps.onPointerMove(e);
      updateHover(e);
    },
    [viewport.eventProps, updateHover],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      viewport.eventProps.onPointerUp(e);
      setPointerActive(false);
      // On touch, hide the hover-dot once the finger lifts (the snap
      // hint will flash briefly to confirm the committed snap).
      if (e.pointerType === "touch") setHoverSnap(null);
    },
    [viewport.eventProps],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      viewport.eventProps.onPointerCancel(e);
      setPointerActive(false);
      setHoverSnap(null);
    },
    [viewport.eventProps],
  );

  const onPointerLeave = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      setPointerActive(false);
      // Keep hover snap on touch (would have been cleared on lift);
      // on mouse, clear it now since the cursor left the canvas.
      if (e.pointerType !== "touch") setHoverSnap(null);
    },
    [],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (viewport.consumeClickSuppression()) return;
      if (phase !== "drawing") return;
      const raw = eventToImage(e);

      const { snapped, distPx, radius, kind } = resolveSnap(raw);
      console.log("[snap] click", {
        raw: `(${raw.x.toFixed(0)}, ${raw.y.toFixed(0)})`,
        snapped: snapped
          ? `(${snapped.x.toFixed(0)}, ${snapped.y.toFixed(0)})`
          : "null (no line within radius)",
        kind,
        distPx: distPx?.toFixed(1),
        radiusPx: radius.toFixed(0),
      });
      const final = snapped ?? raw;
      if (snapped) {
        setSnapHint({ from: raw, to: snapped });
        // Longer visible "jump" so the user can see the correction
        // clearly. 700 ms was too quick on touch devices where the
        // finger is still over the spot when the click commits.
        window.setTimeout(() => setSnapHint(null), 1500);
      }
      // Append to debug log, keep the last 6 entries
      setSnapLog((prev) =>
        [
          ...prev,
          { raw, snapped, kind, distPx, radiusPx: radius, ts: Date.now() },
        ].slice(-6),
      );
      setPoints((prev) => [...prev, final]);
    },
    [phase, eventToImage, resolveSnap, viewport],
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

  const usingAutoScale =
    autoWallHeightM != null &&
    autoWallHeightM > 0 &&
    (!reference || reference.pixelsPerMeter <= 0);

  // Layout shape: in debug mode the picker grows beyond the viewport so
  // the user can scroll down to see the MLSD raster and snap log.
  // Otherwise the original fills-the-viewport layout is kept.
  const outerCls = showMlsdDebug
    ? "flex flex-col gap-2"
    : "flex flex-col h-full min-h-0 gap-2";
  const canvasWrapperCls = showMlsdDebug
    ? "relative h-[55vh] rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900 flex items-center justify-center shrink-0"
    : "relative flex-1 min-h-0 rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900 flex items-center justify-center";

  return (
    <div className={outerCls}>
      {/* Compact one-line phase prompt — replaces the long static
          instruction blocks. Auto-scale + MLSD context are conveyed
          through the in-canvas labels and the hover preview. */}
      <div className="flex items-center gap-2 text-sm shrink-0">
        <Hexagon className="w-4 h-4 text-amber-500 shrink-0" />
        {phase === "drawing" ? (
          <span className="text-slate-700 truncate">
            {points.length === 0 && (
              <>
                Klikkaa <strong>1. nurkka</strong>
                {usingAutoScale && ", aloita pystysuoralta sivulta"}.
              </>
            )}
            {points.length > 0 && points.length < 3 && (
              <>
                {points.length} pistettä — lisää{" "}
                <strong>{3 - points.length} lisää</strong>.
              </>
            )}
            {points.length >= 3 && (
              <span className="text-green-700 font-medium">
                {points.length} pistettä — paina <strong>Valmis</strong>.
              </span>
            )}
          </span>
        ) : (
          <span className="text-green-700 font-medium">
            Rajattu — {points.length} pistettä.
          </span>
        )}
      </div>

      {/* Canvas wrapper — flex-1 + min-h-0 + flex centering ensures the
          canvas always fits the visible area on phones (in non-debug
          mode). In debug mode it has a fixed height so the MLSD view
          below has space too. */}
      <div ref={canvasWrapperRef} className={canvasWrapperCls}>
        {canvasSize.w > 0 && (
          <canvas
            ref={canvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
            onClick={handleCanvasClick}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onPointerLeave={onPointerLeave}
            onWheel={viewport.eventProps.onWheel}
            onTouchStart={viewport.eventProps.onTouchStart}
            onTouchMove={viewport.eventProps.onTouchMove}
            onTouchEnd={viewport.eventProps.onTouchEnd}
            className={`block select-none ${
              viewport.isPanning
                ? "cursor-grabbing"
                : phase === "drawing"
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

        {/* Snap status pill — floating, takes no vertical space. */}
        {mlsdMapUrl && lineMapReady && (
          <button
            onClick={() => setSnapEnabled((s) => !s)}
            className={`absolute top-2 left-2 flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shadow ${
              snapEnabled
                ? "bg-cyan-500/95 text-white"
                : "bg-slate-900/80 text-cyan-200 border border-cyan-400/60"
            }`}
            title={snapEnabled ? "Reunatunnistus päällä" : "Pois käytöstä"}
          >
            <Magnet className="w-3 h-3" />
            {snapEnabled ? "Snap" : "Ei snap"}
          </button>
        )}
      </div>

      {/* Action bar */}
      <div
        className={`flex items-center gap-2 shrink-0 ${
          showMlsdDebug
            ? "sticky bottom-0 bg-white py-2 -mx-2.5 px-2.5 border-t border-slate-100 z-10"
            : ""
        }`}
      >
        {phase === "drawing" && points.length >= 3 && (
          <button
            onClick={handleConfirm}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 bg-green-600 text-white rounded-2xl hover:bg-green-700 text-sm font-bold shadow-lg shadow-green-200"
          >
            <Check className="w-4 h-4" />
            Valmis ({points.length})
          </button>
        )}
        {points.length > 0 && (
          <button
            onClick={handleUndo}
            className="flex items-center justify-center gap-1 px-3 py-2.5 border border-slate-300 text-slate-600 rounded-xl hover:bg-slate-50 text-sm"
            aria-label="Poista viimeinen piste"
          >
            <Undo2 className="w-4 h-4" />
          </button>
        )}
        {points.length > 0 && (
          <button
            onClick={handleReset}
            className="flex items-center justify-center gap-1 px-3 py-2.5 border border-slate-200 text-slate-500 rounded-xl hover:bg-slate-50 text-sm"
            aria-label="Aloita alusta"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* ─── DEBUG SECTION — only when showMlsdDebug ────────────────── */}
      {showMlsdDebug ? (
        <>
          {/* MLSD-status panel */}
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-600">
                Snap-tila
              </h3>
              <SnapStatusBadge status={mlsdStatus} />
            </div>
            {mlsdStats && (
              <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-700">
                <span className="text-slate-500">MLSD-raster:</span>
                <span>
                  {mlsdStats.width}×{mlsdStats.height} px ·{" "}
                  {(mlsdStats.whiteRatio * 100).toFixed(1)}% valkoista
                </span>
                <span className="text-slate-500">Lähdekuva:</span>
                <span>
                  {imageWidth}×{imageHeight} px (diag{" "}
                  {Math.round(Math.hypot(imageWidth, imageHeight))})
                </span>
                <span className="text-slate-500">Snap-säteet:</span>
                <span>
                  kulma{" "}
                  {Math.round(
                    Math.hypot(imageWidth, imageHeight) *
                      CORNER_SNAP_RADIUS_FRACTION,
                  )}{" "}
                  px · viiva{" "}
                  {Math.round(
                    Math.hypot(imageWidth, imageHeight) *
                      LINE_SNAP_RADIUS_FRACTION,
                  )}{" "}
                  px
                </span>
              </div>
            )}
            {mlsdStatus === "cors-error" && (
              <p className="text-red-700">
                MLSD-kuva ladattu, mutta selain estää datan luvun
                (CORS). Snap ei voi toimia ennen kuin Fal CDN palauttaa
                CORS-headerit.
              </p>
            )}
            {mlsdStatus === "load-error" && (
              <p className="text-red-700">
                MLSD-kuvaa ei pystytty lataamaan. Tarkista verkkoyhteys.
              </p>
            )}
            {mlsdStatus === "loading" && (
              <p className="text-slate-500">Ladataan MLSD-viivakarttaa…</p>
            )}
          </div>

          {/* Live MLSD raster mirror */}
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-600 px-1">
              Debug: MLSD-viivakartta
            </h3>
            <div className="relative h-[55vh] rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900 flex items-center justify-center">
              {mlsdImageRef.current && canvasSize.w > 0 ? (
                <canvas
                  ref={debugCanvasRef}
                  width={canvasSize.w}
                  height={canvasSize.h}
                  className="block"
                  style={{ maxWidth: "100%", maxHeight: "100%" }}
                />
              ) : (
                <p className="text-slate-400 text-xs px-3 text-center">
                  MLSD-kuva ei ole vielä saatavilla.
                </p>
              )}
            </div>
            <p className="text-[10px] text-slate-500 px-1">
              Vaaleat viivat = MLSD:n havaitsemat rakenteelliset reunat.
              Klikkaukset näkyvät samalla yli — vihreä pinkkitäpläke =
              snap-piste.
            </p>
          </div>

          {/* Snap log */}
          <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
            <h3 className="text-[11px] uppercase tracking-wider font-bold text-slate-600 mb-2">
              Viimeiset klikkaukset
            </h3>
            {snapLog.length === 0 ? (
              <p className="text-slate-400">Ei vielä klikkauksia.</p>
            ) : (
              <ul className="space-y-1.5">
                {snapLog
                  .slice()
                  .reverse()
                  .map((s, idx) => (
                    <li
                      key={s.ts}
                      className="flex items-start gap-2 leading-snug"
                    >
                      <span className="font-mono text-slate-400 w-5 shrink-0">
                        {snapLog.length - idx}.
                      </span>
                      <span className="flex-1">
                        klikkaus ({s.raw.x.toFixed(0)},{" "}
                        {s.raw.y.toFixed(0)}) →{" "}
                        {s.snapped ? (
                          <>
                            <strong
                              className={
                                s.kind === "corner"
                                  ? "text-emerald-700"
                                  : "text-cyan-700"
                              }
                            >
                              {s.kind === "corner" ? "KULMA" : "viiva"}
                            </strong>{" "}
                            ({s.snapped.x.toFixed(0)},{" "}
                            {s.snapped.y.toFixed(0)}) · siirto{" "}
                            {s.distPx?.toFixed(0)} px / säde{" "}
                            {s.radiusPx.toFixed(0)} px
                          </>
                        ) : (
                          <span className="text-slate-500">
                            ei snap-osumaa säteellä{" "}
                            {s.radiusPx.toFixed(0)} px
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        /* Hidden in non-debug mode — keep the debug canvas mounted in
           a hidden div so the redraw effect always runs (no-op
           otherwise but harmless). */
        <div className="hidden">
          <canvas
            ref={debugCanvasRef}
            width={canvasSize.w}
            height={canvasSize.h}
          />
        </div>
      )}
    </div>
  );
}

function SnapStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    idle: { label: "Ei MLSD-kuvaa", cls: "bg-slate-200 text-slate-700" },
    loading: { label: "Ladataan…", cls: "bg-amber-100 text-amber-700" },
    ready: { label: "Valmis", cls: "bg-emerald-100 text-emerald-700" },
    "cors-error": {
      label: "CORS-virhe",
      cls: "bg-red-100 text-red-700",
    },
    "load-error": {
      label: "Latausvirhe",
      cls: "bg-red-100 text-red-700",
    },
  };
  const m = map[status] ?? map.idle;
  return (
    <span
      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide ${m.cls}`}
    >
      {m.label}
    </span>
  );
}
