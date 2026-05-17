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
  /** Loupe geometry — radius and magnification level. Defaults are
   *  tuned for phone use (loupe radius ≈ 60 px, 2.5× zoom). */
  radius?: number;
  magnification?: number;
  /** Optional secondary marker — drawn as a small ring inside the
   *  loupe to indicate where a snap would land. */
  snapPoint?: Point | null;
  /** Tint of the centre cross-hair. */
  accent?: string;
}

/**
 * Draw a circular magnifier on the canvas. Assumes ctx is in identity
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
    radius = 60,
    magnification = 2.5,
    snapPoint = null,
    accent = "#EF4444",
  } = opts;

  if (!source || !source.complete || source.naturalWidth === 0) return;

  // Place the loupe above the target. If it would clip the top edge,
  // flip below the finger instead. Horizontally clamp into the canvas.
  const gap = 36; // px of space between loupe edge and finger
  let cx = canvasPoint.x;
  let cy = canvasPoint.y - radius - gap;
  if (cy - radius < 6) cy = canvasPoint.y + radius + gap;
  if (cy + radius > canvasH - 6) cy = canvasPoint.y - radius - gap;
  cx = Math.max(radius + 6, Math.min(canvasW - radius - 6, cx));

  // Source slice from the original image. We sample around imagePoint
  // and let drawImage shrink/expand to the loupe diameter.
  const srcSize = (radius * 2) / magnification;
  const halfSrc = srcSize / 2;
  // Clamp the source rect inside the image bounds so we never sample
  // out-of-range pixels (which makes browsers throw or render black).
  const srcX = Math.max(
    0,
    Math.min(source.naturalWidth - srcSize, imagePoint.x - halfSrc),
  );
  const srcY = Math.max(
    0,
    Math.min(source.naturalHeight - srcSize, imagePoint.y - halfSrc),
  );

  // Where does the target point land *inside* the loupe? If we had to
  // clamp the source rect (point near the image edge), the centre of
  // the loupe no longer corresponds to the user's actual point, so we
  // need to draw the cross-hair where the point actually is.
  const targetInLoupeX = (imagePoint.x - srcX) * magnification + (cx - radius);
  const targetInLoupeY = (imagePoint.y - srcY) * magnification + (cy - radius);

  ctx.save();

  // Drop shadow ring for the loupe border.
  ctx.beginPath();
  ctx.arc(cx, cy, radius + 5, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(15, 23, 42, 0.45)";
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fill();
  ctx.shadowColor = "transparent";

  // Magnified photo, clipped to a circle.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  ctx.drawImage(
    source,
    srcX,
    srcY,
    srcSize,
    srcSize,
    cx - radius,
    cy - radius,
    radius * 2,
    radius * 2,
  );

  // Cross-hair through the target point. The diameter is drawn fully
  // — the clip will cull anything outside the loupe.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(targetInLoupeX - radius, targetInLoupeY);
  ctx.lineTo(targetInLoupeX + radius, targetInLoupeY);
  ctx.moveTo(targetInLoupeX, targetInLoupeY - radius);
  ctx.lineTo(targetInLoupeX, targetInLoupeY + radius);
  ctx.stroke();

  // Snap indicator (optional). Drawn as a hollow ring at the snap
  // location *inside* the loupe so the user can see how the snap
  // would correct their click before releasing.
  if (snapPoint) {
    const snapInLoupeX =
      (snapPoint.x - srcX) * magnification + (cx - radius);
    const snapInLoupeY =
      (snapPoint.y - srcY) * magnification + (cy - radius);
    ctx.strokeStyle = "#10b981";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(snapInLoupeX, snapInLoupeY, 8, 0, Math.PI * 2);
    ctx.stroke();
    // Line connecting raw target to snap so the user sees the
    // correction direction.
    ctx.strokeStyle = "rgba(16, 185, 129, 0.65)";
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
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}
