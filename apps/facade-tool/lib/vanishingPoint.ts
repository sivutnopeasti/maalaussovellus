/**
 * Vertical vanishing-point detection from MLSD line data.
 *
 * When a photo is taken with the phone tilted up (very common — the customer
 * cannot back off far enough to fit the ridge in frame), the vertical edges
 * of the building converge to a vanishing point ABOVE the image center.
 * Conversely, tilting down moves the vanishing point below center.
 *
 * The image y-coordinate of this vanishing point (signed, relative to image
 * center) together with an assumed focal length yields the camera tilt β:
 *
 *   tan(β) = f / |v_y|        (β > 0 if vanishing point is above center)
 *
 * No user input required — purely geometric, derived from MLSD line segments
 * which the analysis pipeline already produces.
 */

export interface VanishingPointResult {
  /** Signed y offset of vanishing point relative to image vertical center, in original image pixels. Negative = above. */
  vyOffset: number;
  /** Camera tilt β in degrees. Positive = camera tilted up (ridge into frame). */
  betaDeg: number;
  /** 0–1 estimate of detection reliability based on vote concentration. */
  confidence: number;
  /** Number of line-direction votes that contributed. */
  voteCount: number;
}

const ASSUMED_FOCAL_RATIO = 0.85; // f ≈ 0.85 × image height — typical phone vertical FOV ~65°

/**
 * Detect the vertical vanishing point from an MLSD line map.
 * Returns null when too few near-vertical lines are visible (e.g. interior
 * walls without windows, blurry photos).
 */
export async function findVerticalVanishingPoint(
  mlsdMapUrl: string,
  imageWidth: number,
  imageHeight: number,
): Promise<VanishingPointResult | null> {
  const img = await loadImage(mlsdMapUrl);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, c.width, c.height).data;

  const W = c.width;
  const H = c.height;
  const cx = W / 2;
  const cy = H / 2;

  // Sample every STEP pixels — full-res scan is overkill for vanishing-point voting.
  const STEP = 4;
  // For each line pixel we find the local direction by searching a small
  // window. SEARCH must be larger than STEP so neighbouring line pixels are
  // reachable. Direction is (bestDx, bestDy).
  const SEARCH = STEP * 3;

  const votes: number[] = [];

  for (let y = SEARCH; y < H - SEARCH; y += STEP) {
    for (let x = SEARCH; x < W - SEARCH; x += STEP) {
      if (data[(y * W + x) * 4] < 200) continue;

      // Find nearest other line pixel within the search window
      let bestDx = 0, bestDy = 0, bestDist = Infinity;
      for (let dy = -SEARCH; dy <= SEARCH; dy += STEP) {
        for (let dx = -SEARCH; dx <= SEARCH; dx += STEP) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (data[(ny * W + nx) * 4] < 200) continue;
          const dist = dx * dx + dy * dy;
          if (dist < bestDist) {
            bestDist = dist;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }
      if (bestDist === Infinity) continue;

      const absDx = Math.abs(bestDx);
      const absDy = Math.abs(bestDy);

      // Skip non-vertical lines (require dy/dx ratio ≥ 3)
      if (absDy < 3 * absDx) continue;

      // Perfectly vertical lines (dx = 0) give no x-direction info → skip
      if (absDx === 0) continue;

      // Require some minimum offset from the central column.
      // Lines passing right through center contribute almost no signal.
      const xOffset = x - cx;
      if (Math.abs(xOffset) < W * 0.05) continue;

      // Line through (x, y) with slope m = bestDy / bestDx.
      // y at x = cx:  y_at_cx = y + m * (cx - x)
      const slope = bestDy / bestDx;
      const yAtCx = y + slope * (cx - x);
      const yOffset = yAtCx - cy;

      // Reject crazy outliers (vanishing point too close to image or absurdly far)
      const absOff = Math.abs(yOffset);
      if (absOff < H * 0.1) continue;     // too close — would imply β near 90°
      if (absOff > H * 30) continue;      // essentially β = 0 — uninformative

      votes.push(yOffset);
    }
  }

  if (votes.length < 30) return null;

  // Robust median + IQR-based confidence
  votes.sort((a, b) => a - b);
  const median = votes[Math.floor(votes.length / 2)];
  const q25 = votes[Math.floor(votes.length * 0.25)];
  const q75 = votes[Math.floor(votes.length * 0.75)];
  const iqr = Math.abs(q75 - q25);
  const relIqr = iqr / Math.max(Math.abs(median), 1);
  // Tight cluster (relIqr ≪ 1) = high confidence
  const confidence = Math.max(0, Math.min(1, 1 - relIqr));

  // Scale from MLSD canvas coords back to original image coords
  const scaleY = imageHeight / H;
  const vyOffset = median * scaleY;

  // tan(β) = f / |v_y| with f = ASSUMED_FOCAL_RATIO × image_height
  const f = ASSUMED_FOCAL_RATIO * imageHeight;
  const tanBeta = f / Math.max(Math.abs(vyOffset), 1);
  const betaMagDeg = (Math.atan(tanBeta) * 180) / Math.PI;
  // Positive β when vanishing point is above center (vy < 0)
  const betaDeg = vyOffset < 0 ? betaMagDeg : -betaMagDeg;

  return {
    vyOffset,
    betaDeg,
    confidence,
    voteCount: votes.length,
  };
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Cannot load MLSD map: ${url}`));
    img.src = url;
  });
}
