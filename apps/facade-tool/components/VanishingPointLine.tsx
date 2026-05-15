"use client";

/**
 * VanishingPointLine — draw a second horizontal reference line
 *
 * The user clicks two points on a clearly horizontal edge of the building
 * (window sill, fascia board, horizontal board line, etc.).
 *
 * Combined with the first reference line (already stored in session),
 * the vanishing point is computed as the intersection of the two lines.
 * The VP is used for per-column horizontal foreshortening correction.
 *
 * Works for any wall shape, including gabled roofs.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { RotateCcw, Check, Crosshair } from "lucide-react";
import type { Point, ReferenceData } from "@/lib/types";

export interface VanishingPoint {
  x: number;
  y: number;
  /** If true, VP is effectively at infinity (lines are parallel → no correction) */
  atInfinity: boolean;
}

interface Props {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  /** First reference line from step 1 */
  reference: ReferenceData;
  onVanishingPointSet: (vp: VanishingPoint) => void;
}

export default function VanishingPointLine({
  imageUrl,
  imageWidth,
  imageHeight,
  reference,
  onVanishingPointSet,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [point1, setPoint1] = useState<Point | null>(null);
  const [point2, setPoint2] = useState<Point | null>(null);
  const [vp, setVp] = useState<VanishingPoint | null>(null);
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);

  // Load image once
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => setImgEl(img);
    img.src = imageUrl;
  }, [imageUrl]);

  // Rerender whenever points change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !imgEl) return;
    canvas.width = imgEl.width;
    canvas.height = imgEl.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(imgEl, 0, 0);

    const scaleX = imgEl.width / imageWidth;
    const scaleY = imgEl.height / imageHeight;

    // Draw first reference line (from step 1) in grey
    const r1 = reference;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(156,163,175,0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([12, 6]);
    ctx.moveTo(r1.point1.x * scaleX, r1.point1.y * scaleY);
    ctx.lineTo(r1.point2.x * scaleX, r1.point2.y * scaleY);
    ctx.stroke();
    ctx.setLineDash([]);
    // Label
    ctx.fillStyle = "rgba(156,163,175,0.9)";
    ctx.font = `${Math.round(imgEl.width * 0.022)}px sans-serif`;
    ctx.fillText(
      `Viite ${r1.meters}m`,
      r1.point1.x * scaleX + 6,
      r1.point1.y * scaleY - 6,
    );

    // Draw second horizon line in blue
    if (point1) {
      // First click dot
      ctx.beginPath();
      ctx.arc(point1.x * scaleX, point1.y * scaleY, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#3B82F6";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (point1 && point2) {
      // Draw the second line
      ctx.beginPath();
      ctx.strokeStyle = "#3B82F6";
      ctx.lineWidth = 3;
      ctx.moveTo(point1.x * scaleX, point1.y * scaleY);
      ctx.lineTo(point2.x * scaleX, point2.y * scaleY);
      ctx.stroke();
      // Second click dot
      ctx.beginPath();
      ctx.arc(point2.x * scaleX, point2.y * scaleY, 8, 0, Math.PI * 2);
      ctx.fillStyle = "#3B82F6";
      ctx.fill();
      ctx.strokeStyle = "white";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Draw vanishing point
    if (vp && !vp.atInfinity) {
      const vpX = vp.x * scaleX;
      const vpY = vp.y * scaleY;
      // Lines from both line endpoints to VP
      if (point1 && point2) {
        ctx.beginPath();
        ctx.strokeStyle = "rgba(251,191,36,0.5)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([8, 8]);
        // Extend the reference line toward VP
        ctx.moveTo(r1.point2.x * scaleX, r1.point2.y * scaleY);
        ctx.lineTo(vpX, vpY);
        ctx.moveTo(point2.x * scaleX, point2.y * scaleY);
        ctx.lineTo(vpX, vpY);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // VP crosshair
      const r = 14;
      ctx.beginPath();
      ctx.strokeStyle = "#FBBF24";
      ctx.lineWidth = 2.5;
      ctx.moveTo(vpX - r, vpY);
      ctx.lineTo(vpX + r, vpY);
      ctx.moveTo(vpX, vpY - r);
      ctx.lineTo(vpX, vpY + r);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(vpX, vpY, r / 2, 0, Math.PI * 2);
      ctx.fillStyle = "#FBBF24";
      ctx.fill();
    }
  }, [imgEl, point1, point2, vp, reference, imageWidth, imageHeight]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (vp) return; // already confirmed
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = imageWidth / rect.width;
      const scaleY = imageHeight / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      if (!point1) {
        setPoint1({ x, y });
      } else if (!point2) {
        const p2 = { x, y };
        setPoint2(p2);
        // Compute vanishing point immediately
        const computed = computeVanishingPoint(reference, { x: point1.x, y: point1.y }, p2);
        setVp(computed);
        onVanishingPointSet(computed);
      }
    },
    [point1, point2, vp, reference, imageWidth, imageHeight, onVanishingPointSet],
  );

  const reset = () => {
    setPoint1(null);
    setPoint2(null);
    setVp(null);
  };

  const isComplete = !!vp;

  return (
    <div className="space-y-3">
      {/* Instructions */}
      <div className="p-3 bg-blue-50 rounded-xl text-sm text-blue-800 space-y-1">
        <p className="font-medium flex items-center gap-1.5">
          <Crosshair className="w-4 h-4" />
          Piirrä toinen vaakalinja perspektiiviksi
        </p>
        <p className="text-xs text-blue-600">
          {!point1
            ? "Klikkaa ensimmäinen piste jonkin vaakasuoran rakenteen päällä (esim. ikkunalauta, lauta, räystäs)"
            : !point2
              ? "Klikkaa toinen piste samalle vaakalinjalle"
              : isComplete
                ? vp?.atInfinity
                  ? "Viivat ovat lähes yhdensuuntaiset — rakennus kuvattu suoraan edestä, perspektiivikorjausta ei tarvita."
                  : "Katoava piste laskettu (keltainen rasti). Perspektiivikorjaus on käytössä."
                : ""}
        </p>
      </div>

      {/* Canvas */}
      <div className="relative rounded-xl overflow-hidden border border-slate-200">
        <canvas
          ref={canvasRef}
          className={`w-full block ${!isComplete ? "cursor-crosshair" : "cursor-default"}`}
          onClick={handleClick}
        />
        {/* Status badges */}
        {isComplete && (
          <div className="absolute top-2 left-2">
            <span className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-white shadow ${
              vp?.atInfinity ? "bg-slate-600" : "bg-amber-500"
            }`}>
              <Check className="w-3 h-3" />
              {vp?.atInfinity ? "Suora näkymä — ei korjausta" : "Perspektiivikorjaus laskettu"}
            </span>
          </div>
        )}
      </div>

      {/* Reset */}
      {(point1 || point2) && (
        <button
          onClick={reset}
          className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          Piirrä uudelleen
        </button>
      )}
    </div>
  );
}

// ─── Vanishing point math ────────────────────────────────────────────────────

/**
 * Compute the vanishing point from two lines.
 *
 * Line A = reference line (already drawn in step 1)
 * Line B = new horizon line (drawn now)
 *
 * Both lines should represent parallel horizontal edges of the building.
 * Their intersection in image space = the vanishing point.
 */
export function computeVanishingPoint(
  reference: ReferenceData,
  lineB1: Point,
  lineB2: Point,
): VanishingPoint {
  const ax1 = reference.point1.x, ay1 = reference.point1.y;
  const ax2 = reference.point2.x, ay2 = reference.point2.y;
  const bx1 = lineB1.x, by1 = lineB1.y;
  const bx2 = lineB2.x, by2 = lineB2.y;

  const dax = ax2 - ax1, day = ay2 - ay1;
  const dbx = bx2 - bx1, dby = by2 - by1;

  // Cross product of direction vectors
  const cross = dax * dby - day * dbx;

  // If cross ≈ 0, lines are parallel → VP at infinity → no perspective correction
  if (Math.abs(cross) < 1e-6) {
    return { x: 0, y: 0, atInfinity: true };
  }

  // Parametric intersection
  const t = ((bx1 - ax1) * dby - (by1 - ay1) * dbx) / cross;
  const vpX = ax1 + t * dax;
  const vpY = ay1 + t * day;

  // If VP is very far from the image (>10× image width), treat as infinity
  const imageApproxWidth = Math.max(Math.abs(ax2 - ax1) * 5, 500);
  const distFromCenter = Math.sqrt(
    (vpX - (ax1 + ax2) / 2) ** 2 + (vpY - (ay1 + ay2) / 2) ** 2,
  );
  if (distFromCenter > imageApproxWidth * 8) {
    return { x: vpX, y: vpY, atInfinity: true };
  }

  return { x: vpX, y: vpY, atInfinity: false };
}
