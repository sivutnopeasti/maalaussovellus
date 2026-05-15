/**
 * Facade measurement library
 *
 * Three levels of accuracy (each requires more data):
 *
 * Level 1 — Basic pixel count
 *   wallAreaM2 = wallPixels / pixelsPerMeter²
 *
 * Level 2 — Per-pixel depth correction (requires depth map)
 *   Each wall pixel is weighted by (refDepth / pixelDepth)²
 *   Corrects for pixels that are farther / closer than the reference line.
 *
 * Level 3 — MLSD perspective foreshortening correction (requires MLSD map)
 *   Dominant horizontal line angle is extracted from the MLSD image.
 *   If the facade is viewed at angle θ from straight-on, the apparent width
 *   is cos(θ) of the true width → corrected area = rawArea / cos²(θ).
 */

import type { MaskResult, ReferenceData, MeasurementResult } from "./types";

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Count bright pixels in a remote mask image.
 * Used to enrich masks with pixelCount before area calculation.
 */
export function countMaskPixels(maskUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, c.width, c.height);
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 127) count++;
      }
      resolve(count);
    };
    img.onerror = () => reject(new Error(`Cannot load mask: ${maskUrl}`));
    img.src = maskUrl;
  });
}

export async function enrichMasksWithPixelCounts(
  masks: MaskResult[],
): Promise<MaskResult[]> {
  const counts = await Promise.all(
    masks.map((m) => countMaskPixels(m.url).catch(() => 0)),
  );
  return masks.map((m, i) => ({ ...m, pixelCount: counts[i] }));
}

/**
 * Level 1 — basic pixel-count calculation.
 */
export function calculateWallArea(
  masks: MaskResult[],
  reference: ReferenceData,
): MeasurementResult {
  const { pixelsPerMeter } = reference;
  const wallPixels = masks
    .filter((m) => m.category === "wall")
    .reduce((s, m) => s + (m.pixelCount ?? 0), 0);
  const openingPixels = masks
    .filter((m) => m.category === "opening")
    .reduce((s, m) => s + (m.pixelCount ?? 0), 0);
  const netWallPixels = Math.max(wallPixels - openingPixels, 0);
  return {
    wallPixels,
    openingPixels,
    netWallPixels,
    pixelsPerMeter,
    wallAreaM2: netWallPixels / (pixelsPerMeter * pixelsPerMeter),
  };
}

export interface PreciseMeasurementResult extends MeasurementResult {
  depthCorrectionFactor: number;
  perspectiveCorrectionFactor: number;
  dominantLineAngleDeg: number | null;
  method: "basic" | "depth" | "depth+perspective";
}

/**
 * Level 2 + 3 — per-pixel depth correction with optional MLSD perspective correction.
 *
 * Algorithm:
 *  1. Load depth map and all wall/opening masks.
 *  2. Sample depth along the reference line → reference depth D_ref.
 *  3. For every wall pixel: correction = (D_ref / D_pixel)²
 *     (closer pixels appear larger → need to be divided by more; farther → smaller)
 *  4. Weighted sum of corrections → depth-corrected pixel area → m².
 *  5. If MLSD map supplied: extract dominant horizontal line angle θ.
 *     Facade viewed at angle θ → foreshortening → divide by cos²(θ).
 */
export async function calculatePreciseMeasurement(
  masks: MaskResult[],
  reference: ReferenceData,
  depthMapUrl: string,
  mlsdMapUrl: string | null,
): Promise<PreciseMeasurementResult> {
  const basic = calculateWallArea(masks, reference);
  const { pixelsPerMeter } = reference;

  // ── Load depth map ────────────────────────────────────────────────────────
  let depthCanvas: HTMLCanvasElement | null = null;
  try {
    depthCanvas = await loadImageToCanvas(depthMapUrl);
  } catch {
    // Fall back to basic if depth unavailable
    return {
      ...basic,
      depthCorrectionFactor: 1,
      perspectiveCorrectionFactor: 1,
      dominantLineAngleDeg: null,
      method: "basic",
    };
  }

  const dCtx = depthCanvas.getContext("2d")!;
  const depthData = dCtx.getImageData(
    0,
    0,
    depthCanvas.width,
    depthCanvas.height,
  ).data;
  const dW = depthCanvas.width;
  const dH = depthCanvas.height;

  // Sample reference depth along the user's drawn line
  const refDepth = sampleLineDepth(
    depthData,
    dW,
    reference.point1,
    reference.point2,
  );

  if (refDepth < 1) {
    return {
      ...basic,
      depthCorrectionFactor: 1,
      perspectiveCorrectionFactor: 1,
      dominantLineAngleDeg: null,
      method: "basic",
    };
  }

  // ── Per-pixel depth-corrected area ────────────────────────────────────────
  const wallMasks = masks.filter((m) => m.category === "wall");
  const openingMasks = masks.filter((m) => m.category === "opening");

  const [wallWeightedPixels, openingWeightedPixels] = await Promise.all([
    sumDepthWeightedPixels(wallMasks, depthData, dW, dH, refDepth),
    sumDepthWeightedPixels(openingMasks, depthData, dW, dH, refDepth),
  ]);

  const netWeightedPixels = Math.max(
    wallWeightedPixels - openingWeightedPixels,
    0,
  );
  const depthCorrectedM2 =
    netWeightedPixels / (pixelsPerMeter * pixelsPerMeter);
  const depthCorrectionFactor =
    basic.wallAreaM2 > 0 ? depthCorrectedM2 / basic.wallAreaM2 : 1;

  // ── MLSD perspective / foreshortening correction ──────────────────────────
  let perspectiveCorrectionFactor = 1;
  let dominantLineAngleDeg: number | null = null;

  if (mlsdMapUrl) {
    try {
      const mlsdCanvas = await loadImageToCanvas(mlsdMapUrl);
      const mlsdData = mlsdCanvas
        .getContext("2d")!
        .getImageData(0, 0, mlsdCanvas.width, mlsdCanvas.height).data;

      dominantLineAngleDeg = extractDominantLineAngle(
        mlsdData,
        mlsdCanvas.width,
        mlsdCanvas.height,
      );

      if (dominantLineAngleDeg !== null) {
        // Facade is viewed at angle θ from head-on.
        // Apparent width = true_width × cos(θ)
        // → true_width = apparent_width / cos(θ)
        // → true_area = apparent_area / cos²(θ)
        const θ = (Math.abs(dominantLineAngleDeg) * Math.PI) / 180;
        const cosTheta = Math.cos(θ);
        if (cosTheta > 0.1) {
          perspectiveCorrectionFactor = 1 / (cosTheta * cosTheta);
          // Clamp to reasonable range: ±50% correction max
          perspectiveCorrectionFactor = Math.max(
            0.5,
            Math.min(2.0, perspectiveCorrectionFactor),
          );
        }
      }
    } catch {
      // MLSD correction is optional; ignore errors
    }
  }

  const finalAreaM2 = depthCorrectedM2 * perspectiveCorrectionFactor;

  return {
    wallPixels: basic.wallPixels,
    openingPixels: basic.openingPixels,
    netWallPixels: netWeightedPixels,
    pixelsPerMeter,
    wallAreaM2: finalAreaM2,
    depthCorrectionFactor,
    perspectiveCorrectionFactor,
    dominantLineAngleDeg,
    method:
      mlsdMapUrl && dominantLineAngleDeg !== null
        ? "depth+perspective"
        : "depth",
  };
}

/**
 * Simple depth-corrected area (kept for backward compat / fallback).
 */
export async function depthCorrectedArea(
  rawAreaM2: number,
  depthMapUrl: string,
  reference: ReferenceData,
  wallMaskUrl: string,
): Promise<number> {
  try {
    const [depthCanvas, maskCanvas] = await Promise.all([
      loadImageToCanvas(depthMapUrl),
      loadImageToCanvas(wallMaskUrl),
    ]);
    const dCtx = depthCanvas.getContext("2d")!;
    const mCtx = maskCanvas.getContext("2d")!;
    const dData = dCtx.getImageData(
      0,
      0,
      depthCanvas.width,
      depthCanvas.height,
    ).data;
    const mData = mCtx.getImageData(
      0,
      0,
      maskCanvas.width,
      maskCanvas.height,
    ).data;
    const refDepth = sampleLineDepth(
      dData,
      depthCanvas.width,
      reference.point1,
      reference.point2,
    );
    const wallDepth = sampleMaskedDepth(
      dData,
      mData,
      depthCanvas.width,
      depthCanvas.height,
    );
    if (refDepth === 0 || wallDepth === 0) return rawAreaM2;
    const cf = Math.max(0.5, Math.min(2.0, (refDepth / wallDepth) ** 2));
    return rawAreaM2 * cf;
  } catch {
    return rawAreaM2;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Sum depth-weighted pixel contributions from a list of masks.
 * Each pixel's contribution = (refDepth / pixelDepth)²
 * This corrects for perspective foreshortening on a per-pixel basis.
 */
async function sumDepthWeightedPixels(
  masks: MaskResult[],
  depthData: Uint8ClampedArray,
  dW: number,
  dH: number,
  refDepth: number,
): Promise<number> {
  let total = 0;
  for (const mask of masks) {
    try {
      const mc = await loadImageToCanvas(mask.url);
      const mCtx = mc.getContext("2d")!;
      const mData = mCtx.getImageData(0, 0, mc.width, mc.height).data;
      const mW = mc.width;
      const mH = mc.height;

      for (let y = 0; y < mH; y++) {
        for (let x = 0; x < mW; x++) {
          if (mData[(y * mW + x) * 4] > 127) {
            // Map mask pixel → depth map pixel
            const dx = Math.min(Math.round((x / mW) * dW), dW - 1);
            const dy = Math.min(Math.round((y / mH) * dH), dH - 1);
            const pixelDepth = depthData[(dy * dW + dx) * 4];

            if (pixelDepth > 0) {
              // DepthAnything: brighter = closer (inverse depth).
              // Correction: farther pixel → smaller in image → weight more.
              const correctionFactor = (refDepth / pixelDepth) ** 2;
              // Clamp per-pixel correction to prevent runaway values at edges
              total += Math.max(0.1, Math.min(4.0, correctionFactor));
            } else {
              total += 1;
            }
          }
        }
      }
    } catch {
      // Skip unloadable masks
    }
  }
  return total;
}

/**
 * Sample average depth value along a line between two points.
 * Uses the R channel of the depth map (grayscale).
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

function sampleMaskedDepth(
  depthData: Uint8ClampedArray,
  maskData: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      if (maskData[idx] > 127) {
        sum += depthData[idx];
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 0;
}

/**
 * Extract the dominant horizontal line angle from an MLSD image.
 *
 * Algorithm:
 *  1. Scan the MLSD image for white pixels (detected line pixels).
 *  2. For each pair of vertically-adjacent white pixels, compute local angle.
 *  3. Bucket angles into 1-degree bins; find the dominant bucket near 0° (horizontal).
 *  4. The dominant angle tells us how much the facade is rotated in the horizontal plane.
 *
 * Returns angle in degrees from horizontal (0 = perfectly head-on).
 * Returns null if no dominant line found.
 */
function extractDominantLineAngle(
  mlsdData: Uint8ClampedArray,
  width: number,
  height: number,
): number | null {
  // Accumulate gradient direction for white (line) pixels
  const angleBuckets = new Float32Array(180); // 0° – 179°

  const STRIDE = 4; // sample every 4th pixel for speed
  for (let y = STRIDE; y < height - STRIDE; y += STRIDE) {
    for (let x = STRIDE; x < width - STRIDE; x += STRIDE) {
      const idx = (y * width + x) * 4;
      if (mlsdData[idx] < 200) continue; // not a detected line pixel

      // Find line direction using local neighbourhood
      // Look for the nearest white pixel to the right/below to infer angle
      let bestDx = 0;
      let bestDy = 0;
      let bestDist = Infinity;

      for (let dy = -STRIDE * 2; dy <= STRIDE * 2; dy += STRIDE) {
        for (let dx = 1; dx <= STRIDE * 3; dx += STRIDE) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          if (mlsdData[(ny * width + nx) * 4] > 200) {
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < bestDist) {
              bestDist = dist;
              bestDx = dx;
              bestDy = dy;
            }
          }
        }
      }

      if (bestDist < Infinity && bestDx !== 0) {
        const angleDeg = Math.atan2(bestDy, bestDx) * (180 / Math.PI); // -180 to 180
        const bucket = Math.round(((angleDeg % 180) + 180) % 180); // 0-179
        angleBuckets[bucket] += 1;
      }
    }
  }

  // Find the dominant bucket near horizontal (buckets 0-20 and 160-179)
  let bestCount = 0;
  let bestAngle = 0;
  for (let b = 0; b < 180; b++) {
    const isNearHorizontal = b <= 25 || b >= 155;
    if (isNearHorizontal && angleBuckets[b] > bestCount) {
      bestCount = angleBuckets[b];
      bestAngle = b <= 25 ? b : b - 180; // convert to signed angle
    }
  }

  // Only return if we have a meaningful signal
  if (bestCount < 5) return null;
  // If angle is very close to 0°, no meaningful correction needed
  if (Math.abs(bestAngle) < 2) return null;
  return bestAngle;
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
