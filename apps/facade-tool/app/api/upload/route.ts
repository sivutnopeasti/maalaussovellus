import { NextRequest, NextResponse } from "next/server";
import { fal } from "@fal-ai/client";
import { configureFal } from "@/lib/fal";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    configureFal();

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

    const url = await fal.storage.upload(file);
    return NextResponse.json({ url });
  } catch (err) {
    console.error("[/api/upload]", err);
    return NextResponse.json(
      { error: "Upload failed", detail: String(err) },
      { status: 500 },
    );
  }
}
