import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { configureFal } from "@/lib/fal";
import {
  createServiceSupabase,
  FACADE_CAPTURES_BUCKET,
} from "@/lib/supabaseServer";

export const maxDuration = 60;

/**
 * POST /api/upload
 *
 * - `url` — Fal-hosted URL for MLSD (Fal can always fetch its own storage).
 * - `storageUrl` + `path` — Supabase public URL for quote persistence (optional).
 */
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json(
        { error: "File must be an image" },
        { status: 400 },
      );
    }

    configureFal();
    const bytes = Buffer.from(await file.arrayBuffer());
    const uploadBlob = new Blob([bytes], {
      type: file.type || "image/jpeg",
    });

    const falUrl = await fal.storage.upload(uploadBlob);

    let storageUrl: string | undefined;
    let path: string | undefined;

    try {
      const supabase = createServiceSupabase();
      const ext =
        file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
        "jpg";
      const safeExt = ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(
        ext,
      )
        ? ext === "jpeg"
          ? "jpg"
          : ext
        : "jpg";
      path = `captures/${crypto.randomUUID()}.${safeExt}`;

      const { error: uploadError } = await supabase.storage
        .from(FACADE_CAPTURES_BUCKET)
        .upload(path, bytes, {
          contentType: file.type || `image/${safeExt}`,
          upsert: false,
          cacheControl: "31536000",
        });

      if (!uploadError) {
        const { data: urlData } = supabase.storage
          .from(FACADE_CAPTURES_BUCKET)
          .getPublicUrl(path);
        storageUrl = urlData.publicUrl;
      } else {
        console.error("[/api/upload] supabase optional:", uploadError);
      }
    } catch (err) {
      console.error("[/api/upload] supabase optional:", err);
    }

    return NextResponse.json({
      url: falUrl,
      storageUrl,
      path,
    });
  } catch (err) {
    console.error("[/api/upload]", err);
    return NextResponse.json(
      { error: "Upload failed", detail: String(err) },
      { status: 500 },
    );
  }
}
