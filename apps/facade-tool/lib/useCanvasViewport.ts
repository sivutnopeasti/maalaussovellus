/**
 * Canvas viewport hook — adds zoom + pan to any 2D-canvas based
 * picker (ReferenceMeasure, PolygonSelect, …).
 *
 * The canvas displays an image at a base `imageScale` that fits the
 * container width. On top of that the user can zoom in to up to 8×
 * and pan around. The hook centralises:
 *
 *   - state for `zoom` and `pan` (in screen pixels)
 *   - desktop wheel + drag handlers
 *   - mobile single-finger pan + two-finger pinch handlers
 *   - convenience functions to map between screen, canvas and image
 *     coordinates, plus a `dotRadius` helper that returns a hit/draw
 *     radius constant in *screen* pixels (= shrinks in image-space as
 *     zoom increases, so the dots stay the same visual size).
 *
 * Consumer responsibilities:
 *   - call `applyTransform(ctx)` before drawing the image / overlay
 *     so canvas coordinates already incorporate zoom + pan
 *   - use `screenToImage()` inside click / mousemove handlers
 *   - use `dotRadius(basePx)` instead of a hard-coded radius
 *   - attach `eventProps` to the canvas element
 */

import { useCallback, useMemo, useRef, useState } from "react";
import type { Point } from "./types";

const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const WHEEL_ZOOM_STEP = 1.15;
const BUTTON_ZOOM_STEP = 1.5;

export interface CanvasViewportOptions {
  /** Base image-to-canvas scale (e.g. 0.42 when fitting a 4000-px
   *  image into a 1680-px container). */
  imageScale: number;
  /** Canvas size in CSS pixels — same as the width/height attributes
   *  passed to the <canvas>. */
  canvasW: number;
  canvasH: number;
}

export interface CanvasViewport {
  zoom: number;
  pan: { x: number; y: number };
  isPanning: boolean;
  /** Reset zoom to 1 and pan to (0,0). */
  reset: () => void;
  /** Zoom by a fixed step around the canvas centre. */
  zoomBy: (factor: number) => void;
  /** Zoom around an explicit canvas-coordinate anchor. */
  zoomAt: (factor: number, anchor: { x: number; y: number }) => void;
  /** Apply the current transform to a 2D context. Caller does this
   *  before drawImage/path operations; coordinates in subsequent
   *  drawing calls are in canvas-base pixels (= imageScale applied,
   *  zoom + pan added). */
  applyTransform: (ctx: CanvasRenderingContext2D) => void;
  /** Reset the context's transform back to identity. Called by the
   *  consumer after drawing the zoomed scene if it needs to draw
   *  anything in screen-space (e.g. a HUD overlay). */
  resetTransform: (ctx: CanvasRenderingContext2D) => void;
  /** Convert a screen-space point (e.g. from `e.clientX/clientY` minus
   *  `getBoundingClientRect()` offset) into image-space pixels. */
  screenToImage: (screenX: number, screenY: number) => Point;
  /** Convert an image-space point to canvas-base pixels (= pre-zoom).
   *  Used by drawing code if it needs to compute distances without
   *  manually re-applying the transform. */
  imageToCanvas: (p: Point) => Point;
  /** Returns a draw radius that stays constant on screen regardless
   *  of zoom — `basePx` is the desired screen-pixel radius. */
  dotRadius: (basePx: number) => number;
  /** Stroke / dash widths shrink the same way as `dotRadius` so they
   *  also look consistent at any zoom level. */
  strokeWidth: (basePx: number) => number;
  /** Props to spread onto the <canvas> element. */
  eventProps: {
    onWheel: (e: React.WheelEvent<HTMLCanvasElement>) => void;
    onPointerDown: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLCanvasElement>) => void;
    onTouchStart: (e: React.TouchEvent<HTMLCanvasElement>) => void;
    onTouchMove: (e: React.TouchEvent<HTMLCanvasElement>) => void;
    onTouchEnd: (e: React.TouchEvent<HTMLCanvasElement>) => void;
    style: React.CSSProperties;
  };
  /** True while a pan/pinch gesture is active. Consumer should
   *  suppress click handlers if this fires for a non-trivial distance
   *  to avoid accidental point placement when dragging. */
  consumeClickSuppression: () => boolean;
}

export function useCanvasViewport({
  imageScale,
  canvasW,
  canvasH,
}: CanvasViewportOptions): CanvasViewport {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);

  // Refs to avoid stale closures in pointer/touch handlers
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const panRef = useRef(pan);
  panRef.current = pan;

  // Pointer/touch state
  const dragStateRef = useRef<{
    startScreen: { x: number; y: number };
    startPan: { x: number; y: number };
    moved: boolean;
  } | null>(null);
  const pinchStateRef = useRef<{
    startDist: number;
    startZoom: number;
    /** Pan at the moment the second finger went down. */
    startPan: { x: number; y: number };
    /** Midpoint of the two fingers, in canvas coords, at the moment
     *  the second finger went down. */
    startCentreCanvas: { x: number; y: number };
  } | null>(null);
  /** Used to suppress a click event right after a pan gesture, so a
   *  drag of the canvas doesn't place an unwanted point. */
  const suppressNextClickRef = useRef(false);

  const clamp = (v: number, lo: number, hi: number) =>
    Math.min(hi, Math.max(lo, v));

  const reset = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  /** Zoom around a specific canvas-coordinate anchor so it stays put
   *  under the user's finger/cursor as they pinch/wheel. */
  const zoomAt = useCallback(
    (factor: number, anchor: { x: number; y: number }) => {
      const oldZoom = zoomRef.current;
      const newZoom = clamp(oldZoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (newZoom === oldZoom) return;
      const z = newZoom / oldZoom;
      // pan' = anchor - z * (anchor - pan)
      const pNow = panRef.current;
      const newPan = {
        x: anchor.x - z * (anchor.x - pNow.x),
        y: anchor.y - z * (anchor.y - pNow.y),
      };
      // Clamp pan so the image edges can't slip past the canvas
      // boundary (otherwise the user can scroll into grey emptiness).
      const maxPanX = Math.max(0, canvasW * (newZoom - 1));
      const maxPanY = Math.max(0, canvasH * (newZoom - 1));
      newPan.x = clamp(newPan.x, -maxPanX, 0);
      newPan.y = clamp(newPan.y, -maxPanY, 0);
      setZoom(newZoom);
      setPan(newPan);
    },
    [canvasW, canvasH],
  );

  const zoomBy = useCallback(
    (factor: number) => {
      zoomAt(factor, { x: canvasW / 2, y: canvasH / 2 });
    },
    [zoomAt, canvasW, canvasH],
  );

  const applyTransform = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      ctx.setTransform(zoom, 0, 0, zoom, pan.x, pan.y);
    },
    [zoom, pan],
  );

  const resetTransform = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }, []);

  const screenToImage = useCallback(
    (screenX: number, screenY: number): Point => {
      // Screen → canvas (subtract pan + divide by zoom)
      const canvasX = (screenX - pan.x) / zoom;
      const canvasY = (screenY - pan.y) / zoom;
      // Canvas → image (divide by base scale)
      return { x: canvasX / imageScale, y: canvasY / imageScale };
    },
    [pan, zoom, imageScale],
  );

  const imageToCanvas = useCallback(
    (p: Point): Point => ({ x: p.x * imageScale, y: p.y * imageScale }),
    [imageScale],
  );

  const dotRadius = useCallback((basePx: number) => basePx / zoom, [zoom]);
  const strokeWidth = useCallback(
    (basePx: number) => basePx / zoom,
    [zoom],
  );

  // ─── Event handlers ──────────────────────────────────────────────

  const getCanvasPoint = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
  ) => {
    const rect = canvas.getBoundingClientRect();
    // Account for CSS scaling — the canvas element may be rendered at
    // a different size than its width/height attributes.
    const sx = canvas.width / rect.width;
    const sy = canvas.height / rect.height;
    return {
      x: (clientX - rect.left) * sx,
      y: (clientY - rect.top) * sy,
    };
  };

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      const anchor = getCanvasPoint(e.currentTarget, e.clientX, e.clientY);
      const factor = e.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP;
      zoomAt(factor, anchor);
    },
    [zoomAt],
  );

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // Only start panning with primary mouse button or non-touch pointer
      if (e.pointerType === "touch") return; // touch handled by onTouch*
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const c = getCanvasPoint(e.currentTarget, e.clientX, e.clientY);
      dragStateRef.current = {
        startScreen: c,
        startPan: { ...panRef.current },
        moved: false,
      };
    },
    [],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "touch") return;
      const ds = dragStateRef.current;
      if (!ds) return;
      const c = getCanvasPoint(e.currentTarget, e.clientX, e.clientY);
      const dx = c.x - ds.startScreen.x;
      const dy = c.y - ds.startScreen.y;
      if (!ds.moved && Math.hypot(dx, dy) > 6) {
        ds.moved = true;
        setIsPanning(true);
      }
      if (ds.moved) {
        const z = zoomRef.current;
        const maxPanX = Math.max(0, canvasW * (z - 1));
        const maxPanY = Math.max(0, canvasH * (z - 1));
        setPan({
          x: clamp(ds.startPan.x + dx, -maxPanX, 0),
          y: clamp(ds.startPan.y + dy, -maxPanY, 0),
        });
      }
    },
    [canvasW, canvasH],
  );

  const endPointer = useCallback(() => {
    const ds = dragStateRef.current;
    if (ds?.moved) {
      suppressNextClickRef.current = true;
    }
    dragStateRef.current = null;
    setIsPanning(false);
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "touch") return;
      endPointer();
    },
    [endPointer],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (e.pointerType === "touch") return;
      endPointer();
    },
    [endPointer],
  );

  const onTouchStart = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const a = e.touches[0];
        const b = e.touches[1];
        const ca = getCanvasPoint(e.currentTarget, a.clientX, a.clientY);
        const cb = getCanvasPoint(e.currentTarget, b.clientX, b.clientY);
        pinchStateRef.current = {
          startDist: Math.hypot(ca.x - cb.x, ca.y - cb.y),
          startZoom: zoomRef.current,
          startPan: { ...panRef.current },
          startCentreCanvas: {
            x: (ca.x + cb.x) / 2,
            y: (ca.y + cb.y) / 2,
          },
        };
        dragStateRef.current = null;
        // The very act of putting two fingers down counts as a gesture
        // — suppress the next click so this two-finger tap doesn't
        // place a point on release.
        suppressNextClickRef.current = true;
      } else if (e.touches.length === 1) {
        const t = e.touches[0];
        const c = getCanvasPoint(e.currentTarget, t.clientX, t.clientY);
        dragStateRef.current = {
          startScreen: c,
          startPan: { ...panRef.current },
          moved: false,
        };
      }
    },
    [],
  );

  const onTouchMove = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length === 2 && pinchStateRef.current) {
        e.preventDefault();
        const a = e.touches[0];
        const b = e.touches[1];
        const ca = getCanvasPoint(e.currentTarget, a.clientX, a.clientY);
        const cb = getCanvasPoint(e.currentTarget, b.clientX, b.clientY);
        const dist = Math.hypot(ca.x - cb.x, ca.y - cb.y);
        const currentCentre = {
          x: (ca.x + cb.x) / 2,
          y: (ca.y + cb.y) / 2,
        };
        const ps = pinchStateRef.current;
        if (ps.startDist > 0) {
          // Combined zoom + pan: keep the image point that was under
          // the initial finger midpoint anchored to the current finger
          // midpoint, while scaling by the finger-spread ratio. Lets
          // the user slide the picture around with two fingers while
          // zooming, just like the photos / maps app.
          const factor = dist / ps.startDist;
          const targetZoom = clamp(
            ps.startZoom * factor,
            MIN_ZOOM,
            MAX_ZOOM,
          );
          const ratio = targetZoom / ps.startZoom;
          const newPanX =
            currentCentre.x - ratio * (ps.startCentreCanvas.x - ps.startPan.x);
          const newPanY =
            currentCentre.y - ratio * (ps.startCentreCanvas.y - ps.startPan.y);
          const maxPanX = Math.max(0, canvasW * (targetZoom - 1));
          const maxPanY = Math.max(0, canvasH * (targetZoom - 1));
          setZoom(targetZoom);
          setPan({
            x: clamp(newPanX, -maxPanX, 0),
            y: clamp(newPanY, -maxPanY, 0),
          });
        }
      } else if (e.touches.length === 1 && dragStateRef.current) {
        // Only pan when already zoomed in — otherwise we'd block native
        // scrolling and clicks on the page.
        if (zoomRef.current <= 1.001) return;
        e.preventDefault();
        const t = e.touches[0];
        const c = getCanvasPoint(e.currentTarget, t.clientX, t.clientY);
        const ds = dragStateRef.current;
        const dx = c.x - ds.startScreen.x;
        const dy = c.y - ds.startScreen.y;
        if (!ds.moved && Math.hypot(dx, dy) > 6) {
          ds.moved = true;
          setIsPanning(true);
        }
        if (ds.moved) {
          const z = zoomRef.current;
          const maxPanX = Math.max(0, canvasW * (z - 1));
          const maxPanY = Math.max(0, canvasH * (z - 1));
          setPan({
            x: clamp(ds.startPan.x + dx, -maxPanX, 0),
            y: clamp(ds.startPan.y + dy, -maxPanY, 0),
          });
        }
      }
    },
    [zoomAt, canvasW, canvasH],
  );

  const onTouchEnd = useCallback(
    (e: React.TouchEvent<HTMLCanvasElement>) => {
      if (e.touches.length < 2) pinchStateRef.current = null;
      if (e.touches.length === 0) endPointer();
    },
    [endPointer],
  );

  const consumeClickSuppression = useCallback(() => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return true;
    }
    return false;
  }, []);

  const eventProps = useMemo(
    () => ({
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      style: {
        touchAction: "none" as const,
      },
    }),
    [
      onWheel,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    ],
  );

  return {
    zoom,
    pan,
    isPanning,
    reset,
    zoomBy,
    zoomAt,
    applyTransform,
    resetTransform,
    screenToImage,
    imageToCanvas,
    dotRadius,
    strokeWidth,
    eventProps,
    consumeClickSuppression,
  };
}

export const ZOOM_STEP = BUTTON_ZOOM_STEP;
