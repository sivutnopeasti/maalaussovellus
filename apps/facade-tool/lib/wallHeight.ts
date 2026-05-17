/**
 * Wall corner height helpers.
 *
 * The user-drawn facade polygon almost always contains the wall corners as
 * (near-)vertical edges:
 *  - on a long wall photo, the left and right polygon sides go straight up
 *    from the foundation to the eaves
 *  - on a gable photo, the same is true below the slanted ridge edges
 *
 * The vertical edges therefore encode the *real* wall corner height in
 * pixels. Once the scale (pixels/meter) is known, we can derive the corner
 * height in meters and reuse it as an automatic reference for subsequent
 * photos of the same house — no extra reference line needed.
 */

import type { Point } from "./types";

/** Edges whose direction deviates this much from vertical are treated
 *  as a wall corner with high confidence. */
const VERTICAL_TOLERANCE_DEG = 30;

/** Fallback tolerance — if the strict tolerance finds nothing, we treat
 *  anything "more vertical than horizontal" as a wall corner candidate.
 *  This guarantees `estimateWallHeightM` returns a value for virtually
 *  every reasonable polygon, so auto-reference always works. */
const FALLBACK_VERTICAL_DEG = 60;

/** Edges shorter than this (in pixels) are ignored — they are too small to
 *  represent a full wall corner reliably. */
const MIN_EDGE_PIXELS = 30;

export interface VerticalEdge {
  p1: Point;
  p2: Point;
  pixelLength: number;
  /** Deviation from a perfectly vertical line, in degrees. */
  deviationDeg: number;
}

/** Return all polygon edges whose deviation from vertical is ≤ `toleranceDeg`. */
export function findVerticalEdges(
  polygon: Point[],
  toleranceDeg: number = VERTICAL_TOLERANCE_DEG,
): VerticalEdge[] {
  if (polygon.length < 2) return [];
  const edges: VerticalEdge[] = [];
  const n = polygon.length;
  for (let i = 0; i < n; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const pixelLength = Math.sqrt(dx * dx + dy * dy);
    if (pixelLength < MIN_EDGE_PIXELS) continue;
    // 0° = perfectly vertical, 90° = perfectly horizontal
    const deviationDeg =
      Math.atan2(Math.abs(dx), Math.abs(dy)) * (180 / Math.PI);
    if (deviationDeg <= toleranceDeg) {
      edges.push({ p1: a, p2: b, pixelLength, deviationDeg });
    }
  }
  return edges;
}

/** Estimate the wall corner height (in meters) from a polygon, given a known
 *  pixels-per-meter scale. Uses a two-tier strategy:
 *
 *   1. Strict: edges within VERTICAL_TOLERANCE_DEG of vertical → take the
 *      median length. This is the normal path.
 *   2. Fallback: if nothing was strict-vertical, accept any edge that's at
 *      least "more vertical than horizontal" (FALLBACK_VERTICAL_DEG) and
 *      return the LONGEST such edge — typically the actual wall corner in
 *      a strongly tilted photo.
 *
 *  Returns null only if the polygon doesn't have a single edge that's more
 *  vertical than horizontal — which essentially never happens in practice.
 */
export function estimateWallHeightM(
  polygon: Point[],
  pixelsPerMeter: number,
): number | null {
  if (pixelsPerMeter <= 0) return null;

  // Strict pass
  const strict = findVerticalEdges(polygon, VERTICAL_TOLERANCE_DEG);
  if (strict.length > 0) {
    const sorted = strict.map((e) => e.pixelLength).sort((a, b) => a - b);
    const m = sorted.length;
    const median =
      m % 2 === 0
        ? (sorted[m / 2 - 1] + sorted[m / 2]) / 2
        : sorted[Math.floor(m / 2)];
    return median / pixelsPerMeter;
  }

  // Fallback pass — take the longest "more vertical than horizontal" edge.
  const lax = findVerticalEdges(polygon, FALLBACK_VERTICAL_DEG);
  if (lax.length === 0) return null;
  const longest = lax.reduce((best, e) =>
    e.pixelLength >= best.pixelLength ? e : best,
  );
  console.log("[wallHeight] using fallback edge", {
    deviationDeg: longest.deviationDeg.toFixed(1),
    pixelLength: longest.pixelLength.toFixed(0),
  });
  return longest.pixelLength / pixelsPerMeter;
}

/** Pick the longest near-vertical edge of a polygon — the best candidate to
 *  use as a reference line when calibrating a new photo against a known
 *  wall corner height. Falls back to a permissive tolerance when needed,
 *  same as `estimateWallHeightM`. */
export function findReferenceVerticalEdge(
  polygon: Point[],
): VerticalEdge | null {
  const strict = findVerticalEdges(polygon, VERTICAL_TOLERANCE_DEG);
  if (strict.length > 0) {
    return strict.reduce((best, e) =>
      e.pixelLength >= best.pixelLength ? e : best,
    );
  }
  const lax = findVerticalEdges(polygon, FALLBACK_VERTICAL_DEG);
  if (lax.length === 0) return null;
  return lax.reduce((best, e) =>
    e.pixelLength >= best.pixelLength ? e : best,
  );
}

// ─── localStorage persistence ────────────────────────────────────────────────

const STORAGE_KEY = "facadeStoredWallHeight";
const PROJECT_KEY = "facadeProject";

export interface StoredWallHeight {
  /** Wall corner height in meters. */
  valueM: number;
  /** Timestamp (ms since epoch). */
  savedAt: number;
}

/** Persist the wall corner height across sessions. */
export function storeWallHeight(valueM: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(valueM) || valueM <= 0) {
    console.warn("[wallHeight] storeWallHeight refused", { valueM });
    return;
  }
  const data: StoredWallHeight = { valueM, savedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    // Verify the write actually landed.
    const back = localStorage.getItem(STORAGE_KEY);
    console.log("[wallHeight] wrote", valueM, "m → readback:", back);
  } catch (err) {
    console.error("[wallHeight] localStorage.setItem failed", err);
  }
}

/** Read the previously stored wall corner height, if any. */
export function getStoredWallHeight(): StoredWallHeight | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredWallHeight>;
    if (typeof parsed.valueM === "number" && parsed.valueM > 0) {
      return {
        valueM: parsed.valueM,
        savedAt: typeof parsed.savedAt === "number" ? parsed.savedAt : 0,
      };
    }
  } catch (err) {
    console.warn("[wallHeight] getStoredWallHeight parse error", err);
  }
  return null;
}

/** Clear any stored wall corner height. */
export function clearStoredWallHeight(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ─── Multi-photo project ─────────────────────────────────────────────────────

export interface WallMeasurement {
  /** Human-readable label, e.g. "Pääty 1", "Pitkä sivu 1". */
  label: string;
  /** Net wall area in m² for this single photo. */
  areaM2: number;
  /** Timestamp. */
  measuredAt: number;
}

export interface FacadeProject {
  measurements: WallMeasurement[];
  startedAt: number;
}

export function getProject(): FacadeProject | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FacadeProject>;
    if (Array.isArray(parsed.measurements)) {
      return {
        measurements: parsed.measurements as WallMeasurement[],
        startedAt:
          typeof parsed.startedAt === "number" ? parsed.startedAt : Date.now(),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

export function addMeasurement(areaM2: number, label?: string): FacadeProject {
  const existing = getProject();
  const measurements = existing?.measurements ?? [];
  const finalLabel =
    label ??
    (measurements.length === 0 ? "Seinä 1" : `Seinä ${measurements.length + 1}`);
  const next: FacadeProject = {
    measurements: [
      ...measurements,
      { label: finalLabel, areaM2, measuredAt: Date.now() },
    ],
    startedAt: existing?.startedAt ?? Date.now(),
  };
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export function clearProject(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(PROJECT_KEY);
  } catch {
    // ignore
  }
}

export function projectTotalM2(project: FacadeProject | null): number {
  if (!project) return 0;
  return project.measurements.reduce((sum, m) => sum + m.areaM2, 0);
}
