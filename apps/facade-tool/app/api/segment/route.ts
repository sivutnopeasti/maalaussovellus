import { NextRequest, NextResponse } from "next/server";
import {
  configureFal,
  runSam3Prompted,
  uploadToFalStorage,
  type Sam3Output,
} from "@/lib/fal";
import type { MaskResult } from "@/lib/types";

export const maxDuration = 120;

// Model priority:
// 1. Xpitfire — facade-specific (CMP, 12 classes), confirmed Inference API support
// 2. nvidia ADE20K — general scene model, well-deployed, includes wall/window/door
const HF_MODELS = [
  "Xpitfire/segformer-finetuned-segments-cmp-facade",
  "nvidia/segformer-b0-finetuned-ade-512-512",
];
// Use new HuggingFace router URL (2024+) — old api-inference.huggingface.co gives 404
const HF_BASE_URL = "https://router.huggingface.co/hf-inference/models";
const OPENING_CLASSES = ["window", "door"];

type HfSegment = { label: string; score: number; mask: string };

/**
 * Call HuggingFace Inference API for facade segmentation.
 * Tries models in order — Xpitfire first (shadow/tree optimized),
 * Marco333 as fallback (well-tested CMP standard).
 * Returns null if all models fail or are rate-limited.
 */
async function runHuggingFaceFacade(imageUrl: string): Promise<{
  wallMaskUrl: string | null;
  openingMasks: MaskResult[];
  modelUsed: string;
} | null> {
  try {
    const hfToken = process.env.HF_TOKEN;
    const baseHeaders: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "X-Wait-For-Model": "true",
    };
    if (hfToken) baseHeaders["Authorization"] = `Bearer ${hfToken}`;

    // Fetch image bytes from fal.ai storage
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const imgBuffer = await imgRes.arrayBuffer();

    // Try each model in sequence until one succeeds
    let segments: HfSegment[] | null = null;
    let modelUsed = "";

    for (const model of HF_MODELS) {
      try {
        const hfRes = await fetch(
          `${HF_BASE_URL}/${model}`,
          {
            method: "POST",
            headers: { ...baseHeaders },
            body: imgBuffer,
            signal: AbortSignal.timeout(40_000),
          },
        );
        if (!hfRes.ok) {
          console.warn(`[HF] ${model} → ${hfRes.status}`);
          continue;
        }
        const parsed: unknown = await hfRes.json();
        if (Array.isArray(parsed) && parsed.length > 0) {
          segments = parsed as HfSegment[];
          modelUsed = model.split("/")[1]; // short name for logging
          break;
        }
      } catch (e) {
        console.warn(`[HF] ${model} error:`, e);
      }
    }

    if (!segments) return null;

    // Upload opening masks only (wall mask no longer needed — user draws polygon manually)
    const openingMasks: MaskResult[] = [];
    const openingSegs = segments.filter((s) => OPENING_CLASSES.includes(s.label));
    for (let i = 0; i < openingSegs.length; i++) {
      if (!openingSegs[i].mask) continue;
      const buf = Buffer.from(openingSegs[i].mask, "base64");
      const file = new File([buf], `opening-${i}.png`, { type: "image/png" });
      const url = await uploadToFalStorage(file);
      openingMasks.push({ index: i, url, width: 0, height: 0, category: "opening" });
    }

    console.log(`[HF] ✓ model=${modelUsed} openings=${openingMasks.length}`);
    return { wallMaskUrl: null, openingMasks, modelUsed };
  } catch (err) {
    console.warn("[HF] facade segmentation failed:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    configureFal();

    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return NextResponse.json({ error: "imageUrl is required" }, { status: 400 });
    }

    // Run HuggingFace + SAM3 for openings in parallel.
    // Wall mask is no longer needed (user draws polygon manually).
    const empty: Sam3Output = { masks: [], boxes: [], metadata: [] };
    const [hfResult, sam3OpeningResult] = await Promise.all([
      runHuggingFaceFacade(imageUrl),
      runSam3Prompted(
        imageUrl,
        "window, door, glass opening, entrance door, window frame, window pane",
        8,
      ).catch(() => empty),
    ]);

    // Prefer HuggingFace opening masks; fall back to SAM 3
    let masks: MaskResult[];
    if (hfResult && hfResult.openingMasks.length > 0) {
      masks = hfResult.openingMasks;
    } else {
      masks = sam3OpeningResult.masks
        .filter((img) => img.url)
        .map((img, idx) => ({
          index: idx,
          url: img.url,
          width: img.width ?? 0,
          height: img.height ?? 0,
          category: "opening" as const,
        }));
    }

    const source = hfResult
      ? `huggingface:${hfResult.modelUsed}`
      : "sam3-fallback";

    // wallMaskUrl is null — manual polygon mode
    return NextResponse.json({ masks, wallMaskUrl: null, source });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
