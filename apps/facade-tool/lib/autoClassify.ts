/**
 * Automatic mask classification engine.
 *
 * Signal stack (in priority order):
 *  1. SAM 3 semantic bbox overlap  — "did text-prompted detection say this is a wall/window?"
 *  2. Depth heuristics             — sky and ground have extreme depth values
 *  3. Position heuristics          — sky is top, ground is bottom
 *  4. Size heuristics              — tiny fragments → ignore
 *  5. Color uniformity             — uniform surface → wall candidate
 */

import type { MaskResult, MaskCategory, BBoxHint } from "./types";

// ─── Public API ───────────────────────────────────────────────────────────────

export interface AutoClassifyInput {
  masks: MaskResult[];
  imageWidth: number;
  imageHeight: number;
  wallHints: BBoxHint[];
  openingHints: BBoxHint[];
  depthMapUrl: string;
  /** Original image URL for color analysis */
  imageUrl: string;
}

export async function autoClassifyMasks(
  input: AutoClassifyInput,
): Promise<MaskResult[]> {
  const { masks, imageWidth, imageHeight, wallHints, openingHints, depthMapUrl, imageUrl } =
    input;

  // 1. Load all mask canvases, depth map, and original image in parallel
  const [depthCanvas, originalCanvas, ...maskCanvases] = await Promise.all([
    loadImage(depthMapUrl),
    loadImage(imageUrl),
    ...masks.map((m) => loadImage(m.url).catch(() => null)),
  ]);

  const depthData = depthCanvas
    ? depthCanvas.getContext("2d")!.getImageData(0, 0, depthCanvas.width, depthCanvas.height).data
    : null;

  const origData = originalCanvas
    ? originalCanvas.getContext("2d")!.getImageData(0, 0, originalCanvas.width, originalCanvas.height).data
    : null;

  const dW = depthCanvas?.width ?? imageWidth;
  const dH = depthCanvas?.height ?? imageHeight;
  const oW = originalCanvas?.width ?? imageWidth;
  const oH = originalCanvas?.height ?? imageHeight;

  return masks.map((mask, i) => {
    const maskCanvas = maskCanvases[i];
    if (!maskCanvas) return { ...mask, category: "ignored" };

    const mCtx = maskCanvas.getContext("2d")!;
    const mData = mCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height).data;
    const mW = maskCanvas.width;
    const mH = maskCanvas.height;

    // ── Compute mask statistics ─────────────────────────────────────────────
    const stats = computeMaskStats(mData, mW, mH);
    if (stats.pixelCount === 0) return { ...mask, category: "ignored" };

    // Normalized centroid and bounding box
    const cx = stats.centerX / mW;
    const cy = stats.centerY / mH;
    const bx1 = stats.minX / mW;
    const by1 = stats.minY / mH;
    const bx2 = stats.maxX / mW;
    const by2 = stats.maxY / mH;
    const bw = bx2 - bx1;
    const bh = by2 - by1;
    const relSize = stats.pixelCount / (mW * mH);

    // ── Signal 1: SAM 3 semantic overlap ────────────────────────────────────
    const wallScore = bestBBoxOverlap(cx, cy, bx1, by1, bw, bh, wallHints);
    const openingScore = bestBBoxOverlap(cx, cy, bx1, by1, bw, bh, openingHints);

    if (wallScore > 0.25 && wallScore > openingScore) {
      return { ...mask, category: "wall", pixelCount: stats.pixelCount };
    }
    if (openingScore > 0.2 && openingScore >= wallScore) {
      return { ...mask, category: "opening", pixelCount: stats.pixelCount };
    }

    // ── Signal 2: Depth heuristic ────────────────────────────────────────────
    // Sample depth values at mask pixels (scaled to depth map dimensions)
    let depthCategory: MaskCategory | null = null;
    if (depthData) {
      const avgDepth = sampleAvgDepth(mData, mW, mH, depthData, dW, dH);
      // DepthAnything: brighter = closer. Very bright → foreground (ground/objects)
      // Very dark → far away (sky, background)
      if (avgDepth < 30) depthCategory = "ignored"; // sky / very distant
      else if (avgDepth > 235 && cy > 0.6) depthCategory = "ignored"; // very close foreground, low in image → ground
    }

    // ── Signal 3: Position heuristic ────────────────────────────────────────
    const isTopStrip = by2 < 0.18;               // purely in top strip → sky
    const isBottomStrip = by1 > 0.85;             // purely in bottom strip → ground
    const isLargeBottom = by1 > 0.7 && relSize > 0.08; // large region at bottom → ground

    if (isTopStrip || isBottomStrip || isLargeBottom) {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }
    if (depthCategory === "ignored") {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }

    // ── Signal 4: Size heuristic ─────────────────────────────────────────────
    if (relSize < 0.002) {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }

    // ── Signal 5: Color uniformity analysis ─────────────────────────────────
    let colorUniformity = 0;
    let isDark = false;
    if (origData) {
      const ca = sampleColorStats(mData, mW, mH, origData, oW, oH);
      colorUniformity = ca.uniformity; // 0 = very varied, 1 = perfectly uniform
      isDark = ca.avgBrightness < 70;
    }

    // Mid-image + high uniformity → wall candidate
    const isMidImage = cy > 0.15 && cy < 0.85;
    if (isMidImage && colorUniformity > 0.5 && relSize > 0.01) {
      return { ...mask, category: "wall", pixelCount: stats.pixelCount };
    }

    // Mid-image + dark + small → window candidate
    if (isMidImage && isDark && relSize < 0.08 && relSize > 0.003) {
      return { ...mask, category: "opening", pixelCount: stats.pixelCount };
    }

    // Larger region in middle portion → likely wall
    if (isMidImage && relSize > 0.03 && bh > 0.15) {
      return { ...mask, category: "wall", pixelCount: stats.pixelCount };
    }

    return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
  });
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface MaskStats {
  pixelCount: number;
  centerX: number;
  centerY: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function computeMaskStats(
  data: Uint8ClampedArray,
  w: number,
  h: number,
): MaskStats {
  let count = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = w;
  let minY = h;
  let maxX = 0;
  let maxY = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (data[idx] > 127) {
        count++;
        sumX += x;
        sumY += y;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  return {
    pixelCount: count,
    centerX: count > 0 ? sumX / count : w / 2,
    centerY: count > 0 ? sumY / count : h / 2,
    minX: count > 0 ? minX : 0,
    minY: count > 0 ? minY : 0,
    maxX: count > 0 ? maxX : w,
    maxY: count > 0 ? maxY : h,
  };
}

/**
 * Returns how well the mask's bounding box overlaps with the best-matching hint box.
 * Uses centroid containment + IoU of bounding boxes.
 */
function bestBBoxOverlap(
  cx: number,
  cy: number,
  mx1: number,
  my1: number,
  mw: number,
  mh: number,
  hints: BBoxHint[],
): number {
  if (hints.length === 0) return 0;

  let best = 0;
  for (const hint of hints) {
    const [hcx, hcy, hw, hh] = hint.box;
    const hx1 = hcx - hw / 2;
    const hy1 = hcy - hh / 2;
    const hx2 = hcx + hw / 2;
    const hy2 = hcy + hh / 2;

    // Centroid containment (strong signal)
    const centroidInside =
      cx >= hx1 && cx <= hx2 && cy >= hy1 && cy <= hy2 ? 0.6 : 0;

    // Bounding box IoU
    const ix1 = Math.max(mx1, hx1);
    const iy1 = Math.max(my1, hy1);
    const ix2 = Math.min(mx1 + mw, hx2);
    const iy2 = Math.min(my1 + mh, hy2);
    const iw = Math.max(0, ix2 - ix1);
    const ih = Math.max(0, iy2 - iy1);
    const intersection = iw * ih;
    const unionArea = mw * mh + hw * hh - intersection;
    const iou = unionArea > 0 ? intersection / unionArea : 0;

    const score = Math.max(centroidInside, iou);
    if (score > best) best = score;
  }
  return best;
}

function sampleAvgDepth(
  maskData: Uint8ClampedArray,
  mW: number,
  mH: number,
  depthData: Uint8ClampedArray,
  dW: number,
  dH: number,
): number {
  let sum = 0;
  let n = 0;
  const scaleX = dW / mW;
  const scaleY = dH / mH;

  for (let y = 0; y < mH; y += 2) {
    for (let x = 0; x < mW; x += 2) {
      if (maskData[(y * mW + x) * 4] > 127) {
        const dx = Math.min(Math.round(x * scaleX), dW - 1);
        const dy = Math.min(Math.round(y * scaleY), dH - 1);
        sum += depthData[(dy * dW + dx) * 4];
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 128;
}

interface ColorStats {
  avgBrightness: number;
  /** 0 = uniform, high = varied */
  uniformity: number;
}

function sampleColorStats(
  maskData: Uint8ClampedArray,
  mW: number,
  mH: number,
  origData: Uint8ClampedArray,
  oW: number,
  oH: number,
): ColorStats {
  const scaleX = oW / mW;
  const scaleY = oH / mH;
  let sumBr = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let n = 0;
  const samples: number[] = [];

  for (let y = 0; y < mH; y += 3) {
    for (let x = 0; x < mW; x += 3) {
      if (maskData[(y * mW + x) * 4] > 127) {
        const ox = Math.min(Math.round(x * scaleX), oW - 1);
        const oy = Math.min(Math.round(y * scaleY), oH - 1);
        const oi = (oy * oW + ox) * 4;
        const r = origData[oi];
        const g = origData[oi + 1];
        const b = origData[oi + 2];
        const br = (r + g + b) / 3;
        sumBr += br;
        sumR += r;
        sumG += g;
        sumB += b;
        samples.push(br);
        n++;
      }
    }
  }

  if (n === 0) return { avgBrightness: 128, uniformity: 0.5 };

  const avgBr = sumBr / n;
  // Variance of brightness → uniformity score (1 = perfectly uniform)
  const variance =
    samples.reduce((acc, v) => acc + (v - avgBr) ** 2, 0) / samples.length;
  const stdDev = Math.sqrt(variance);
  const uniformity = Math.max(0, 1 - stdDev / 80);

  return { avgBrightness: avgBr, uniformity };
}

function loadImage(url: string): Promise<HTMLCanvasElement> {
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
