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

import type { MaskResult, ReferenceData, MeasurementResult, Point } from "./types";

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
        if (data[i] > 127 || data[i + 3] > 127) count++;
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
  vanishingPointCorrectionFactor: number;
  method: "basic" | "depth" | "depth+perspective" | "depth+vp" | "depth+vp+perspective";
}

export interface VanishingPointData {
  x: number;
  y: number;
  atInfinity: boolean;
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
  vanishingPoint?: VanishingPointData | null,
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
      vanishingPointCorrectionFactor: 1,
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
      vanishingPointCorrectionFactor: 1,
      dominantLineAngleDeg: null,
      method: "basic",
    };
  }

  // ── Per-pixel depth-corrected area ────────────────────────────────────────
  const wallMasks = masks.filter((m) => m.category === "wall");
  const openingMasks = masks.filter((m) => m.category === "opening");

  const [wallWeightedPixels, openingWeightedPixels] = await Promise.all([
    sumDepthWeightedPixels(
      wallMasks, depthData, dW, dH, refDepth, vanishingPoint ?? null, reference,
    ),
    sumDepthWeightedPixels(
      openingMasks, depthData, dW, dH, refDepth, vanishingPoint ?? null, reference,
    ),
  ]);

  const netWeightedPixels = Math.max(
    wallWeightedPixels - openingWeightedPixels,
    0,
  );
  const depthCorrectedM2 =
    netWeightedPixels / (pixelsPerMeter * pixelsPerMeter);
  const depthCorrectionFactor =
    basic.wallAreaM2 > 0 ? depthCorrectedM2 / basic.wallAreaM2 : 1;

  // ── Vanishing-point correction factor (informational) ─────────────────────
  // Already applied per-pixel in sumDepthWeightedPixels when VP provided.
  const vanishingPointCorrectionFactor =
    vanishingPoint && !vanishingPoint.atInfinity
      ? depthCorrectedM2 / (basic.wallAreaM2 > 0
          ? basic.wallAreaM2 * depthCorrectionFactor
          : 1)
      : 1;

  // ── Perspective / foreshortening correction ───────────────────────────────
  // Priority 1: reference line angle (user drew along a known horizontal element).
  //   The line tilt directly encodes how much the facade is viewed from an angle.
  //   true_area ≈ apparent_area / cos(θ)  where θ = reference line angle from horizontal.
  //
  // Priority 2: MLSD dominant line angle (automatic, less precise).
  // Priority 3: no correction (head-on view assumed).
  let perspectiveCorrectionFactor = 1;
  let dominantLineAngleDeg: number | null = null;

  const refAngle = reference.angleDeg ?? 0;
  const refAngleAbs = Math.abs(refAngle);

  if (refAngleAbs > 1) {
    // The reference line was drawn along a known-horizontal feature (e.g. bottom board).
    // Its tilt in the image = perspective angle of the facade.
    // Foreshortening correction: true width = apparent / cos(θ) → area / cos(θ).
    dominantLineAngleDeg = refAngle;
    const cosTheta = Math.cos((refAngleAbs * Math.PI) / 180);
    if (cosTheta > 0.1) {
      perspectiveCorrectionFactor = 1 / cosTheta;
      perspectiveCorrectionFactor = Math.max(0.5, Math.min(2.5, perspectiveCorrectionFactor));
    }
  } else if (mlsdMapUrl) {
    // Fallback: extract dominant line angle from MLSD map
    try {
      const mlsdCanvas = await loadImageToCanvas(mlsdMapUrl);
      const mlsdData = mlsdCanvas
        .getContext("2d")!
        .getImageData(0, 0, mlsdCanvas.width, mlsdCanvas.height).data;

      dominantLineAngleDeg = extractDominantLineAngle(
        mlsdData, mlsdCanvas.width, mlsdCanvas.height,
      );

      if (dominantLineAngleDeg !== null) {
        const θ = (Math.abs(dominantLineAngleDeg) * Math.PI) / 180;
        const cosTheta = Math.cos(θ);
        if (cosTheta > 0.1) {
          perspectiveCorrectionFactor = 1 / cosTheta;
          perspectiveCorrectionFactor = Math.max(0.5, Math.min(2.5, perspectiveCorrectionFactor));
        }
      }
    } catch {
      // MLSD correction is optional; ignore errors
    }
  }

  const finalAreaM2 = depthCorrectedM2 * perspectiveCorrectionFactor;

  const hasVP = vanishingPoint && !vanishingPoint.atInfinity;
  const hasRefAngle = refAngleAbs > 1;
  const hasMLSD = !hasRefAngle && mlsdMapUrl && dominantLineAngleDeg !== null;
  const method = hasVP
    ? hasMLSD ? "depth+vp+perspective" : "depth+vp"
    : hasRefAngle ? "depth+perspective" : hasMLSD ? "depth+perspective" : "depth";

  return {
    wallPixels: basic.wallPixels,
    openingPixels: basic.openingPixels,
    netWallPixels: netWeightedPixels,
    pixelsPerMeter,
    wallAreaM2: finalAreaM2,
    depthCorrectionFactor,
    perspectiveCorrectionFactor,
    dominantLineAngleDeg,
    vanishingPointCorrectionFactor,
    method,
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
 * Sum depth + vanishing-point weighted pixel contributions from a list of masks.
 *
 * Each pixel's contribution = depth_weight × vp_weight
 *
 * depth_weight  = (refDepth / pixelDepth)²
 *   → corrects for near/far distance differences
 *
 * vp_weight = refDistToVP / |pixelX - vp_x|
 *   → corrects for horizontal foreshortening from camera angle
 *   → pixels near the vanishing point are foreshortened → need more weight
 *   → works for any wall shape (pentagon, trapezoid, etc.)
 */
async function sumDepthWeightedPixels(
  masks: MaskResult[],
  depthData: Uint8ClampedArray,
  dW: number,
  dH: number,
  refDepth: number,
  vp: VanishingPointData | null,
  reference: ReferenceData,
): Promise<number> {
  // Pre-compute reference distance from VP (in image pixel space)
  // Used to scale VP correction relative to the reference line.
  const refCenterX = (reference.point1.x + reference.point2.x) / 2;
  const vpAvailable = vp && !vp.atInfinity;
  const refDistToVP = vpAvailable ? Math.abs(refCenterX - vp!.x) : 0;

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
          const mi = (y * mW + x) * 4;
          if (mData[mi] > 127 || mData[mi + 3] > 127) {
            // ── Depth correction ──────────────────────────────────────────
            const dx = Math.min(Math.round((x / mW) * dW), dW - 1);
            const dy = Math.min(Math.round((y / mH) * dH), dH - 1);
            const pixelDepth = depthData[(dy * dW + dx) * 4];
            const depthFactor = pixelDepth > 0
              ? Math.max(0.1, Math.min(4.0, (refDepth / pixelDepth) ** 2))
              : 1;

            // ── Vanishing-point (horizontal foreshortening) correction ────
            // Map mask pixel coords back to original image coords
            let vpFactor = 1;
            if (vpAvailable && refDistToVP > 10) {
              const imgX = (x / mW) * (reference.point2.x + reference.point1.x); // approx scale
              // More accurate: mask covers same area as original
              const origX = (x / mW) * (dW > mW ? dW : mW); // use largest dim as proxy
              const pixDistToVP = Math.abs(origX - vp!.x);
              if (pixDistToVP > 1) {
                vpFactor = Math.max(0.3, Math.min(3.0, refDistToVP / pixDistToVP));
              }
              void imgX; // suppress lint
            }

            total += depthFactor * vpFactor;
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
      if (maskData[idx] > 127 || maskData[idx + 3] > 127) {
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

/**
 * Polygon-based area measurement with full perspective correction.
 *
 * The user draws a polygon around the exact facade outline (corners + roof ridge).
 *
 * TWO perspective corrections are applied automatically:
 *
 * 1. HORIZONTAL (side-angle) — from reference line angle:
 *    If the board is tilted θ degrees in the image, the facade is viewed from
 *    that angle → horizontal foreshortening → multiply by 1/cos(θ).
 *
 * 2. VERTICAL (camera tilt) — from depth map, per-pixel:
 *    When the camera tilts upward, the top of the wall is farther away and
 *    appears compressed. For each pixel inside the polygon, weight =
 *    (refDepth / pixelDepth)². This corrects for both camera tilt AND any
 *    curvature/relief of the surface.
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
): Promise<PreciseMeasurementResult> {
  const ppm = reference.pixelsPerMeter;

  // ── 1. Horizontal perspective correction from reference line angle ─────────
  const angleDeg = reference.angleDeg ?? 0;
  let perspectiveCorrectionFactor = 1;
  if (Math.abs(angleDeg) > 1) {
    const cosTheta = Math.cos(Math.abs(angleDeg) * Math.PI / 180);
    if (cosTheta > 0.1) {
      perspectiveCorrectionFactor = Math.max(0.5, Math.min(2.5, 1 / cosTheta));
    }
  }

  // ── 2. Rasterise polygon into a canvas mask ────────────────────────────────
  // We sample every STRIDE pixels for performance on large images.
  const STRIDE = 2; // sample every 2nd pixel → 4× speed, negligible accuracy loss
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

      // Reference depth = average depth along the user's drawn reference line
      const refDepth = sampleLineDepth(depthData, dW, reference.point1, reference.point2);

      if (refDepth >= 1) {
        for (let y = 0; y < imageHeight; y += STRIDE) {
          for (let x = 0; x < imageWidth; x += STRIDE) {
            if (polyData[(y * imageWidth + x) * 4] < 128) continue; // outside polygon
            grossRawPixels += STRIDE * STRIDE;

            const dx = Math.min(Math.round((x / imageWidth) * dW), dW - 1);
            const dy = Math.min(Math.round((y / imageHeight) * dH), dH - 1);
            const pixelDepth = depthData[(dy * dW + dx) * 4];
            // depth weight: farther pixels (lower value) get larger weight
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
      let rawCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 127 || data[i + 3] > 127) rawCount++;
      }
      // Scale from mask resolution to original image resolution
      const scaleFactor = (imageWidth * imageHeight) / (mc.width * mc.height);
      openingPixelsScaled += rawCount * scaleFactor;
    } catch {
      // skip
    }
  }
  // Apply same depth correction factor (approximate — openings are at similar depth as wall)
  const openingAreaM2 =
    (openingPixelsScaled / (ppm * ppm)) * depthCorrectionFactor * perspectiveCorrectionFactor;
  const netAreaM2 = Math.max(grossAreaM2 - openingAreaM2, 0);

  const method = depthMapUrl && grossRawPixels > 0
    ? Math.abs(angleDeg) > 1 ? "depth+perspective" : "depth"
    : Math.abs(angleDeg) > 1 ? "depth+perspective" : "basic";

  return {
    wallPixels: grossRawPixels,
    openingPixels: openingPixelsScaled,
    netWallPixels: Math.max(grossRawPixels - openingPixelsScaled, 0),
    pixelsPerMeter: ppm,
    wallAreaM2: netAreaM2,
    depthCorrectionFactor,
    perspectiveCorrectionFactor,
    dominantLineAngleDeg: Math.abs(angleDeg) > 1 ? angleDeg : null,
    vanishingPointCorrectionFactor: 1,
    method,
  };
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
