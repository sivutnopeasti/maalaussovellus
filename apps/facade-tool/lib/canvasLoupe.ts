/**
 * Magnifying loupe rendered directly onto the same canvas as the
 * picker UI. Used by ReferenceMeasure and PolygonSelect to show what's
 * underneath the user's finger while they're dragging a point or
 * placing one with a touch — without the loupe the finger usually
 * covers the pixel they're trying to aim for.
 *
 * The function operates in *canvas* (post-CSS, identity-transform)
 * pixels. The caller must reset the canvas transform before invoking
 * it; the loupe positions itself above/below the target point and
 * draws a magnified slice of the underlying photo.
 */
import type { Point } from "./types";

export interface DrawLoupeOpts {
  /** Original-image coordinates of the point being inspected. */
  imagePoint: Point;
  /** Same point in canvas-space (after image scale, zoom and pan). */
  canvasPoint: Point;
  /** Source image (the photo the user is annotating). */
  source: HTMLImageElement;
  /** Canvas dimensions in CSS pixels. */
  canvasW: number;
  canvasH: number;
  /** Loupe shape: a rectangular pill is easier to scan visually (more
   *  horizontal context, less screen real estate consumed) than a
   *  circle. Defaults to "rounded" rectangle. */
  shape?: "rounded" | "circle";
  /** Width of the loupe in canvas px (rounded rect only). */
  width?: number;
  /** Height of the loupe in canvas px (rounded rect only). */
  height?: number;
  /** Corner radius of the rounded-rect loupe in canvas px. */
  borderRadius?: number;
  /** Magnification level. Lower = more context, less detail.
   *  1.7× was chosen so a sokkeli / tikkurila eaves still fits inside
   *  the window while remaining clearly readable. */
  magnification?: number;
  /** Optional secondary marker — drawn as a small ring inside the
   *  loupe to indicate where a snap would land. */
  snapPoint?: Point | null;
  /** Tint of the centre cross-hair. */
  accent?: string;
}

/** Helper: rounded-rect path (avoids relying on ctx.roundRect for
 *  older targets, even though it's now standard). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.arcTo(x + w, y, x + w, y + rr, rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
  ctx.lineTo(x + rr, y + h);
  ctx.arcTo(x, y + h, x, y + h - rr, rr);
  ctx.lineTo(x, y + rr);
  ctx.arcTo(x, y, x + rr, y, rr);
  ctx.closePath();
}

/**
 * Draw a magnifier on the canvas. Assumes ctx is in identity
 * transform (caller has called `viewport.resetTransform(ctx)`).
 */
export function drawLoupe(
  ctx: CanvasRenderingContext2D,
  opts: DrawLoupeOpts,
): void {
  const {
    imagePoint,
    canvasPoint,
    source,
    canvasW,
    canvasH,
    shape = "rounded",
    width = 160,
    height = 110,
    borderRadius = 18,
    magnification = 1.7,
    snapPoint = null,
    accent = "#EF4444",
  } = opts;

  if (!source || !source.complete || source.naturalWidth === 0) return;

  // Loupe extent. For the legacy circle shape we treat (width/2) as
  // the radius so both code paths share clamping logic.
  const halfW = shape === "circle" ? width / 2 : width / 2;
  const halfH = shape === "circle" ? width / 2 : height / 2;
  const loupeW = shape === "circle" ? width : width;
  const loupeH = shape === "circle" ? width : height;

  // Place the loupe above the target. If it would clip the top edge,
  // flip below the finger instead. Horizontally clamp into the canvas.
  const gap = 38; // px of space between loupe edge and finger
  let cx = canvasPoint.x;
  let cy = canvasPoint.y - halfH - gap;
  if (cy - halfH < 6) cy = canvasPoint.y + halfH + gap;
  if (cy + halfH > canvasH - 6) cy = canvasPoint.y - halfH - gap;
  cx = Math.max(halfW + 6, Math.min(canvasW - halfW - 6, cx));

  // Source slice. We sample around imagePoint and let drawImage
  // shrink/expand to the loupe dimensions.
  const srcW = loupeW / magnification;
  const srcH = loupeH / magnification;
  // Clamp the source rect inside the image bounds so we never sample
  // out-of-range pixels.
  const srcX = Math.max(
    0,
    Math.min(source.naturalWidth - srcW, imagePoint.x - srcW / 2),
  );
  const srcY = Math.max(
    0,
    Math.min(source.naturalHeight - srcH, imagePoint.y - srcH / 2),
  );

  // Where does the target point land *inside* the loupe? If we had to
  // clamp the source rect (point near the image edge), the centre of
  // the loupe no longer corresponds to the user's actual point, so we
  // need to draw the cross-hair where the point actually is.
  const targetInLoupeX = (imagePoint.x - srcX) * magnification + (cx - halfW);
  const targetInLoupeY = (imagePoint.y - srcY) * magnification + (cy - halfH);

  ctx.save();

  // Drop shadow ring for the loupe border (drawn behind the loupe so
  // it reads as a card floating above the canvas).
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 5;
  ctx.fillStyle = "rgba(15, 23, 42, 0.55)";
  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(cx, cy, halfW + 4, 0, Math.PI * 2);
    ctx.fill();
  } else {
    roundRectPath(
      ctx,
      cx - halfW - 4,
      cy - halfH - 4,
      loupeW + 8,
      loupeH + 8,
      borderRadius + 4,
    );
    ctx.fill();
  }
  ctx.restore();

  // Magnified photo, clipped to the loupe shape.
  ctx.save();
  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(cx, cy, halfW, 0, Math.PI * 2);
  } else {
    roundRectPath(
      ctx,
      cx - halfW,
      cy - halfH,
      loupeW,
      loupeH,
      borderRadius,
    );
  }
  ctx.clip();

  // Dark background so we always have a defined backdrop even if the
  // source draw misses.
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(cx - halfW, cy - halfH, loupeW, loupeH);

  ctx.drawImage(
    source,
    srcX,
    srcY,
    srcW,
    srcH,
    cx - halfW,
    cy - halfH,
    loupeW,
    loupeH,
  );

  // Cross-hair through the target point. Drawn full-extent; the clip
  // culls anything outside the loupe.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(targetInLoupeX - loupeW, targetInLoupeY);
  ctx.lineTo(targetInLoupeX + loupeW, targetInLoupeY);
  ctx.moveTo(targetInLoupeX, targetInLoupeY - loupeH);
  ctx.lineTo(targetInLoupeX, targetInLoupeY + loupeH);
  ctx.stroke();

  // Snap indicator (optional). Drawn as a hollow ring at the snap
  // location *inside* the loupe so the user can see how the snap
  // would correct their click before releasing.
  if (snapPoint) {
    const snapInLoupeX =
      (snapPoint.x - srcX) * magnification + (cx - halfW);
    const snapInLoupeY =
      (snapPoint.y - srcY) * magnification + (cy - halfH);
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(snapInLoupeX, snapInLoupeY, 9, 0, Math.PI * 2);
    ctx.stroke();
    // Dashed line connecting raw target to snap so the user sees the
    // correction direction.
    ctx.strokeStyle = "rgba(16, 185, 129, 0.7)";
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(targetInLoupeX, targetInLoupeY);
    ctx.lineTo(snapInLoupeX, snapInLoupeY);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Centre target dot.
  ctx.beginPath();
  ctx.arc(targetInLoupeX, targetInLoupeY, 4, 0, Math.PI * 2);
  ctx.fillStyle = accent;
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore(); // remove clip

  // Outer white border on top of everything.
  if (shape === "circle") {
    ctx.beginPath();
    ctx.arc(cx, cy, halfW, 0, Math.PI * 2);
  } else {
    roundRectPath(
      ctx,
      cx - halfW,
      cy - halfH,
      loupeW,
      loupeH,
      borderRadius,
    );
  }
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}
