/**
 * Automatic facade corner detection from a SAM 3 binary wall mask.
 *
 * Algorithm:
 *  1. Load mask image onto a canvas.
 *  2. For each row, find the leftmost and rightmost in-mask pixel.
 *     This produces left and right silhouette profiles.
 *  3. Apply Douglas-Peucker simplification to each profile.
 *  4. Concatenate: left profile (top→bottom) + right profile (bottom→top).
 *
 * Works for any facade shape: rectangular, gabled (pentagon), L-shaped, etc.
 * The result is typically 4–8 corner points.
 */

import type { Point } from "./types";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect facade polygon corners from a wall mask image URL.
 * Returns points in original image coordinates (top-left origin).
 * Returns null if detection fails.
 */
export async function detectFacadeCorners(
  maskUrl: string,
  imageWidth: number,
  imageHeight: number,
): Promise<Point[] | null> {
  try {
    const canvas = await loadMaskToCanvas(maskUrl, imageWidth, imageHeight);
    const ctx = canvas.getContext("2d")!;
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const W = canvas.width;
    const H = canvas.height;

    // Determine if mask uses alpha or brightness encoding
    let alphaMode = false;
    for (let i = 3; i < Math.min(data.length, 800); i += 4) {
      if (data[i] < 10) { alphaMode = true; break; }
    }
    const inMask = (i: number) => alphaMode ? data[i + 3] > 127 : data[i] > 127;

    // ── Build left/right silhouette profiles ─────────────────────────────────
    const leftProfile: Point[] = [];
    const rightProfile: Point[] = [];

    // Minimum mask width per row: skip very thin rows (fences, poles, noise).
    // Threshold = 4% of image width — removes narrow structures while keeping
    // gabled walls (which narrow gradually, not abruptly).
    const minRowWidth = imageWidth * 0.04;

    for (let y = 0; y < H; y++) {
      let leftX = -1;
      let rightX = -1;
      for (let x = 0; x < W; x++) {
        if (inMask((y * W + x) * 4)) {
          if (leftX === -1) leftX = x;
          rightX = x;
        }
      }
      if (leftX !== -1 && (rightX - leftX) >= minRowWidth) {
        leftProfile.push({ x: leftX, y });
        rightProfile.push({ x: rightX, y });
      }
    }

    if (leftProfile.length < 4) return null;

    // ── Douglas-Peucker with adaptive epsilon ─────────────────────────────────
    // Start at 3.5% of diagonal. If still too many points, double epsilon until
    // ≤ 8 points or epsilon > 15% (give up and return simplified version).
    const diagonal = Math.sqrt(imageWidth ** 2 + imageHeight ** 2);
    let epsilon = diagonal * 0.035;
    let simplLeft: Point[];
    let simplRight: Point[];

    do {
      simplLeft  = douglasPeucker(leftProfile,  epsilon);
      simplRight = douglasPeucker(rightProfile, epsilon);
      if (simplLeft.length + simplRight.length <= 10) break;
      epsilon *= 1.8;
    } while (epsilon < diagonal * 0.15);

    // ── Build polygon: left (top→bottom) + right (bottom→top) ────────────────
    const polygon: Point[] = [
      ...simplLeft,
      ...simplRight.slice().reverse(),
    ];

    // Remove near-duplicate points
    const deduped = deduplicatePoints(polygon, epsilon / 2);
    if (deduped.length < 3) return null;

    return deduped;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Douglas-Peucker polyline simplification. */
function douglasPeucker(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return [...points];

  const first = points[0];
  const last = points[points.length - 1];

  let maxDist = 0;
  let maxIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpendicularDistance(points[i], first, last);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }

  if (maxDist > epsilon) {
    const left  = douglasPeucker(points.slice(0, maxIdx + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIdx),         epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [first, last];
}

/** Perpendicular distance from point P to line (A→B). */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-10) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/** Remove consecutive points closer than minDist. */
function deduplicatePoints(points: Point[], minDist: number): Point[] {
  if (points.length === 0) return [];
  const result: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const prev = result[result.length - 1];
    const d = Math.sqrt((points[i].x - prev.x) ** 2 + (points[i].y - prev.y) ** 2);
    if (d >= minDist) result.push(points[i]);
  }
  return result;
}

function loadMaskToCanvas(
  url: string,
  targetW: number,
  targetH: number,
): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = targetW;
      c.height = targetH;
      c.getContext("2d")!.drawImage(img, 0, 0, targetW, targetH);
      resolve(c);
    };
    img.onerror = () => reject(new Error(`Cannot load mask: ${url}`));
    img.src = url;
  });
}
