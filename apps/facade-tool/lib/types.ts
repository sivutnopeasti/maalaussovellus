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

/** Polygon drawn by user outlining the exact facade area to measure. */
export interface PolygonData {
  /** Corner points in original image pixel coordinates. */
  points: Point[];
}

export interface AnalysisSession {
  /** Facade outline polygon — when present, used instead of SAM wall masks for area. */
  polygon?: PolygonData;
  /** SAM 3 wall mask URL — used for automatic corner detection on the result page. */
  wallMaskUrl?: string | null;
  /** URL in fal.ai storage — passed to AI models and used for display */
  uploadedImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  reference: ReferenceData;
  /** SAM 3 opening masks (windows, doors) — subtracted from polygon area */
  masks: MaskResult[];
  depthMapUrl: string;
  /** MLSD line map — used for dominant line angle / foreshortening correction */
  mlsdMapUrl: string | null;
}

export interface MeasurementResult {
  wallPixels: number;
  openingPixels: number;
  netWallPixels: number;
  pixelsPerMeter: number;
  wallAreaM2: number;
}
