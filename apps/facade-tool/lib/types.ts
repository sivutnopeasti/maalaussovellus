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

/** Phone tilt at capture time, sourced from DeviceOrientationEvent. */
export interface CaptureTilt {
  /** Pitch (forward/back tilt). 90° = phone held vertically. */
  beta: number;
  /** Roll (sideways tilt). 0° = horizon level. */
  gamma: number;
  /** Effective camera tilt β relative to "phone vertical" — derived as (90 − beta). Positive = tilted up. */
  cameraTiltDeg: number;
}

export interface AnalysisSession {
  /** Facade outline polygon — the customer draws this manually. */
  polygon?: PolygonData;
  /** URL in fal.ai storage — passed to AI models and used for display */
  uploadedImageUrl: string;
  imageWidth: number;
  imageHeight: number;
  reference: ReferenceData;
  /** Phone orientation at capture time, when in-app camera was used.
   *  This is the sole source for vertical keystone correction now that
   *  the depth/MLSD pipeline has been removed. */
  captureTilt?: CaptureTilt;
  /**
   * Known wall corner height (m) from a previous photo of the same house.
   * When set, the result page derives a scale automatically from the
   * polygon's vertical edges instead of using the manual `reference` line.
   * `reference` in this case is a placeholder (pixelsPerMeter = 0).
   */
  autoWallHeightM?: number;
  /**
   * URL of the M-LSD line map (white lines on black background) used to
   * snap polygon clicks onto detected structural edges. Generated
   * asynchronously by /api/lines on the result page.
   */
  mlsdMapUrl?: string;
}

export interface MeasurementResult {
  wallPixels: number;
  openingPixels: number;
  netWallPixels: number;
  pixelsPerMeter: number;
  wallAreaM2: number;
}
