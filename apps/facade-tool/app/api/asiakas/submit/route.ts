import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabaseServer";

export const maxDuration = 30;

interface PhotoInput {
  storagePath: string;
  imageUrl: string;
}

/**
 * POST /api/asiakas/submit
 *
 * Customer sends photos + contact info.  No area/price calculation needed —
 * the admin processes measurements later via the admin panel.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      customerName?: string;
      customerPhone?: string;
      customerEmail?: string;
      photos: PhotoInput[];
    };

    const { customerName, customerPhone, customerEmail, photos } = body;

    if (!Array.isArray(photos) || photos.length === 0) {
      return NextResponse.json(
        { error: "At least one photo is required" },
        { status: 400 },
      );
    }

    const supabase = createServiceSupabase();

    const { data: quote, error: quoteError } = await supabase
      .from("facade_quotes")
      .insert({
        customer_name: customerName ?? null,
        customer_phone: customerPhone ?? null,
        customer_email: customerEmail ?? null,
        status: "pending",
        wall_area_m2: null,
        unit_price: null,
        fixed_costs: 0,
        image_url: photos[0]?.imageUrl ?? null,
      })
      .select()
      .single();

    if (quoteError) {
      console.error("[/api/asiakas/submit] quote error:", quoteError);
      return NextResponse.json(
        { error: "Failed to save request", detail: quoteError.message },
        { status: 500 },
      );
    }

    const { error: photosError } = await supabase
      .from("facade_quote_photos")
      .insert(
        photos.map((p, i) => ({
          quote_id: quote.id,
          storage_path: p.storagePath,
          image_url: p.imageUrl,
          wall_label: `Seinä ${i + 1}`,
          sort_order: i,
        })),
      );

    if (photosError) {
      console.error("[/api/asiakas/submit] photos error:", photosError);
      return NextResponse.json(
        { error: "Quote saved but photos failed", detail: photosError.message },
        { status: 500 },
      );
    }

    return NextResponse.json({ quoteId: quote.id });
  } catch (err) {
    console.error("[/api/asiakas/submit]", err);
    return NextResponse.json(
      { error: "Submit failed", detail: String(err) },
      { status: 500 },
    );
  }
}
