import { NextRequest, NextResponse } from "next/server";
import {
  createServiceSupabase,
  FACADE_CAPTURES_BUCKET,
} from "@/lib/supabaseServer";

export const maxDuration = 60;

/**
 * POST /api/upload
 * Stores a customer facade photo in Supabase Storage (facade-captures).
 * Returns public URL + storage path for MLSD pipeline and quote persistence.
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

    const supabase = createServiceSupabase();
    const ext =
      file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") ||
      "jpg";
    const safeExt = ["jpg", "jpeg", "png", "webp", "heic", "heif"].includes(ext)
      ? ext === "jpeg"
        ? "jpg"
        : ext
      : "jpg";
    const path = `captures/${crypto.randomUUID()}.${safeExt}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(FACADE_CAPTURES_BUCKET)
      .upload(path, bytes, {
        contentType: file.type || `image/${safeExt}`,
        upsert: false,
        cacheControl: "31536000",
      });

    if (uploadError) {
      console.error("[/api/upload] storage error:", uploadError);
      return NextResponse.json(
        { error: "Upload failed", detail: uploadError.message },
        { status: 500 },
      );
    }

    const { data: urlData } = supabase.storage
      .from(FACADE_CAPTURES_BUCKET)
      .getPublicUrl(path);

    return NextResponse.json({
      url: urlData.publicUrl,
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
