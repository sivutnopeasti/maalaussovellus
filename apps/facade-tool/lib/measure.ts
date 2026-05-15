/**
 * Facade measurement library
 *
 * Polygon-based area calculation with two automatic perspective corrections:
 *
 * 1. VERTICAL (camera tilt up/down) — depth-map per-pixel weighting:
 *    Each pixel inside the polygon is weighted by (refDepth / pixelDepth)².
 *    Corrects for near/far distance differences when camera tilts upward.
 *
 * 2. HORIZONTAL (side-angle view) — MLSD roll separation:
 *    Reference line angle = roll + perspective.
 *    Vertical MLSD lines detect roll only → perspective = ref_angle − roll.
 *    Corrected area = rawArea / cos²(perspectiveAngle).
 */

import type { MaskResult, ReferenceData, Point } from "./types";

export interface PreciseMeasurementResult {
  wallPixels: number;
  openingPixels: number;
  netWallPixels: number;
  pixelsPerMeter: number;
  wallAreaM2: number;
  depthCorrectionFactor: number;
  perspectiveCorrectionFactor: number;
  dominantLineAngleDeg: number | null;
  method: "basic" | "depth" | "depth+perspective";
}

/**
 * Polygon-based area measurement with full perspective correction.
 *
 * The user draws a polygon around the exact facade outline (corners + roof ridge).
 *
 * TWO perspective corrections are applied automatically:
 *
 * 1. HORIZONTAL (side-angle) — from reference line angle (roll-separated via MLSD):
 *    If the facade is viewed at angle θ from straight-on → multiply by 1/cos(θ).
 *
 * 2. VERTICAL (camera tilt) — depth map, per-pixel:
 *    For each pixel inside the polygon, weight = (refDepth / pixelDepth)².
 *    Falls back to Shoelace formula if depth map unavailable.
 *
 * Opening areas (windows/doors from SAM 3) are subtracted, also depth-weighted.
 */
export async function calculatePolygonMeasurement(
  polygonPoints: Point[],
  masks: MaskResult[],
  imageWidth: number,
  imageHeight: number,
  reference: ReferenceData,
  depthMapUrl?: string,
  mlsdMapUrl?: string | null,
): Promise<PreciseMeasurementResult> {
  const ppm = reference.pixelsPerMeter;

  // ── 1. Perspective correction — separated from phone roll via MLSD ─────────
  const refAngleDeg = reference.angleDeg ?? 0;
  let perspectiveAngleDeg = refAngleDeg;
  let rollDeg = 0;

  if (mlsdMapUrl) {
    try {
      const mlsdCanvas = await loadImageToCanvas(mlsdMapUrl);
      const mlsdData = mlsdCanvas
        .getContext("2d")!
        .getImageData(0, 0, mlsdCanvas.width, mlsdCanvas.height).data;
      const extracted = extractRollAndPerspectiveFromMLSD(
        mlsdData, mlsdCanvas.width, mlsdCanvas.height, refAngleDeg,
      );
      rollDeg = extracted.rollDeg;
      perspectiveAngleDeg = extracted.perspectiveDeg;
    } catch {
      // MLSD unavailable — fall back to reference angle
    }
  }
  void rollDeg;

  let perspectiveCorrectionFactor = 1;
  if (Math.abs(perspectiveAngleDeg) > 1) {
    const cosTheta = Math.cos(Math.abs(perspectiveAngleDeg) * Math.PI / 180);
    if (cosTheta > 0.1) {
      perspectiveCorrectionFactor = Math.max(0.5, Math.min(2.5, 1 / cosTheta));
    }
  }

  // ── 2. Rasterise polygon into a canvas mask ────────────────────────────────
  const STRIDE = 2;
  const polyCanvas = document.createElement("canvas");
  polyCanvas.width = imageWidth;
  polyCanvas.height = imageHeight;
  const polyCtx = polyCanvas.getContext("2d")!;
  polyCtx.fillStyle = "white";
  polyCtx.beginPath();
  polyCtx.moveTo(polygonPoints[0].x, polygonPoints[0].y);
  for (let i = 1; i < polygonPoints.length; i++) {
    polyCtx.lineTo(polygonPoints[i].x, polygonPoints[i].y);
  }
  polyCtx.closePath();
  polyCtx.fill();
  const polyData = polyCtx.getImageData(0, 0, imageWidth, imageHeight).data;

  // ── 3. Depth-weighted pixel integration ───────────────────────────────────
  let grossWeightedPixels = 0;
  let grossRawPixels = 0;
  let depthCorrectionFactor = 1;

  if (depthMapUrl) {
    try {
      const depthCanvas = await loadImageToCanvas(depthMapUrl);
      const dCtx = depthCanvas.getContext("2d")!;
      const depthData = dCtx.getImageData(0, 0, depthCanvas.width, depthCanvas.height).data;
      const dW = depthCanvas.width;
      const dH = depthCanvas.height;

      const refDepth = sampleLineDepth(depthData, dW, reference.point1, reference.point2);

      if (refDepth >= 1) {
        for (let y = 0; y < imageHeight; y += STRIDE) {
          for (let x = 0; x < imageWidth; x += STRIDE) {
            if (polyData[(y * imageWidth + x) * 4] < 128) continue;
            grossRawPixels += STRIDE * STRIDE;

            const dx = Math.min(Math.round((x / imageWidth) * dW), dW - 1);
            const dy = Math.min(Math.round((y / imageHeight) * dH), dH - 1);
            const pixelDepth = depthData[(dy * dW + dx) * 4];
            const w = pixelDepth > 0
              ? Math.max(0.1, Math.min(4.0, (refDepth / pixelDepth) ** 2))
              : 1;
            grossWeightedPixels += w * STRIDE * STRIDE;
          }
        }
        depthCorrectionFactor =
          grossRawPixels > 0 ? grossWeightedPixels / grossRawPixels : 1;
      }
    } catch {
      // depth unavailable → fall through to Shoelace below
    }
  }

  // Fallback: Shoelace formula if depth integration didn't run
  if (grossRawPixels === 0) {
    let area = 0;
    const n = polygonPoints.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += polygonPoints[i].x * polygonPoints[j].y;
      area -= polygonPoints[j].x * polygonPoints[i].y;
    }
    grossRawPixels = Math.abs(area) / 2;
    grossWeightedPixels = grossRawPixels;
  }

  const grossAreaM2 =
    (grossWeightedPixels / (ppm * ppm)) * perspectiveCorrectionFactor;

  // ── 4. Opening areas (SAM 3 masks) — also depth-weighted ─────────────────
  const openingMasks = masks.filter((m) => m.category === "opening");
  let openingPixelsScaled = 0;
  for (const mask of openingMasks) {
    try {
      const mc = await loadImageToCanvas(mask.url);
      const data = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height).data;
      const hasTransparent = detectTransparentMask(data);
      let rawCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (hasTransparent ? data[i + 3] > 127 : data[i] > 127) rawCount++;
      }
      const scaleFactor = (imageWidth * imageHeight) / (mc.width * mc.height);
      openingPixelsScaled += rawCount * scaleFactor;
    } catch {
      // skip
    }
  }
  const openingAreaM2 =
    (openingPixelsScaled / (ppm * ppm)) * depthCorrectionFactor * perspectiveCorrectionFactor;
  const netAreaM2 = Math.max(grossAreaM2 - openingAreaM2, 0);

  const method: PreciseMeasurementResult["method"] = depthMapUrl && grossRawPixels > 0
    ? Math.abs(perspectiveAngleDeg) > 1 ? "depth+perspective" : "depth"
    : Math.abs(perspectiveAngleDeg) > 1 ? "depth+perspective" : "basic";

  return {
    wallPixels: grossRawPixels,
    openingPixels: openingPixelsScaled,
    netWallPixels: Math.max(grossRawPixels - openingPixelsScaled, 0),
    pixelsPerMeter: ppm,
    wallAreaM2: netAreaM2,
    depthCorrectionFactor,
    perspectiveCorrectionFactor,
    dominantLineAngleDeg: Math.abs(perspectiveAngleDeg) > 1 ? perspectiveAngleDeg : null,
    method,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns true when the mask image uses the alpha channel to encode selection.
 * Binary masks are solid PNGs (alpha=255 everywhere).
 * Heuristic: scan the first ~200 pixels for any fully transparent pixel.
 */
function detectTransparentMask(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < Math.min(data.length, 800); i += 4) {
    if (data[i] < 10) return true;
  }
  return false;
}

/**
 * Sample average depth value along a line between two points.
 */
function sampleLineDepth(
  depthData: Uint8ClampedArray,
  width: number,
  p1: { x: number; y: number },
  p2: { x: number; y: number },
): number {
  const steps = Math.max(Math.abs(p2.x - p1.x), Math.abs(p2.y - p1.y), 1);
  let sum = 0;
  let n = 0;
  for (let t = 0; t <= steps; t++) {
    const x = Math.round(p1.x + ((p2.x - p1.x) * t) / steps);
    const y = Math.round(p1.y + ((p2.y - p1.y) * t) / steps);
    if (x >= 0 && y >= 0) {
      sum += depthData[(y * width + x) * 4];
      n++;
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Build a full 0–179° angle histogram from MLSD line pixels.
 */
function buildMLSDAngleHistogram(
  mlsdData: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const buckets = new Float32Array(180);
  const STRIDE = 4;

  for (let y = STRIDE; y < height - STRIDE; y += STRIDE) {
    for (let x = STRIDE; x < width - STRIDE; x += STRIDE) {
      if (mlsdData[(y * width + x) * 4] < 200) continue;

      let bestDx = 0, bestDy = 0, bestDist = Infinity;

      for (let dy = -STRIDE * 2; dy <= STRIDE * 2; dy += STRIDE) {
        for (let dx = 0; dx <= STRIDE * 3; dx += STRIDE) {
          if (dx === 0 && dy <= 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (mlsdData[(ny * width + nx) * 4] > 200) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) { bestDist = dist; bestDx = dx; bestDy = dy; }
          }
        }
      }

      if (bestDist < Infinity && (bestDx !== 0 || bestDy !== 0)) {
        const angleDeg = Math.atan2(bestDy, bestDx) * (180 / Math.PI);
        const bucket = Math.round(((angleDeg % 180) + 180) % 180);
        buckets[bucket] += 1;
      }
    }
  }
  return buckets;
}

/**
 * Separate phone roll from true perspective angle using MLSD line data.
 *
 * Vertical building lines tilt only from roll, not from perspective.
 *   roll        = dominant_vertical_angle − 90°
 *   perspective = reference_angle − roll
 */
function extractRollAndPerspectiveFromMLSD(
  mlsdData: Uint8ClampedArray,
  width: number,
  height: number,
  referenceLineAngleDeg: number,
): { rollDeg: number; perspectiveDeg: number } {
  const buckets = buildMLSDAngleHistogram(mlsdData, width, height);

  let vertCount = 0, vertAngle = 90;
  for (let b = 65; b <= 115; b++) {
    if (buckets[b] > vertCount) { vertCount = buckets[b]; vertAngle = b; }
  }
  const rollDeg = vertCount >= 8 ? (vertAngle - 90) : 0;

  let horizCount = 0, horizAngle = 0;
  for (let b = 0; b < 180; b++) {
    const near = b <= 25 || b >= 155;
    if (near && buckets[b] > horizCount) {
      horizCount = buckets[b];
      horizAngle = b <= 25 ? b : b - 180;
    }
  }

  const combinedAngle =
    Math.abs(referenceLineAngleDeg) > 0.5
      ? referenceLineAngleDeg
      : horizCount >= 5 ? horizAngle : 0;

  const perspectiveDeg = combinedAngle - rollDeg;
  return { rollDeg, perspectiveDeg };
}

function loadImageToCanvas(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error(`Cannot load ${url}`));
    img.src = url;
  });
}
