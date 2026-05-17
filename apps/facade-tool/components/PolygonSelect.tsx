"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Hexagon, RotateCcw, Check, Undo2, Magnet } from "lucide-react";
import type { Point, PolygonData, ReferenceData } from "@/lib/types";
import { findReferenceVerticalEdge } from "@/lib/wallHeight";
import {
  buildLineMap,
  snapToNearestLine,
  isLikelyIntersection,
  type LineMapData,
} from "@/lib/lineSnap";

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
   * within ~3% of the image diagonal — making polygon corner placement
   * pixel-accurate.
   */
  mlsdMapUrl?: string;
}

type Phase = "drawing" | "done";

/** Snap radius as a fraction of the image diagonal. 5% catches clicks
 *  that are a finger-width off on a phone while still being small
 *  enough that the snap target is unambiguous. */
const SNAP_RADIUS_FRACTION = 0.05;

/** If a candidate within this fraction of the best one is a likely
 *  intersection (3+ neighbour line pixels), prefer it. This pulls
 *  snaps onto building corners rather than mid-segment edge points. */
const INTERSECTION_BIAS = 1.5;

export default function PolygonSelect({
  imageUrl,
  imageWidth,
  imageHeight,
  onPolygonSet,
  reference,
  autoWallHeightM,
  mlsdMapUrl,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const debugCanvasRef = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const mlsdImageRef = useRef<HTMLImageElement | null>(null);
  const lineMapRef = useRef<LineMapData | null>(null);
  const [lineMapReady, setLineMapReady] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [points, setPoints] = useState<Point[]>([]);
  const [snapHint, setSnapHint] = useState<{ from: Point; to: Point } | null>(
    null,
  );
  /** Live preview of where a click at the current mouse position would
   *  land after snapping. Drawn under the cursor while the user is
   *  drawing, so they know exactly which edge the click will snap to
   *  before committing. */
  const [hoverSnap, setHoverSnap] = useState<{
    cursor: Point;
    snapped: Point | null;
  } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [phase, setPhase] = useState<Phase>("drawing");
  /** Debug stats published once the MLSD raster is decoded. */
  const [mlsdStats, setMlsdStats] = useState<{
    lmW: number;
    lmH: number;
    whitePixels: number;
    whiteRatio: number;
  } | null>(null);
  /** Diagnostic info about the most recent click → snap. */
  const [lastSnap, setLastSnap] = useState<{
    raw: Point;
    snapped: Point | null;
    distPx: number | null;
    radiusPx: number;
  } | null>(null);

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

  // Load and decode the M-LSD line map for click snapping. We do this
  // off-screen as soon as the URL is available — typically before the
  // user has finished placing their first point. The decoded HTMLImage
  // is also kept so the debug-canvas below can render it.
  useEffect(() => {
    if (!mlsdMapUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const lm = buildLineMap(img);
        lineMapRef.current = lm;
        mlsdImageRef.current = img;
        setMlsdStats({
          lmW: lm.width,
          lmH: lm.height,
          whitePixels: lm.whitePixels,
          whiteRatio: lm.whiteRatio,
        });
        setLineMapReady(true);
        console.log("[snap] MLSD map decoded", {
          mlsd: `${lm.width}×${lm.height}`,
          source: `${imageWidth}×${imageHeight}`,
          whitePixels: lm.whitePixels,
          whiteRatio: (lm.whiteRatio * 100).toFixed(2) + "%",
          aspectMatches:
            Math.abs(lm.width / lm.height - imageWidth / imageHeight) < 0.01,
        });
      } catch (err) {
        console.warn("[snap] failed to decode MLSD map (likely CORS)", err);
      }
    };
    img.onerror = () => {
      if (!cancelled) console.warn("[snap] MLSD image failed to load");
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
   *  the source photo) and the debug canvas (over the MLSD line map). */
  const drawOverlay = useCallback(
    (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => {
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

    if (points.length >= 2 && effectivePpm !== null) {
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

    // Snap hint — flash showing how the click was nudged onto a
    // detected building edge. Cleared after ~700 ms.
    if (snapHint) {
      ctx.save();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(sx(snapHint.from), sy(snapHint.from));
      ctx.lineTo(sx(snapHint.to), sy(snapHint.to));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx(snapHint.to), sy(snapHint.to), 13, 0, Math.PI * 2);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }

    // Live hover preview — shows where a click at the current cursor
    // position would land after snapping. A bright dot at the snap
    // target plus a thin guide line from the cursor to it.
    if (hoverSnap && phase === "drawing") {
      ctx.save();
      if (hoverSnap.snapped) {
        const cx = sx(hoverSnap.cursor);
        const cy = sy(hoverSnap.cursor);
        const tx = sx(hoverSnap.snapped);
        const ty = sy(hoverSnap.snapped);
        // Guide line cursor → snap point
        ctx.strokeStyle = "rgba(34, 211, 238, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.setLineDash([]);
        // Filled cyan dot at snap target
        ctx.beginPath();
        ctx.arc(tx, ty, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#22d3ee";
        ctx.fill();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      } else {
        // No snap candidate near cursor — show a small empty ring so
        // the user knows snap was tried and failed (helps locate the
        // detected lines visually).
        const cx = sx(hoverSnap.cursor);
        const cy = sy(hoverSnap.cursor);
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(148, 163, 184, 0.6)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [points, scale, phase, effectivePpm, getSegmentLength, snapHint, hoverSnap]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imageRef.current;
    if (!canvas || !img || canvasSize.w === 0) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    drawOverlay(ctx, canvas);
  }, [canvasSize, drawOverlay]);

  /** Debug canvas — same dimensions as the main one, but the M-LSD line
   *  raster underneath instead of the source photo. Lets the user check
   *  visually whether the polygon edges they're drawing land on detected
   *  building lines. Temporary feature. */
  const redrawDebug = useCallback(() => {
    const canvas = debugCanvasRef.current;
    const mlsd = mlsdImageRef.current;
    if (!canvas || !mlsd || canvasSize.w === 0) return;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mlsd, 0, 0, canvas.width, canvas.height);
    drawOverlay(ctx, canvas);
  }, [canvasSize, drawOverlay]);

  useEffect(() => {
    redraw();
    redrawDebug();
  }, [redraw, redrawDebug, lineMapReady]);

  /** Resolve the snap target for a given raw point in image-space.
   *  Returns the snapped point + diagnostic info, or null when snap is
   *  disabled / no line is within radius. Shared between mouseMove (live
   *  preview) and click (commit). */
  const resolveSnap = useCallback(
    (raw: Point): { snapped: Point | null; distPx: number | null; radius: number } => {
      const diag = Math.hypot(imageWidth, imageHeight);
      const radius = diag * SNAP_RADIUS_FRACTION;
      if (!snapEnabled || !lineMapRef.current) {
        return { snapped: null, distPx: null, radius };
      }
      const lm = lineMapRef.current;
      const lmScaleX = lm.width / imageWidth;
      const lmScaleY = lm.height / imageHeight;
      const snapped = snapToNearestLine(raw, lm, radius, lmScaleX, lmScaleY);
      if (!snapped) return { snapped: null, distPx: null, radius };

      // Intersection bias: if the candidate is on a line but NOT an
      // intersection, do a tiny extra search in the 8-neighbourhood for
      // an intersection pixel and prefer it if it's not too far.
      const lx = Math.round(snapped.x * lmScaleX);
      const ly = Math.round(snapped.y * lmScaleY);
      if (!isLikelyIntersection(lx, ly, lm)) {
        const intRadiusLm = Math.max(
          2,
          Math.round(radius * INTERSECTION_BIAS * Math.min(lmScaleX, lmScaleY)),
        );
        let bestX = lx;
        let bestY = ly;
        let bestD2 = Infinity;
        for (let dy = -intRadiusLm; dy <= intRadiusLm; dy++) {
          for (let dx = -intRadiusLm; dx <= intRadiusLm; dx++) {
            const x = lx + dx;
            const y = ly + dy;
            if (x <= 0 || x >= lm.width - 1 || y <= 0 || y >= lm.height - 1)
              continue;
            if (!lm.mask[y * lm.width + x]) continue;
            if (!isLikelyIntersection(x, y, lm)) continue;
            const d2 = dx * dx + dy * dy;
            if (d2 < bestD2) {
              bestD2 = d2;
              bestX = x;
              bestY = y;
            }
          }
        }
        if (bestD2 !== Infinity) {
          snapped.x = bestX / lmScaleX;
          snapped.y = bestY / lmScaleY;
        }
      }

      const distPx = Math.hypot(snapped.x - raw.x, snapped.y - raw.y);
      return { snapped, distPx, radius };
    },
    [snapEnabled, imageWidth, imageHeight],
  );

  const handleCanvasMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "drawing") return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const rawX = (e.clientX - rect.left) / scale;
      const rawY = (e.clientY - rect.top) / scale;
      const cursor: Point = { x: rawX, y: rawY };
      const { snapped } = resolveSnap(cursor);
      setHoverSnap({ cursor, snapped });
    },
    [phase, scale, resolveSnap],
  );

  const handleCanvasLeave = useCallback(() => {
    setHoverSnap(null);
  }, []);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "drawing") return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const rawX = (e.clientX - rect.left) / scale;
      const rawY = (e.clientY - rect.top) / scale;
      const raw: Point = { x: rawX, y: rawY };

      const { snapped, distPx, radius } = resolveSnap(raw);
      setLastSnap({ raw, snapped, distPx, radiusPx: radius });
      console.log("[snap] click", {
        raw: `(${rawX.toFixed(0)}, ${rawY.toFixed(0)})`,
        snapped: snapped
          ? `(${snapped.x.toFixed(0)}, ${snapped.y.toFixed(0)})`
          : "null (no line within radius)",
        distPx: distPx?.toFixed(1),
        radiusPx: radius.toFixed(0),
      });
      const final = snapped ?? raw;
      if (snapped) {
        setSnapHint({ from: raw, to: snapped });
        window.setTimeout(() => setSnapHint(null), 700);
      }
      setPoints((prev) => [...prev, final]);
    },
    [phase, scale, resolveSnap],
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

      {usingAutoScale && (
        <div className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-xs text-indigo-700 flex items-start gap-2">
          <span className="font-bold mt-0.5">⚡</span>
          <span>
            Mittakaava johdetaan polygonin pystyreunoista{" "}
            (talon nurkan korkeus <strong>{autoWallHeightM!.toFixed(2)} m</strong>).
            {points.length < 2 && (
              <> Klikkaa ensin pystysuora nurkka ylhäältä alas, niin mitat ilmestyvät.</>
            )}
          </span>
        </div>
      )}

      {mlsdMapUrl && (
        <div className="flex items-center justify-between gap-3 px-3 py-2 bg-cyan-50 border border-cyan-200 rounded-lg text-xs">
          <div className="flex items-center gap-2 text-cyan-800">
            <Magnet className="w-4 h-4" />
            <span>
              <strong>Reunatunnistus</strong>{" "}
              {!lineMapReady ? (
                <span className="text-cyan-600">— ladataan…</span>
              ) : snapEnabled ? (
                <span>
                  — <span className="text-cyan-700 font-medium">syaaninen piste</span>{" "}
                  hiiren alla näyttää mihin klikkaus snäppää.
                </span>
              ) : (
                <span className="text-cyan-600">— pois käytöstä.</span>
              )}
            </span>
          </div>
          {lineMapReady && (
            <button
              onClick={() => setSnapEnabled((s) => !s)}
              className={`px-2 py-1 rounded font-medium transition-colors ${
                snapEnabled
                  ? "bg-cyan-600 text-white hover:bg-cyan-700"
                  : "border border-cyan-300 text-cyan-700 hover:bg-cyan-100"
              }`}
            >
              {snapEnabled ? "Päällä" : "Pois"}
            </button>
          )}
        </div>
      )}

      <div className="relative rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-900">
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onClick={handleCanvasClick}
          onMouseMove={handleCanvasMove}
          onMouseLeave={handleCanvasLeave}
          className={`block w-full ${phase === "drawing" ? "cursor-crosshair" : "cursor-default"}`}
        />
      </div>

      {/* TEMPORARY DEBUG: MLSD line-map view with the same polygon
          points and edges drawn on top, so we can verify by eye that
          clicks land on detected building edges. */}
      {mlsdMapUrl && lineMapReady && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-cyan-700">
              MLSD-viivakartta (debug)
            </span>
            <span className="text-slate-400">
              Tunnistetut rakennusreunat + sama polygoni päällä
            </span>
          </div>

          {/* Diagnostic stats — helps see WHY snap might fail */}
          {mlsdStats && (
            <div className="text-[10px] leading-tight font-mono px-2 py-1.5 bg-slate-50 border border-slate-200 rounded text-slate-600 space-y-0.5">
              <div>
                MLSD: <strong>{mlsdStats.lmW}×{mlsdStats.lmH}</strong>{" "}
                · source: <strong>{imageWidth}×{imageHeight}</strong>{" "}
                · aspect{" "}
                {Math.abs(
                  mlsdStats.lmW / mlsdStats.lmH - imageWidth / imageHeight,
                ) < 0.01 ? (
                  <span className="text-green-600">match</span>
                ) : (
                  <span className="text-amber-600">
                    DIFFER (stretch correction active)
                  </span>
                )}
              </div>
              <div>
                Valkoisia pikseleitä:{" "}
                <strong>{mlsdStats.whitePixels.toLocaleString()}</strong>{" "}
                ({(mlsdStats.whiteRatio * 100).toFixed(2)}%){" "}
                {mlsdStats.whitePixels < 100 && (
                  <span className="text-red-600 font-semibold">
                    — TYHJÄ MASK, snap ei voi toimia
                  </span>
                )}
              </div>
              {lastSnap && (
                <div>
                  Edellinen klikkaus:{" "}
                  {lastSnap.snapped ? (
                    <span className="text-green-700">
                      snäpattiin {lastSnap.distPx?.toFixed(0)} px
                      (raja {lastSnap.radiusPx.toFixed(0)} px)
                    </span>
                  ) : (
                    <span className="text-red-600">
                      ei snap — ei viivaa {lastSnap.radiusPx.toFixed(0)} px
                      säteen sisällä
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="relative rounded-xl overflow-hidden border-2 border-cyan-300 bg-black">
            <canvas
              ref={debugCanvasRef}
              width={canvasSize.w}
              height={canvasSize.h}
              className="block w-full"
            />
          </div>
        </div>
      )}

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
