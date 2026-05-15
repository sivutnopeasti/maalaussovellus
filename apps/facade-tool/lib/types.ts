export interface Point {
  x: number;
  y: number;
}

export interface ReferenceData {
  point1: Point;
  point2: Point;
  meters: number;
  pixelsPerMeter: number;
  pixelDistance: number;
  /**
   * Angle of the reference line from horizontal, in degrees.
   * Positive = line tilts up to the right (right side higher in image).
   * A non-zero value means the facade is viewed from an angle — used for
   * perspective foreshortening correction without any extra manual input.
   */
  angleDeg: number;
}

export type MaskCategory = "wall" | "opening" | "ignored";

export interface MaskResult {
  index: number;
  url: string;
  width: number;
  height: number;
  category: MaskCategory;
  pixelCount?: number;
}

/** Normalized bounding box hint from SAM 3 text-prompted detection */
export interface BBoxHint {
  /** Normalized [cx, cy, w, h] — values 0–1 */
  box: [number, number, number, number];
  score?: number;
}

export interface AnalysisSession {
  /** URL in fal.ai storage — passed to AI models and used for display */
  uploadedImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  reference: ReferenceData;
  masks: MaskResult[];
  depthMapUrl: string;
  /** Canny edge map — used for perspective angle analysis */
  cannyMapUrl: string | null;
  /** MLSD line map — used for dominant line angle / foreshortening correction */
  mlsdMapUrl: string | null;
  /** SAM 3 text-detected wall regions (normalized bboxes) */
  wallHints: BBoxHint[];
  /** SAM 3 text-detected opening regions (normalized bboxes) */
  openingHints: BBoxHint[];
  /** SAM 3 text-detected ignore regions: roof, sky, grass, ground */
  ignoreHints: BBoxHint[];
}

export interface MeasurementResult {
  wallPixels: number;
  openingPixels: number;
  netWallPixels: number;
  pixelsPerMeter: number;
  wallAreaM2: number;
}

export interface PaintColor {
  name: string;
  hex: string;
}

export const PAINT_COLORS: PaintColor[] = [
  { name: "Lumivalkoinen", hex: "#F8F8F0" },
  { name: "Kermavalkoinen", hex: "#FFF5DC" },
  { name: "Vaalean beige", hex: "#E8D5B7" },
  { name: "Hiekka", hex: "#C4A882" },
  { name: "Vaalean harmaa", hex: "#D1D5DB" },
  { name: "Keski harmaa", hex: "#9CA3AF" },
  { name: "Tummanharmaa", hex: "#4B5563" },
  { name: "Liuskekivi", hex: "#334155" },
  { name: "Sinenharmaa", hex: "#94A3B8" },
  { name: "Sininen", hex: "#3B82F6" },
  { name: "Yönsininen", hex: "#1E3A5F" },
  { name: "Turkoosin", hex: "#0D9488" },
  { name: "Salvianharmaa", hex: "#84A98C" },
  { name: "Metsänvihreä", hex: "#2D6A4F" },
  { name: "Oliivi", hex: "#6B7C3D" },
  { name: "Keltainen okra", hex: "#D4A017" },
  { name: "Terrakotta", hex: "#C2674F" },
  { name: "Tiilenpunainen", hex: "#9B2335" },
  { name: "Ruskea", hex: "#7B4F2E" },
  { name: "Tummruskea", hex: "#3D2314" },
];
