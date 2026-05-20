"use client";

import { useEffect, useRef, useState } from "react";
import { buildLineMap, type LineMapData } from "./lineSnap";

export type MlsdLineMapStatus = "idle" | "loading" | "ready" | "error";

type BuiltLineMap = LineMapData & {
  whitePixels: number;
  whiteRatio: number;
  rawWhitePixels: number;
};

/**
 * Decode an MLSD raster URL into a snap-ready line map. Shared by the
 * reference and polygon pickers (and the intro background gate).
 */
export function useMlsdLineMap(mlsdMapUrl: string | null | undefined) {
  const lineMapRef = useRef<BuiltLineMap | null>(null);
  const [status, setStatus] = useState<MlsdLineMapStatus>("idle");
  const [sourceImage, setSourceImage] = useState<HTMLImageElement | null>(
    null,
  );

  useEffect(() => {
    if (!mlsdMapUrl) {
      lineMapRef.current = null;
      setSourceImage(null);
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("loading");
    lineMapRef.current = null;
    setSourceImage(null);

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const lm = buildLineMap(img);
        lineMapRef.current = lm;
        setSourceImage(img);
        setStatus("ready");
      } catch {
        lineMapRef.current = null;
        setSourceImage(null);
        setStatus("error");
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        lineMapRef.current = null;
        setSourceImage(null);
        setStatus("error");
      }
    };
    img.src = mlsdMapUrl;

    return () => {
      cancelled = true;
    };
  }, [mlsdMapUrl]);

  return {
    lineMapRef,
    status,
    ready: status === "ready",
    sourceImage,
  };
}
