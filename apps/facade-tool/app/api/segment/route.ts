import { NextRequest, NextResponse } from "next/server";
import {
  configureFal,
  runSam3Prompted,
  uploadToFalStorage,
  type Sam3Output,
} from "@/lib/fal";
import type { MaskResult } from "@/lib/types";

export const maxDuration = 120;

const HF_MODEL = "nickmuchi/segformer-b4-finetuned-segments-facade";
const WALL_CLASSES = ["facade"];
const OPENING_CLASSES = ["window", "door"];

/**
 * Call HuggingFace Inference API for facade segmentation.
 * Returns labeled binary masks (white = that class).
 * Falls back to null if unavailable / rate-limited.
 */
async function runHuggingFaceFacade(imageUrl: string): Promise<{
  wallMaskUrl: string | null;
  openingMasks: MaskResult[];
} | null> {
  try {
    const hfToken = process.env.HF_TOKEN;
    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "X-Wait-For-Model": "true",
    };
    if (hfToken) headers["Authorization"] = `Bearer ${hfToken}`;

    // Fetch image bytes from fal.ai storage
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return null;
    const imgBuffer = await imgRes.arrayBuffer();

    const hfRes = await fetch(
      `https://api-inference.huggingface.co/models/${HF_MODEL}`,
      { method: "POST", headers, body: imgBuffer, signal: AbortSignal.timeout(45_000) },
    );
    if (!hfRes.ok) {
      console.warn(`[HuggingFace] ${hfRes.status}: ${await hfRes.text()}`);
      return null;
    }

    const segments: Array<{ label: string; score: number; mask: string }> =
      await hfRes.json();
    if (!Array.isArray(segments) || segments.length === 0) return null;

    // Upload masks to fal.ai storage so client can load them as URLs
    let wallMaskUrl: string | null = null;
    const wallSeg = segments.find((s) => WALL_CLASSES.includes(s.label));
    if (wallSeg?.mask) {
      const buf = Buffer.from(wallSeg.mask, "base64");
      const file = new File([buf], "wall.png", { type: "image/png" });
      wallMaskUrl = await uploadToFalStorage(file);
    }

    const openingMasks: MaskResult[] = [];
    const openingSegs = segments.filter((s) => OPENING_CLASSES.includes(s.label));
    for (let i = 0; i < openingSegs.length; i++) {
      if (!openingSegs[i].mask) continue;
      const buf = Buffer.from(openingSegs[i].mask, "base64");
      const file = new File([buf], `opening-${i}.png`, { type: "image/png" });
      const url = await uploadToFalStorage(file);
      openingMasks.push({
        index: i,
        url,
        width: 0,
        height: 0,
        category: "opening",
      });
    }

    console.log(
      `[HuggingFace] ✓ wall=${!!wallMaskUrl} openings=${openingMasks.length}`,
    );
    return { wallMaskUrl, openingMasks };
  } catch (err) {
    console.warn("[HuggingFace] facade segmentation failed:", err);
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    configureFal();

    const { imageUrl } = await req.json();
    if (!imageUrl) {
      return NextResponse.json(
        { error: "imageUrl is required" },
        { status: 400 },
      );
    }

    // Run all three in parallel for best speed:
    // 1. HuggingFace facade model (best accuracy for real facades)
    // 2. SAM 3 wall prompt (fallback wall mask for corner detection)
    // 3. SAM 3 opening prompt (fallback opening detection)
    const empty: Sam3Output = { masks: [], boxes: [], metadata: [] };
    const [hfResult, sam3WallResult, sam3OpeningResult] = await Promise.all([
      runHuggingFaceFacade(imageUrl),
      runSam3Prompted(
        imageUrl,
        "wooden wall cladding, wood siding, painted wood planks, horizontal boards, house wall surface, exterior house wall, painted surface",
        8,
      ).catch(() => empty),
      runSam3Prompted(
        imageUrl,
        "window, door, glass opening, entrance door, window frame, window pane",
        8,
      ).catch(() => empty),
    ]);

    // Prefer HuggingFace results; fall back to SAM 3
    const wallMaskUrl =
      hfResult?.wallMaskUrl ?? sam3WallResult.masks?.[0]?.url ?? null;

    let masks: MaskResult[];
    if (hfResult && hfResult.openingMasks.length > 0) {
      // HuggingFace found openings — use them (more reliable)
      masks = hfResult.openingMasks;
    } else {
      // Fall back to SAM 3 opening masks
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

    const source = hfResult ? "huggingface+sam3-fallback" : "sam3";
    return NextResponse.json({ masks, wallMaskUrl, source });
  } catch (err) {
    console.error("[/api/segment]", err);
    return NextResponse.json(
      { error: "Segmentation failed", detail: String(err) },
      { status: 500 },
    );
  }
}
