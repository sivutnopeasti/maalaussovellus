/**
 * Automatic mask classification engine — signal priority:
 *
 *  1. SAM 3 IGNORE hints  — roof / sky / grass / ground → always ignored (highest priority)
 *  2. Color veto          — very green (grass) or very dark blue (sky) → ignored
 *  3. Position veto       — pure top/bottom strips → ignored
 *  4. SAM 3 OPENING hints — window / door → opening
 *  5. SAM 3 WALL hints    — wooden siding / painted boards → wall
 *  6. Depth heuristic     — sky = dark depth, ground = very bright depth
 *  7. Color uniformity    — uniform mid-range color → wall candidate
 *  8. Size + position     — large mid-image region → wall
 */

import type { MaskResult, MaskCategory, BBoxHint } from "./types";

export interface AutoClassifyInput {
  masks: MaskResult[];
  imageWidth: number;
  imageHeight: number;
  wallHints: BBoxHint[];
  openingHints: BBoxHint[];
  ignoreHints: BBoxHint[];
  depthMapUrl: string;
  imageUrl: string;
}

export async function autoClassifyMasks(
  input: AutoClassifyInput,
): Promise<MaskResult[]> {
  const {
    masks,
    imageWidth,
    imageHeight,
    wallHints,
    openingHints,
    ignoreHints,
    depthMapUrl,
    imageUrl,
  } = input;

  const [depthCanvas, originalCanvas, ...maskCanvases] = await Promise.all([
    loadImg(depthMapUrl).catch(() => null),
    loadImg(imageUrl).catch(() => null),
    ...masks.map((m) => loadImg(m.url).catch(() => null)),
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
    const mc = maskCanvases[i];
    if (!mc) return { ...mask, category: "ignored" };

    const mData = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height).data;
    const mW = mc.width;
    const mH = mc.height;

    const stats = computeMaskStats(mData, mW, mH);
    if (stats.pixelCount === 0) return { ...mask, category: "ignored" };

    const cx = stats.centerX / mW;
    const cy = stats.centerY / mH;
    const bx1 = stats.minX / mW;
    const by1 = stats.minY / mH;
    const bx2 = stats.maxX / mW;
    const by2 = stats.maxY / mH;
    const bw = bx2 - bx1;
    const bh = by2 - by1;
    const relSize = stats.pixelCount / (mW * mH);

    // ── 1. SAM 3 IGNORE signal (highest priority) ────────────────────────────
    const ignoreScore = bestBBoxOverlap(cx, cy, bx1, by1, bw, bh, ignoreHints);
    if (ignoreScore > 0.25) {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }

    // ── 2. Color veto ────────────────────────────────────────────────────────
    let colorStats = { avgR: 128, avgG: 128, avgB: 128, uniformity: 0.5, avgBrightness: 128 };
    if (origData) {
      colorStats = sampleColorStats(mData, mW, mH, origData, oW, oH);
    }
    const { avgR, avgG, avgB, uniformity, avgBrightness } = colorStats;

    // Very green → grass/vegetation → ignore
    const isGreen = avgG > avgR + 25 && avgG > avgB + 20 && avgG > 80;
    // Very blue-dark → sky → ignore
    const isSky = avgB > avgR + 20 && avgB > avgG + 10 && avgBrightness > 140;
    // Very dark → shadow/tree area → ignore
    const isVeryDark = avgBrightness < 35;
    if (isGreen || isSky || isVeryDark) {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }

    // ── 3. Position veto ─────────────────────────────────────────────────────
    const isTopStrip = by2 < 0.12;
    const isBottomStrip = by1 > 0.88;
    if (isTopStrip || isBottomStrip) {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }
    // Large area at bottom → ground/grass
    if (by1 > 0.65 && relSize > 0.06) {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }
    // Tiny fragment → noise
    if (relSize < 0.002) {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }

    // ── 4. SAM 3 OPENING signal ───────────────────────────────────────────────
    const openingScore = bestBBoxOverlap(cx, cy, bx1, by1, bw, bh, openingHints);
    if (openingScore > 0.2) {
      return { ...mask, category: "opening", pixelCount: stats.pixelCount };
    }

    // ── 5. SAM 3 WALL signal ──────────────────────────────────────────────────
    const wallScore = bestBBoxOverlap(cx, cy, bx1, by1, bw, bh, wallHints);
    if (wallScore > 0.2) {
      return { ...mask, category: "wall", pixelCount: stats.pixelCount };
    }

    // ── 6. Depth heuristic ────────────────────────────────────────────────────
    if (depthData) {
      const avgDepth = sampleAvgDepth(mData, mW, mH, depthData, dW, dH);
      if (avgDepth < 20) {
        return { ...mask, category: "ignored", pixelCount: stats.pixelCount }; // sky/distant
      }
      if (avgDepth > 230 && cy > 0.65) {
        return { ...mask, category: "ignored", pixelCount: stats.pixelCount }; // close ground
      }
    }

    // ── 7. Color uniformity → wall candidate ─────────────────────────────────
    const isMidImage = cy > 0.12 && cy < 0.88;
    // Roofs tend to be: upper portion, lighter, angled large area
    const likelyRoof = cy < 0.4 && bh > 0.25 && bw > 0.4;
    if (likelyRoof) {
      return { ...mask, category: "ignored", pixelCount: stats.pixelCount };
    }

    if (isMidImage && uniformity > 0.45 && relSize > 0.008) {
      return { ...mask, category: "wall", pixelCount: stats.pixelCount };
    }

    // Dark small region in the middle → likely window
    const isDark = avgBrightness < 80;
    if (isMidImage && isDark && relSize < 0.07 && relSize > 0.003) {
      return { ...mask, category: "opening", pixelCount: stats.pixelCount };
    }

    // ── 8. Size + position fallback ───────────────────────────────────────────
    if (isMidImage && relSize > 0.025 && bh > 0.1) {
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

function computeMaskStats(data: Uint8ClampedArray, w: number, h: number): MaskStats {
  let count = 0, sumX = 0, sumY = 0;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4] > 127) {
        count++;
        sumX += x; sumY += y;
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

function bestBBoxOverlap(
  cx: number, cy: number,
  mx1: number, my1: number, mw: number, mh: number,
  hints: BBoxHint[],
): number {
  if (!hints.length) return 0;
  let best = 0;
  for (const hint of hints) {
    const [hcx, hcy, hw, hh] = hint.box;
    const hx1 = hcx - hw / 2, hy1 = hcy - hh / 2;
    const hx2 = hcx + hw / 2, hy2 = hcy + hh / 2;
    const centroid = cx >= hx1 && cx <= hx2 && cy >= hy1 && cy <= hy2 ? 0.6 : 0;
    const ix = Math.max(0, Math.min(mx1 + mw, hx2) - Math.max(mx1, hx1));
    const iy = Math.max(0, Math.min(my1 + mh, hy2) - Math.max(my1, hy1));
    const iou = (mw * mh + hw * hh - ix * iy) > 0 ? (ix * iy) / (mw * mh + hw * hh - ix * iy) : 0;
    const score = Math.max(centroid, iou);
    if (score > best) best = score;
  }
  return best;
}

function sampleAvgDepth(
  maskData: Uint8ClampedArray, mW: number, mH: number,
  depthData: Uint8ClampedArray, dW: number, dH: number,
): number {
  let sum = 0, n = 0;
  for (let y = 0; y < mH; y += 2) {
    for (let x = 0; x < mW; x += 2) {
      if (maskData[(y * mW + x) * 4] > 127) {
        const dx = Math.min(Math.round(x * dW / mW), dW - 1);
        const dy = Math.min(Math.round(y * dH / mH), dH - 1);
        sum += depthData[(dy * dW + dx) * 4];
        n++;
      }
    }
  }
  return n > 0 ? sum / n : 128;
}

interface ColorStats {
  avgR: number; avgG: number; avgB: number;
  avgBrightness: number;
  uniformity: number;
}

function sampleColorStats(
  maskData: Uint8ClampedArray, mW: number, mH: number,
  origData: Uint8ClampedArray, oW: number, oH: number,
): ColorStats {
  let sumR = 0, sumG = 0, sumB = 0, sumBr = 0, n = 0;
  const samples: number[] = [];
  for (let y = 0; y < mH; y += 3) {
    for (let x = 0; x < mW; x += 3) {
      if (maskData[(y * mW + x) * 4] > 127) {
        const ox = Math.min(Math.round(x * oW / mW), oW - 1);
        const oy = Math.min(Math.round(y * oH / mH), oH - 1);
        const oi = (oy * oW + ox) * 4;
        const r = origData[oi], g = origData[oi + 1], b = origData[oi + 2];
        const br = (r + g + b) / 3;
        sumR += r; sumG += g; sumB += b; sumBr += br;
        samples.push(br);
        n++;
      }
    }
  }
  if (n === 0) return { avgR: 128, avgG: 128, avgB: 128, avgBrightness: 128, uniformity: 0.5 };
  const avgBr = sumBr / n;
  const variance = samples.reduce((a, v) => a + (v - avgBr) ** 2, 0) / samples.length;
  return {
    avgR: sumR / n,
    avgG: sumG / n,
    avgB: sumB / n,
    avgBrightness: avgBr,
    uniformity: Math.max(0, 1 - Math.sqrt(variance) / 75),
  };
}

function loadImg(url: string): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error(`Cannot load ${url}`));
    img.src = url;
  });
}
