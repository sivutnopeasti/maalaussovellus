/**
 * Automatic mask classification engine
 *
 * Core principle: DEFAULT IS IGNORED.
 * A mask is only upgraded to "wall" or "opening" when there is
 * clear positive evidence. This prevents roofs, grass, and sky
 * from being mislabelled as walls.
 *
 * Signal priority (applied in order):
 *  1. Immediately ignored:  top/bottom strips, very small masks
 *  2. SAM 3 IGNORE hints   — roof / sky / grass → ignored
 *  3. Position veto         — top 35 % or bottom 35 % of image → ignored
 *  4. Depth veto            — sky-dark or close-ground depth → ignored
 *  5. Color veto            — clearly green or sky-blue → ignored
 *  6. SAM 3 OPENING hints   — window / door → opening
 *  7. SAM 3 WALL hints      — wooden siding / painted boards → wall ✓
 *  8. Uniformity + midzone  — consistent mid-image region → wall ✓
 *  9. Everything else       — ignored (conservative)
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

  const hasDepth = !!depthData;
  const hasColor = !!origData;
  const hasWallHints = wallHints.length > 0;
  const hasOpeningHints = openingHints.length > 0;
  const hasIgnoreHints = ignoreHints.length > 0;

  return masks.map((mask, i): MaskResult => {
    // SAM 3 opening masks (index >= 10000) are pre-classified — preserve them.
    if (mask.index >= 10000 && mask.category === "opening") {
      return { ...mask, pixelCount: undefined };
    }

    const mc = maskCanvases[i];
    if (!mc) return { ...mask, category: "ignored" };

    const mData = mc.getContext("2d")!.getImageData(0, 0, mc.width, mc.height).data;
    const mW = mc.width;
    const mH = mc.height;

    const stats = computeMaskStats(mData, mW, mH);
    if (stats.pixelCount === 0) return { ...mask, category: "ignored" };

    // Normalised coordinates
    const cx = stats.centerX / mW;
    const cy = stats.centerY / mH;
    const bx1 = stats.minX / mW;
    const by1 = stats.minY / mH;
    const bx2 = stats.maxX / mW;
    const by2 = stats.maxY / mH;
    const bw = bx2 - bx1;
    const bh = by2 - by1;
    const relSize = stats.pixelCount / (mW * mH);

    const categorise = (cat: MaskCategory): MaskResult => ({
      ...mask,
      category: cat,
      pixelCount: stats.pixelCount,
    });

    // ── 1. Instant veto: fringe strips and noise ─────────────────────────────
    if (by2 < 0.08) return categorise("ignored");          // pure top strip
    if (by1 > 0.92) return categorise("ignored");          // pure bottom strip
    if (relSize < 0.003) return categorise("ignored");     // too small

    // ── 2. SAM 3 IGNORE hints ────────────────────────────────────────────────
    if (hasIgnoreHints) {
      const ignoreScore = bestBBoxOverlap(cx, cy, bx1, by1, bw, bh, ignoreHints);
      if (ignoreScore > 0.12) return categorise("ignored");
    }

    // ── 3. Strict position veto ───────────────────────────────────────────────
    // Top 35 % of image centre → sky / roof area
    if (cy < 0.35) return categorise("ignored");
    // Bottom 35 % of image centre → ground / grass area
    if (cy > 0.65) return categorise("ignored");
    // Mask centre is mid-image but top edge starts very high AND the mask is wide
    // → likely a roof that extends into the mid section
    const roofLike = by1 < 0.12 && bw > 0.35 && bh > 0.15;
    if (roofLike) return categorise("ignored");

    // ── 4. Depth veto ─────────────────────────────────────────────────────────
    if (hasDepth) {
      const avgDepth = sampleAvgDepth(mData, mW, mH, depthData!, dW, dH);
      // DepthAnything: brighter = closer, darker = farther
      if (avgDepth < 18) return categorise("ignored");             // very far = sky
      if (avgDepth > 235 && cy > 0.55) return categorise("ignored"); // very close + low = ground
    }

    // ── 5. Color veto ─────────────────────────────────────────────────────────
    let colorStats = { avgR: 128, avgG: 128, avgB: 128, uniformity: 0.5, avgBrightness: 128 };
    if (hasColor) {
      colorStats = sampleColorStats(mData, mW, mH, origData!, oW, oH);
    }
    const { avgR, avgG, avgB, uniformity, avgBrightness } = colorStats;

    const isGreen = avgG > avgR + 20 && avgG > avgB + 15 && avgG > 70;
    const isSky = avgB > avgR + 15 && avgB > avgG + 5 && avgBrightness > 130;
    const isVeryDark = avgBrightness < 30;
    if (isGreen || isSky || isVeryDark) return categorise("ignored");

    // ── 6. SAM 3 OPENING signal ───────────────────────────────────────────────
    if (hasOpeningHints) {
      const openingScore = bestBBoxOverlap(cx, cy, bx1, by1, bw, bh, openingHints);
      if (openingScore > 0.15) return categorise("opening");
    }

    // Small dark region in middle of image → window/door opening
    if (hasColor && avgBrightness < 90 && relSize < 0.06 && relSize > 0.003) {
      return categorise("opening");
    }

    // ── 6b. Depth-based window detection ──────────────────────────────────────
    // Windows appear at a slightly different depth than the surrounding wall
    // (glass is slightly recessed or has different reflectivity).
    // If the mask is mid-image and its depth differs meaningfully from
    // the image average depth → likely a window opening.
    const inBuildingZone = cy >= 0.35 && cy <= 0.65;
    if (hasDepth && inBuildingZone && relSize > 0.003 && relSize < 0.12) {
      const maskDepth = sampleAvgDepth(mData, mW, mH, depthData!, dW, dH);
      // Sample the depth of surrounding context (entire image average)
      const contextDepth = depthData![Math.floor(dH / 2) * dW * 4]; // rough mid-image sample
      const depthDiff = Math.abs(maskDepth - contextDepth);
      // If mask depth is significantly darker (farther) than context → recessed opening
      if (depthDiff > 25 && maskDepth < contextDepth - 20) {
        return categorise("opening");
      }
    }

    // ── 7. SAM 3 WALL signal ──────────────────────────────────────────────────
    if (hasWallHints) {
      const wallScore = bestBBoxOverlap(cx, cy, bx1, by1, bw, bh, wallHints);
      if (wallScore > 0.15) return categorise("wall");
    }

    // ── 8. Uniformity + mid-zone heuristic ───────────────────────────────────
    // Only classify as wall when mask centre is solidly in the building zone
    // (35–65 % vertically) AND color is consistent (not grass, sky already vetoed above)
    const solidRegion = relSize > 0.01 && bh > 0.08;

    if (inBuildingZone && solidRegion && uniformity > 0.5) {
      return categorise("wall");
    }

    // Larger mid-image region with decent uniformity even without color data
    if (inBuildingZone && relSize > 0.04 && !hasColor) {
      return categorise("wall");
    }

    // ── 9. Default: ignored ───────────────────────────────────────────────────
    return categorise("ignored");
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

/** True when mask uses alpha channel (apply_mask=true). False for binary brightness masks. */
function isMaskAlphaBased(data: Uint8ClampedArray): boolean {
  for (let i = 3; i < Math.min(data.length, 800); i += 4) {
    if (data[i] < 10) return true;
  }
  return false;
}

function computeMaskStats(data: Uint8ClampedArray, w: number, h: number): MaskStats {
  const alphaMode = isMaskAlphaBased(data);
  let count = 0, sumX = 0, sumY = 0;
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      if (alphaMode ? data[idx + 3] > 127 : data[idx] > 127) {
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
    const hx1 = hcx - hw / 2;
    const hy1 = hcy - hh / 2;
    const hx2 = hcx + hw / 2;
    const hy2 = hcy + hh / 2;
    // Centroid inside hint box
    const centroid = (cx >= hx1 && cx <= hx2 && cy >= hy1 && cy <= hy2) ? 0.7 : 0;
    // IoU
    const ix = Math.max(0, Math.min(mx1 + mw, hx2) - Math.max(mx1, hx1));
    const iy = Math.max(0, Math.min(my1 + mh, hy2) - Math.max(my1, hy1));
    const union = mw * mh + hw * hh - ix * iy;
    const iou = union > 0 ? (ix * iy) / union : 0;
    const score = Math.max(centroid, iou);
    if (score > best) best = score;
  }
  return best;
}

function sampleAvgDepth(
  maskData: Uint8ClampedArray, mW: number, mH: number,
  depthData: Uint8ClampedArray, dW: number, dH: number,
): number {
  const alphaMode = isMaskAlphaBased(maskData);
  let sum = 0, n = 0;
  for (let y = 0; y < mH; y += 2) {
    for (let x = 0; x < mW; x += 2) {
      const idx = (y * mW + x) * 4;
      if (alphaMode ? maskData[idx + 3] > 127 : maskData[idx] > 127) {
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
  const alphaMode = isMaskAlphaBased(maskData);
  let sumR = 0, sumG = 0, sumB = 0, sumBr = 0, n = 0;
  const samples: number[] = [];
  for (let y = 0; y < mH; y += 3) {
    for (let x = 0; x < mW; x += 3) {
      const midx = (y * mW + x) * 4;
      if (alphaMode ? maskData[midx + 3] > 127 : maskData[midx] > 127) {
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
      c.width = img.width;
      c.height = img.height;
      c.getContext("2d")!.drawImage(img, 0, 0);
      resolve(c);
    };
    img.onerror = () => reject(new Error(`Cannot load ${url}`));
    img.src = url;
  });
}
