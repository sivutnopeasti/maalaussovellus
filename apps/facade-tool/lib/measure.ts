import type { MaskResult, ReferenceData, MeasurementResult } from "./types";

/**
 * Count the number of "active" (bright) pixels in a mask image.
 * The mask images from SAM 2 are PNGs where white pixels = masked area.
 * This runs in the browser using an off-screen canvas.
 */
export function countMaskPixels(maskUrl: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas context unavailable"));
      ctx.drawImage(img, 0, 0);
      const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let count = 0;
      // R channel > 127 indicates a masked pixel in SAM 2 output
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 127) count++;
      }
      resolve(count);
    };
    img.onerror = () => reject(new Error(`Failed to load mask: ${maskUrl}`));
    img.src = maskUrl;
  });
}

/**
 * Count pixels from all masks in parallel and attach the counts to each mask.
 */
export async function enrichMasksWithPixelCounts(
  masks: MaskResult[],
): Promise<MaskResult[]> {
  const counts = await Promise.all(
    masks.map((m) =>
      countMaskPixels(m.url).catch(() => 0),
    ),
  );
  return masks.map((m, i) => ({ ...m, pixelCount: counts[i] }));
}

/**
 * Calculate the net painted wall area in square metres.
 *
 * Formula:
 *   wallPixels   = sum of pixel counts of masks tagged as "wall"
 *   openingPixels = sum of pixel counts of masks tagged as "opening"
 *   netWallPixels = max(wallPixels - openingPixels, 0)
 *   wallAreaM2   = netWallPixels / pixelsPerMeter²
 *
 * Note: This uses the 2-D pixel area of the photo. For a photo taken
 * roughly perpendicular to the facade, this is accurate. The depth map
 * provides additional correction for tilted facades (see depthCorrectedArea).
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
  const wallAreaM2 = netWallPixels / (pixelsPerMeter * pixelsPerMeter);

  return {
    wallPixels,
    openingPixels,
    netWallPixels,
    pixelsPerMeter,
    wallAreaM2,
  };
}

/**
 * Apply a depth-based perspective correction to a raw pixel-area estimate.
 *
 * The depth map from Depth Anything V2 is a grayscale image where a higher
 * pixel value indicates an object that is closer to the camera.
 *
 * Correction principle:
 *   - The reference line was drawn at depth value D_ref (sampled from depth map).
 *   - The wall is at average depth D_wall.
 *   - Because perspective shrinks far objects, pixels at D_wall represent a
 *     larger real-world area than pixels at D_ref by a factor of (D_ref/D_wall)²
 *     (for inverse-depth / disparity maps as output by DepthAnything).
 *   - correctedAreaM2 = rawAreaM2 × (D_ref / D_wall)²
 *
 * @param rawAreaM2       Uncorrected area from calculateWallArea
 * @param depthMapUrl     URL of the depth map image
 * @param reference       Reference measure data (includes pixel coordinates of line)
 * @param wallMaskUrl     URL of the combined wall mask for sampling wall depth
 */
export async function depthCorrectedArea(
  rawAreaM2: number,
  depthMapUrl: string,
  reference: ReferenceData,
  wallMaskUrl: string,
): Promise<number> {
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

  // Sample depth along the reference line using Bresenham's-style iteration
  const refDepth = sampleLineDepth(dData, depthCanvas.width, reference);

  // Sample average depth inside the wall mask
  const wallDepth = sampleMaskedDepth(
    dData,
    mData,
    depthCanvas.width,
    depthCanvas.height,
  );

  if (refDepth === 0 || wallDepth === 0) return rawAreaM2;

  // Perspective correction: (D_ref / D_wall)² for disparity-type depth maps
  const correctionFactor = Math.pow(refDepth / wallDepth, 2);
  // Clamp correction to a sensible range to avoid runaway values
  const clamped = Math.max(0.5, Math.min(correctionFactor, 2.0));
  return rawAreaM2 * clamped;
}

// ─── Internal helpers ────────────────────────────────────────────────────────

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

function sampleLineDepth(
  depthData: Uint8ClampedArray,
  width: number,
  ref: ReferenceData,
): number {
  const { point1, point2 } = ref;
  const steps = Math.max(
    Math.abs(point2.x - point1.x),
    Math.abs(point2.y - point1.y),
  );
  if (steps === 0) return 0;
  let sum = 0;
  let n = 0;
  for (let t = 0; t <= steps; t++) {
    const x = Math.round(point1.x + ((point2.x - point1.x) * t) / steps);
    const y = Math.round(point1.y + ((point2.y - point1.y) * t) / steps);
    const idx = (y * width + x) * 4;
    sum += depthData[idx]; // R channel of grayscale
    n++;
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
