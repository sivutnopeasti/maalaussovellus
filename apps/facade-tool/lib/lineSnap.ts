/**
 * Line-snap utilities.
 *
 * Given an M-LSD line map (white pixels = detected structural edges,
 * black = background), find the nearest white pixel to a given image
 * coordinate. Used by PolygonSelect to snap user clicks onto building
 * edges for pixel-accurate facade outlines.
 *
 * Implementation: brute-force radial scan in expanding square shells,
 * which stays fast in practice because the snap radius is small (≤40 px
 * in the line map) and the ring at radius `r` has only 8r pixels. Total
 * cost per click is O(r²) ≈ 6 400 reads at r = 40, completed well
 * under 1 ms on every device we care about.
 */

import type { Point } from "./types";

export interface LineMapData {
  width: number;
  height: number;
  /**
   * Single-channel mask of white-pixel locations. `mask[y * width + x]`
   * is non-zero (1) if that pixel was white in the source line map, 0
   * otherwise. Decoupling from the original RGBA buffer halves the
   * memory footprint and roughly doubles snap speed since we only read
   * one byte per pixel.
   */
  mask: Uint8Array;
}

/**
 * Decode an HTMLImageElement (already loaded) of an M-LSD raster into a
 * compact `LineMapData` ready for snapping. We treat anything brighter
 * than `threshold` (default 80, lowered from 128 to also pick up
 * anti-aliased / semi-transparent line edges) as "line".
 *
 * Returns extra diagnostic stats so the UI can show whether the raster
 * actually contains any detected lines.
 */
export function buildLineMap(
  img: HTMLImageElement,
  threshold = 80,
): LineMapData & { whitePixels: number; whiteRatio: number } {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  let whiteCount = 0;
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    const lum = 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
    if (lum > threshold) {
      mask[j] = 1;
      whiteCount++;
    }
  }
  return {
    width: w,
    height: h,
    mask,
    whitePixels: whiteCount,
    whiteRatio: whiteCount / (w * h),
  };
}

/**
 * Find the nearest "white" (line) pixel to `point` within `maxRadiusPx`.
 *
 * Returns `null` if no line pixel is found inside the search disc. Both
 * input and output coordinates are in original-image pixels.
 *
 * If the line map was produced at a different resolution than the
 * source image (e.g. Fal's MLSD always emits 1024×1024 even for
 * non-square inputs), pass `scaleX = lineMapWidth / sourceImageWidth`
 * AND `scaleY = lineMapHeight / sourceImageHeight`. When they differ
 * the lookup correctly accounts for the (possibly anamorphic) stretch.
 */
export function snapToNearestLine(
  point: Point,
  lineMap: LineMapData,
  maxRadiusPx: number,
  scaleX = 1,
  scaleY = scaleX,
): Point | null {
  const { width: w, height: h, mask } = lineMap;
  const cx = Math.round(point.x * scaleX);
  const cy = Math.round(point.y * scaleY);
  // Radius in line-map pixels — use the smaller of the two scales so the
  // search disc never extends further than `maxRadiusPx` source pixels
  // in either direction.
  const r = Math.max(1, Math.round(maxRadiusPx * Math.min(scaleX, scaleY)));

  // Fast path: clicked pixel is already on a line.
  if (cx >= 0 && cx < w && cy >= 0 && cy < h && mask[cy * w + cx]) {
    return { x: cx / scaleX, y: cy / scaleY };
  }

  // Expanding square shells. We track the closest hit by Euclidean
  // distance — square shells visit pixels by Chebyshev distance, so we
  // can't stop at the first hit (a pixel one shell further out can be
  // Euclidean-closer than one in the current shell). Instead, finish
  // the shell after the first hit, then return — by that point we've
  // visited every pixel within √2 × r₁ of the centre, which contains
  // the true nearest neighbour.
  let bestDist2 = Infinity;
  let bestX = -1;
  let bestY = -1;
  let foundShellRadius = -1;

  for (let shell = 1; shell <= r; shell++) {
    if (foundShellRadius > 0 && shell > foundShellRadius * Math.SQRT2 + 1) {
      // We've gone far enough beyond the first hit that no later shell
      // can win.
      break;
    }
    const x0 = Math.max(0, cx - shell);
    const x1 = Math.min(w - 1, cx + shell);
    const y0 = Math.max(0, cy - shell);
    const y1 = Math.min(h - 1, cy + shell);

    // Top and bottom rows of the shell
    for (const y of [cy - shell, cy + shell]) {
      if (y < 0 || y >= h) continue;
      for (let x = x0; x <= x1; x++) {
        if (mask[y * w + x]) {
          const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestX = x;
            bestY = y;
            if (foundShellRadius < 0) foundShellRadius = shell;
          }
        }
      }
    }
    // Left and right columns (excluding corners already covered)
    for (const x of [cx - shell, cx + shell]) {
      if (x < 0 || x >= w) continue;
      for (let y = y0 + 1; y <= y1 - 1; y++) {
        if (mask[y * w + x]) {
          const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
          if (d2 < bestDist2) {
            bestDist2 = d2;
            bestX = x;
            bestY = y;
            if (foundShellRadius < 0) foundShellRadius = shell;
          }
        }
      }
    }
  }

  if (bestX < 0) return null;
  return { x: bestX / scaleX, y: bestY / scaleY };
}

/**
 * Decide whether the pixel at (x, y) is a "corner" — i.e. an
 * intersection, endpoint or bend in the line graph. Used by
 * `snapToNearestCorner` and as a tie-breaker for snap targets.
 *
 * Heuristic (looking at the 8-neighbourhood of `(x, y)`):
 *   - 0 lit neighbours → isolated pixel, not useful.
 *   - 1 lit neighbour → line endpoint. MLSD often emits short line
 *     stubs at building corners that don't quite touch the next line —
 *     a stub endpoint is just as useful a snap target.
 *   - 2 lit neighbours → could be either a plain mid-segment pixel
 *     (the two neighbours are directly opposite each other, e.g.
 *     (-1,0) and (+1,0) for a horizontal line) or a 90° corner /
 *     T-junction (the two neighbours come from non-opposite
 *     directions, e.g. (-1,0) and (0,-1)). Sum the direction vectors:
 *     opposite directions cancel to (0,0); anything else means a
 *     bend.
 *   - ≥ 3 lit neighbours → always a junction (T, X, Y, …).
 *
 * Without the bend detection, a perfectly clean 90° corner with two
 * 1-pixel-wide line segments meeting at exactly one shared pixel was
 * being classified as mid-segment — the very case `snapToNearestCorner`
 * is meant to catch.
 */
export function isLikelyIntersection(
  x: number,
  y: number,
  lineMap: LineMapData,
): boolean {
  const { width: w, height: h, mask } = lineMap;
  if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) return false;
  let n = 0;
  let sumDx = 0;
  let sumDy = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (mask[(y + dy) * w + (x + dx)]) {
        n++;
        sumDx += dx;
        sumDy += dy;
      }
    }
  }
  if (n === 0) return false;
  if (n === 1) return true;
  if (n === 2) {
    // Pair of directly-opposite neighbours sums to (0,0) → straight
    // mid-segment. Anything else is a bend / corner / T-junction.
    return !(sumDx === 0 && sumDy === 0);
  }
  return true;
}

/**
 * Snap a point to the nearest CORNER pixel within the given radius.
 *
 * A "corner" is any line-pixel for which `isLikelyIntersection`
 * returns true — typically the intersection of two segments (house
 * corner, eaves/ridge join, opening corner). Returns null when no
 * corner is found inside the search disc — callers should then fall
 * back to `snapToNearestLine` for a regular line snap.
 *
 * Like `snapToNearestLine`, this function handles separate X/Y
 * scales for the line map (Fal MLSD emits a fixed 1024×1024 raster
 * regardless of input aspect ratio).
 */
export function snapToNearestCorner(
  point: Point,
  lineMap: LineMapData,
  maxRadiusPx: number,
  scaleX = 1,
  scaleY = scaleX,
): Point | null {
  const { width: w, height: h, mask } = lineMap;
  const cx = Math.round(point.x * scaleX);
  const cy = Math.round(point.y * scaleY);
  const r = Math.max(1, Math.round(maxRadiusPx * Math.min(scaleX, scaleY)));

  // Fast path: clicked pixel itself is a corner.
  if (cx >= 1 && cx < w - 1 && cy >= 1 && cy < h - 1) {
    if (mask[cy * w + cx] && isLikelyIntersection(cx, cy, lineMap)) {
      return { x: cx / scaleX, y: cy / scaleY };
    }
  }

  // Expanding square shells, identical structure to snapToNearestLine
  // but additionally requires the pixel to be a corner.
  let bestDist2 = Infinity;
  let bestX = -1;
  let bestY = -1;
  let foundShellRadius = -1;

  for (let shell = 1; shell <= r; shell++) {
    if (foundShellRadius > 0 && shell > foundShellRadius * Math.SQRT2 + 1) {
      break;
    }
    const x0 = Math.max(1, cx - shell);
    const x1 = Math.min(w - 2, cx + shell);
    const y0 = Math.max(1, cy - shell);
    const y1 = Math.min(h - 2, cy + shell);

    const checkPixel = (x: number, y: number) => {
      if (!mask[y * w + x]) return;
      if (!isLikelyIntersection(x, y, lineMap)) return;
      const d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
      if (d2 < bestDist2) {
        bestDist2 = d2;
        bestX = x;
        bestY = y;
        if (foundShellRadius < 0) foundShellRadius = shell;
      }
    };

    // Top and bottom rows
    for (const y of [cy - shell, cy + shell]) {
      if (y < 1 || y > h - 2) continue;
      for (let x = x0; x <= x1; x++) checkPixel(x, y);
    }
    // Left and right columns (without corners)
    for (const x of [cx - shell, cx + shell]) {
      if (x < 1 || x > w - 2) continue;
      for (let y = y0 + 1; y <= y1 - 1; y++) checkPixel(x, y);
    }
  }

  if (bestX < 0) return null;
  return { x: bestX / scaleX, y: bestY / scaleY };
}
