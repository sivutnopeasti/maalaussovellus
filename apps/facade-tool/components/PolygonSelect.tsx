"use client";

import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { Hexagon, RotateCcw, Check, Undo2, Magnet } from "lucide-react";
import type { Point, PolygonData, ReferenceData } from "@/lib/types";
import { findReferenceVerticalEdge } from "@/lib/wallHeight";
import { buildLineMap, snapToNearestLine, type LineMapData } from "@/lib/lineSnap";

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

/** Snap radius as a fraction of the image diagonal. ~3% is enough to
 *  catch slightly-imperfect clicks but small enough to avoid pulling
 *  to a wrong nearby line. */
const SNAP_RADIUS_FRACTION = 0.03;

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
  const imageRef = useRef<HTMLImageElement | null>(null);
  const lineMapRef = useRef<LineMapData | null>(null);
  const [lineMapReady, setLineMapReady] = useState(false);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [points, setPoints] = useState<Point[]>([]);
  const [snapHint, setSnapHint] = useState<{ from: Point; to: Point } | null>(
    null,
  );
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

  // Load and decode the M-LSD line map for click snapping. We do this
  // off-screen as soon as the URL is available — typically before the
  // user has finished placing their first point.
  useEffect(() => {
    if (!mlsdMapUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        lineMapRef.current = buildLineMap(img);
        setLineMapReady(true);
      } catch (err) {
        console.warn("[PolygonSelect] failed to decode MLSD map", err);
      }
    };
    img.onerror = () => {
      if (!cancelled) console.warn("[PolygonSelect] MLSD image failed to load");
    };
    img.src = mlsdMapUrl;
    return () => {
      cancelled = true;
    };
  }, [mlsdMapUrl]);

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

    // Snap hint — short flash showing how the click was nudged onto a
    // detected building edge. Cleared after ~350 ms.
    if (snapHint) {
      ctx.save();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(sx(snapHint.from), sy(snapHint.from));
      ctx.lineTo(sx(snapHint.to), sy(snapHint.to));
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(sx(snapHint.to), sy(snapHint.to), 11, 0, Math.PI * 2);
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }, [points, canvasSize, scale, phase, effectivePpm, getSegmentLength, snapHint]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (phase !== "drawing") return;
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const rawX = (e.clientX - rect.left) / scale;
      const rawY = (e.clientY - rect.top) / scale;
      const raw: Point = { x: rawX, y: rawY };

      // Try snapping to the nearest MLSD line pixel (if the map is
      // loaded and snap is on). The line map is generated from the
      // source image so its coordinate system matches the points we
      // store internally.
      let final: Point = raw;
      if (snapEnabled && lineMapRef.current) {
        const lm = lineMapRef.current;
        // Map could be at a different resolution than the source — use
        // its width vs the displayed image to derive a scale factor.
        const lmScale = lm.width / imageWidth;
        const diag = Math.hypot(imageWidth, imageHeight);
        const radius = diag * SNAP_RADIUS_FRACTION;
        const snapped = snapToNearestLine(raw, lm, radius, lmScale);
        if (snapped) {
          final = snapped;
          setSnapHint({ from: raw, to: snapped });
          window.setTimeout(() => setSnapHint(null), 350);
        }
      }
      setPoints((prev) => [...prev, final]);
    },
    [phase, scale, snapEnabled, imageWidth, imageHeight],
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
                <span>— klikit kiinnittyvät talon reunoihin.</span>
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
