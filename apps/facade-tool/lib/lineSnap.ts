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
 * Slightly bias the snap toward "intersection-like" pixels: those that
 * have white neighbours in two roughly perpendicular directions. This is
 * cheap (8-neighbour read) and tends to pull the snap onto building
 * corners rather than mid-segment points when both are nearby.
 *
 * Returns a small bonus radius (in pixels) that should be subtracted
 * from the effective distance when picking between candidates of similar
 * Euclidean distance. The current implementation just rewards 8-way
 * neighbour count; in practice the simple `snapToNearestLine` above is
 * already a big quality boost so this is an optional refinement.
 */
export function isLikelyIntersection(
  x: number,
  y: number,
  lineMap: LineMapData,
): boolean {
  const { width: w, height: h, mask } = lineMap;
  if (x <= 0 || x >= w - 1 || y <= 0 || y >= h - 1) return false;
  let n = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (mask[(y + dy) * w + (x + dx)]) n++;
    }
  }
  // A simple mid-segment point has typically 2 lit neighbours; corners
  // (intersections) have 3+.
  return n >= 3;
}
