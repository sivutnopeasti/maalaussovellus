/**
 * Depth-edge utilities.
 *
 * Given a depth map (bright = near, dark = far), compute a binary mask
 * of pixels that lie on the boundary between near and far regions —
 * i.e. the silhouette of the foreground object (the house).
 *
 * Pipeline:
 *   1. Decode the depth raster to a luminance map
 *   2. Run a Sobel 3×3 gradient → magnitude per pixel
 *   3. Threshold to keep only strong edges
 *   4. Morphological dilation so MLSD lines that are a few pixels off
 *      the silhouette still intersect with this mask
 *
 * The result is intersected with the MLSD line mask in `lineSnap.ts`
 * to produce a "house outline" mask used for snapping.
 */

export interface DepthEdgeMask {
  width: number;
  height: number;
  /** `mask[y * width + x]` = 1 if this pixel is on (or within the
   *  dilation radius of) the depth silhouette, 0 otherwise. */
  mask: Uint8Array;
  /** Diagnostic: how many pixels were marked as edge after threshold +
   *  dilation. Useful to detect a flat / failed depth map. */
  edgePixels: number;
}

/**
 * Build a depth-silhouette mask from a loaded depth-map image.
 *
 *  - `gradThreshold` : minimum Sobel magnitude to count as edge. The
 *      raw magnitude is computed on 0–255 luminance, so values around
 *      40–60 work well for typical depth rasters.
 *  - `dilationRadius` : how far (in mask pixels) the edge band extends
 *      either side of the silhouette. A few pixels handle the small
 *      mismatch between the depth map and MLSD line locations.
 */
export function buildDepthEdgeMask(
  img: HTMLImageElement,
  gradThreshold = 40,
  dilationRadius = 4,
): DepthEdgeMask {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  const rgba = ctx.getImageData(0, 0, w, h).data;

  // Luminance buffer
  const lum = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < rgba.length; i += 4, j++) {
    lum[j] = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) | 0;
  }

  // Sobel 3×3
  //   Gx = [[-1,0,1],[-2,0,2],[-1,0,1]]
  //   Gy = [[-1,-2,-1],[0,0,0],[1,2,1]]
  const rawEdge = new Uint8Array(w * h);
  let rawCount = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const tl = lum[i - w - 1];
      const tc = lum[i - w];
      const tr = lum[i - w + 1];
      const ml = lum[i - 1];
      const mr = lum[i + 1];
      const bl = lum[i + w - 1];
      const bc = lum[i + w];
      const br = lum[i + w + 1];
      const gx = -tl + tr - 2 * ml + 2 * mr - bl + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const mag = Math.abs(gx) + Math.abs(gy); // L1 approximation, ~1.4× cheaper than sqrt
      if (mag >= gradThreshold) {
        rawEdge[i] = 1;
        rawCount++;
      }
    }
  }

  // Morphological dilation — expand each edge pixel by `dilationRadius`
  // along both axes. We use a separable two-pass (horizontal then
  // vertical) dilation with a square kernel, which is O(N) per pass
  // and fast enough for full-resolution photos.
  const mask = dilateMask(rawEdge, w, h, dilationRadius);

  let edgeCount = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) edgeCount++;

  return { width: w, height: h, mask, edgePixels: edgeCount };
}

/** Square-kernel dilation, separable: horizontal pass then vertical. */
function dilateMask(
  src: Uint8Array,
  w: number,
  h: number,
  r: number,
): Uint8Array {
  if (r <= 0) return src;
  const horiz = new Uint8Array(w * h);
  // Horizontal pass — for each row, mark output pixel if any source pixel
  // within ±r is set. Sliding window via running count.
  for (let y = 0; y < h; y++) {
    let count = 0;
    const row = y * w;
    // Initial window [0..r]
    for (let x = 0; x <= Math.min(r, w - 1); x++) {
      if (src[row + x]) count++;
    }
    for (let x = 0; x < w; x++) {
      horiz[row + x] = count > 0 ? 1 : 0;
      // Add pixel entering on the right (x + r + 1)
      const add = x + r + 1;
      if (add < w && src[row + add]) count++;
      // Remove pixel leaving on the left (x - r)
      const rem = x - r;
      if (rem >= 0 && src[row + rem]) count--;
    }
  }
  // Vertical pass on the horizontally-dilated buffer.
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) {
      if (horiz[y * w + x]) count++;
    }
    for (let y = 0; y < h; y++) {
      out[y * w + x] = count > 0 ? 1 : 0;
      const add = y + r + 1;
      if (add < h && horiz[add * w + x]) count++;
      const rem = y - r;
      if (rem >= 0 && horiz[rem * w + x]) count--;
    }
  }
  return out;
}
