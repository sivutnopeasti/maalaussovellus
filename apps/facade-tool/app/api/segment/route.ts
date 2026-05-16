import { NextRequest, NextResponse } from "next/server";
import {
  configureFal,
  runSam3Prompted,
  uploadToFalStorage,
  type Sam3Output,
} from "@/lib/fal";
import type { MaskResult } from "@/lib/types";

export const maxDuration = 120;

// Primary: fine-tuned for real-world conditions (shadows, vegetation, variable lighting)
// Fallback: classic CMP Facade Database model, 3.7M downloads, well-tested
const HF_MODELS = [
  "Xpitfire/segformer-finetuned-segments-cmp-facade",
  "Marco333/segformer-b0-facade-cmp",
];
const WALL_CLASSES = ["facade", "wall"];
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
          `https://api-inference.huggingface.co/models/${model}`,
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

    // Upload wall mask to fal.ai storage
    let wallMaskUrl: string | null = null;
    const wallSeg = segments.find((s) => WALL_CLASSES.includes(s.label));
    if (wallSeg?.mask) {
      const buf = Buffer.from(wallSeg.mask, "base64");
      const file = new File([buf], "wall.png", { type: "image/png" });
      wallMaskUrl = await uploadToFalStorage(file);
    }

    // Upload opening masks (window + door)
    const openingMasks: MaskResult[] = [];
    const openingSegs = segments.filter((s) => OPENING_CLASSES.includes(s.label));
    for (let i = 0; i < openingSegs.length; i++) {
      if (!openingSegs[i].mask) continue;
      const buf = Buffer.from(openingSegs[i].mask, "base64");
      const file = new File([buf], `opening-${i}.png`, { type: "image/png" });
      const url = await uploadToFalStorage(file);
      openingMasks.push({ index: i, url, width: 0, height: 0, category: "opening" });
    }

    console.log(`[HF] ✓ model=${modelUsed} wall=${!!wallMaskUrl} openings=${openingMasks.length}`);
    return { wallMaskUrl, openingMasks, modelUsed };
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

    // Run in parallel:
    // 1. HuggingFace (Xpitfire → Marco333) — best accuracy for real building facades
    // 2. SAM 3 wall prompt — fallback wall mask for corner detection
    // 3. SAM 3 opening prompt — fallback opening detection
    const empty: Sam3Output = { masks: [], boxes: [], metadata: [] };
    const [hfResult, sam3WallResult, sam3OpeningResult] = await Promise.all([
      runHuggingFaceFacade(imageUrl),
      runSam3Prompted(
        imageUrl,
        "wooden wall cladding, wood siding, painted wood planks, horizontal boards, exterior house wall, painted surface",
        8,
      ).catch(() => empty),
      runSam3Prompted(
        imageUrl,
        "window, door, glass opening, entrance door, window frame, window pane",
        8,
      ).catch(() => empty),
    ]);

    // Prefer HuggingFace wall mask; fall back to SAM 3
    const wallMaskUrl =
      hfResult?.wallMaskUrl ?? sam3WallResult.masks?.[0]?.url ?? null;

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

    return NextResponse.json({ masks, wallMaskUrl, source });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
