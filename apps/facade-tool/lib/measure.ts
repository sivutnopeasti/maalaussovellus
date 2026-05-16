/**
 * Facade measurement library
 *
 * Polygon-based area calculation with vertical keystone correction.
 *
 * The customer is instructed to take the photo perpendicular to the wall
 * (from the centre of the facade), so horizontal side-angle perspective is
 * effectively zero and only the vertical keystone matters.
 *
 * Vertical keystone (camera tilted up to fit the ridge) is corrected from:
 *   - the vertical vanishing point detected in MLSD lines, OR
 *   - the gyroscope tilt recorded by the in-app camera (when available).
 *
 * On a vertical wall the camera-space depth Z(v) at image row v relates
 * to the vanishing-point row v_v by:
 *
 *   Z(v) / Z(v_ref) = (v_v − v_ref) / (v_v − v)
 *
 * The per-pixel world area is proportional to Z(v)³, so each pixel inside
 * the polygon is weighted by ((v_v − v_ref) / (v_v − v))³ before summing.
 */

import type { MaskResult, ReferenceData, Point } from "./types";
import {
  findVerticalVanishingPoint,
  type VanishingPointResult,
} from "./vanishingPoint";

export interface PreciseMeasurementResult {
  wallPixels: number;
  openingPixels: number;
  netWallPixels: number;
  pixelsPerMeter: number;
  wallAreaM2: number;
  /** Per-pixel keystone correction kerroin keskimäärin (1.0 = ei korjausta). */
  keystoneCorrectionFactor: number;
  /** Pakopisteestä johdettu pystysuora kallistus β (°). null jos ei tunnistettu / ei käytetty. */
  verticalTiltDeg: number | null;
  /** Pakopistedetektion luotettavuus 0–1, null jos ei tunnistettu. */
  verticalTiltConfidence: number | null;
  /** Lähde, josta vertikaalinen kallistus saatiin. */
  verticalTiltSource: "vanishing-point" | "sensor" | "none";
  method: "basic" | "keystone";
}

const ASSUMED_FOCAL_RATIO = 0.85;

export async function calculatePolygonMeasurement(
  polygonPoints: Point[],
  masks: MaskResult[],
  imageWidth: number,
  imageHeight: number,
  reference: ReferenceData,
  options?: {
    mlsdMapUrl?: string | null;
    useKeystoneCorrection?: boolean;
    /** Optional camera tilt β (°) measured by gyroscope at capture time.
     *  Overrides vanishing-point detection when provided. */
    sensorTiltBetaDeg?: number | null;
  },
): Promise<PreciseMeasurementResult> {
  const ppm = reference.pixelsPerMeter;
  const useKeystone = options?.useKeystoneCorrection ?? true;
  const mlsdMapUrl = options?.mlsdMapUrl ?? null;
  const sensorBeta = options?.sensorTiltBetaDeg ?? null;

  // ── 1. Vertical keystone: vanishing point + sensor tilt ────────────────────
  let vp: VanishingPointResult | null = null;
  let verticalTiltSource: PreciseMeasurementResult["verticalTiltSource"] = "none";
  let tiltBetaDeg: number | null = null;

  if (useKeystone) {
    if (sensorBeta !== null && Math.abs(sensorBeta) > 1) {
      // Trust the gyroscope when available
      tiltBetaDeg = sensorBeta;
      verticalTiltSource = "sensor";
    } else if (mlsdMapUrl) {
      try {
        vp = await findVerticalVanishingPoint(mlsdMapUrl, imageWidth, imageHeight);
        if (vp && vp.confidence > 0.3 && Math.abs(vp.betaDeg) > 1) {
          tiltBetaDeg = vp.betaDeg;
          verticalTiltSource = "vanishing-point";
        }
      } catch {
        // VP detection optional — silent fall-through
      }
    }
  }

  // Derive v_v in original image-pixel coords (signed offset from image center y).
  // If sensorBeta is the source, v_v = -f / tan(β). If VP source, use vp.vyOffset.
  let vyOffset: number | null = null;
  if (verticalTiltSource === "vanishing-point" && vp) {
    vyOffset = vp.vyOffset;
  } else if (verticalTiltSource === "sensor" && tiltBetaDeg !== null) {
    const f = ASSUMED_FOCAL_RATIO * imageHeight;
    const tanB = Math.tan((Math.abs(tiltBetaDeg) * Math.PI) / 180);
    if (tanB > 0.001) {
      vyOffset = (tiltBetaDeg > 0 ? -1 : 1) * (f / tanB);
    }
  }

  // ── 3. Rasterise polygon and integrate per-pixel area ─────────────────────
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

  // Reference line y-coord (signed offset from image center)
  const cy = imageHeight / 2;
  const refY = (reference.point1.y + reference.point2.y) / 2;
  const vRefOffset = refY - cy;

  let rawPixelArea = 0;     // total pixel count inside polygon (uncorrected)
  let weightedPixelArea = 0; // depth/keystone-weighted pixel count

  if (vyOffset !== null && Math.abs(vyOffset) > imageHeight * 0.15) {
    // Per-pixel keystone weighting
    const vv = vyOffset;
    // cos(β) for the global cos factor in dA. Tiny correction at small β.
    const f = ASSUMED_FOCAL_RATIO * imageHeight;
    const cosBeta = Math.abs(vv) / Math.sqrt(vv * vv + f * f);
    // Constant factor (v_v − v_ref)² / cos(β) — absorbed into a normalisation
    // that we divide out below by dividing by the weight at v_ref. Simpler:
    // weight(v) = ((v_v − v_ref) / (v_v − v))³ / cosBeta, where the cosBeta
    // is applied globally to total area.
    const refDenom = vv - vRefOffset;
    for (let y = 0; y < imageHeight; y += STRIDE) {
      const v = y - cy;
      const denom = vv - v;
      // Avoid division by zero (denominator approaches 0 only at the vanishing
      // point itself, which is outside the polygon).
      if (Math.abs(denom) < 1) continue;
      const ratio = refDenom / denom; // Z(v) / Z(v_ref)
      const weight = ratio * ratio * ratio;
      const rowOffset = y * imageWidth;
      for (let x = 0; x < imageWidth; x += STRIDE) {
        if (polyData[(rowOffset + x) * 4] < 128) continue;
        rawPixelArea += STRIDE * STRIDE;
        weightedPixelArea += weight * STRIDE * STRIDE;
      }
    }
    // Apply global cos(β) factor: dA scales as 1/cos(β)
    weightedPixelArea /= cosBeta;
  } else {
    // No keystone correction → simple pixel count via Shoelace formula
    let area = 0;
    const n = polygonPoints.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      area += polygonPoints[i].x * polygonPoints[j].y;
      area -= polygonPoints[j].x * polygonPoints[i].y;
    }
    rawPixelArea = Math.abs(area) / 2;
    weightedPixelArea = rawPixelArea;
  }

  const keystoneCorrectionFactor =
    rawPixelArea > 0 ? weightedPixelArea / rawPixelArea : 1;

  const grossAreaM2 = weightedPixelArea / (ppm * ppm);

  // ── 4. Opening masks (windows + doors), with same keystone weighting ──────
  const minOpeningPixels = imageWidth * imageHeight * 0.004;
  const openingMasks = masks.filter((m) => m.category === "opening");
  let openingPixelsScaled = 0;
  for (const mask of openingMasks) {
    try {
      const mc = await loadImageToCanvas(mask.url);
      const data = mc
        .getContext("2d")!
        .getImageData(0, 0, mc.width, mc.height).data;
      const hasTransparent = detectTransparentMask(data);
      const scaleX = imageWidth / mc.width;
      const scaleY = imageHeight / mc.height;
      let rawCount = 0;
      let weightedCount = 0;
      const vv = vyOffset;
      const refDenom = vv !== null ? vv - vRefOffset : 0;
      for (let my = 0; my < mc.height; my++) {
        const yOrig = my * scaleY;
        const v = yOrig - cy;
        let weight = 1;
        if (vv !== null && Math.abs(vv) > imageHeight * 0.15) {
          const denom = vv - v;
          if (Math.abs(denom) < 1) continue;
          const ratio = refDenom / denom;
          weight = ratio * ratio * ratio;
        }
        for (let mx = 0; mx < mc.width; mx++) {
          const idx = (my * mc.width + mx) * 4;
          const isSet = hasTransparent ? data[idx + 3] > 127 : data[idx] > 127;
          if (!isSet) continue;
          rawCount += scaleX * scaleY;
          weightedCount += weight * scaleX * scaleY;
        }
      }
      if (rawCount < minOpeningPixels) continue;
      openingPixelsScaled += weightedCount;
    } catch {
      // skip masks that fail to load
    }
  }

  // Same global cos(β) factor for openings if keystone correction is active
  if (vyOffset !== null && Math.abs(vyOffset) > imageHeight * 0.15) {
    const f = ASSUMED_FOCAL_RATIO * imageHeight;
    const cosBeta = Math.abs(vyOffset) / Math.sqrt(vyOffset * vyOffset + f * f);
    openingPixelsScaled /= cosBeta;
  }

  const openingAreaM2 = openingPixelsScaled / (ppm * ppm);
  const netAreaM2 = Math.max(grossAreaM2 - openingAreaM2, 0);

  const hasKeystone =
    vyOffset !== null && Math.abs(vyOffset) > imageHeight * 0.15;

  return {
    wallPixels: rawPixelArea,
    openingPixels: openingPixelsScaled,
    netWallPixels: Math.max(rawPixelArea - openingPixelsScaled, 0),
    pixelsPerMeter: ppm,
    wallAreaM2: netAreaM2,
    keystoneCorrectionFactor,
    verticalTiltDeg: tiltBetaDeg,
    verticalTiltConfidence: vp?.confidence ?? (verticalTiltSource === "sensor" ? 1 : null),
    verticalTiltSource,
    method: hasKeystone ? "keystone" : "basic",
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function detectTransparentMask(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < Math.min(data.length, 800); i += 4) {
    if (data[i] < 10) return true;
  }
  return false;
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
