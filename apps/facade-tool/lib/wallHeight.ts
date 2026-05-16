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

/** Edges whose direction deviates this much from vertical are still treated
 *  as a wall corner. 15° tolerates slightly imperfect clicking and mild
 *  perspective tilt. */
const VERTICAL_TOLERANCE_DEG = 15;

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

/** Return all polygon edges that are within ±VERTICAL_TOLERANCE_DEG of vertical. */
export function findVerticalEdges(polygon: Point[]): VerticalEdge[] {
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
    if (deviationDeg <= VERTICAL_TOLERANCE_DEG) {
      edges.push({ p1: a, p2: b, pixelLength, deviationDeg });
    }
  }
  return edges;
}

/** Estimate the wall corner height (in meters) from a polygon, given a known
 *  pixels-per-meter scale. Returns the median length of all vertical edges,
 *  or null if no vertical edges are detected. */
export function estimateWallHeightM(
  polygon: Point[],
  pixelsPerMeter: number,
): number | null {
  if (pixelsPerMeter <= 0) return null;
  const edges = findVerticalEdges(polygon);
  if (edges.length === 0) return null;
  const sorted = edges.map((e) => e.pixelLength).sort((a, b) => a - b);
  const m = sorted.length;
  const median =
    m % 2 === 0
      ? (sorted[m / 2 - 1] + sorted[m / 2]) / 2
      : sorted[Math.floor(m / 2)];
  return median / pixelsPerMeter;
}

/** Pick the longest near-vertical edge of a polygon — the best candidate to
 *  use as a reference line when calibrating a new photo against a known
 *  wall corner height. */
export function findReferenceVerticalEdge(
  polygon: Point[],
): VerticalEdge | null {
  const edges = findVerticalEdges(polygon);
  if (edges.length === 0) return null;
  return edges.reduce((best, e) =>
    e.pixelLength >= best.pixelLength ? e : best,
  );
}

// ─── localStorage persistence ────────────────────────────────────────────────

const STORAGE_KEY = "facadeStoredWallHeight";

export interface StoredWallHeight {
  /** Wall corner height in meters. */
  valueM: number;
  /** Timestamp (ms since epoch). */
  savedAt: number;
}

/** Persist the wall corner height across sessions. */
export function storeWallHeight(valueM: number): void {
  if (typeof window === "undefined") return;
  if (!Number.isFinite(valueM) || valueM <= 0) return;
  const data: StoredWallHeight = { valueM, savedAt: Date.now() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota / serialization errors
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
  } catch {
    // ignore parse errors
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
