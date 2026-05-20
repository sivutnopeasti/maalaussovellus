"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Loader2,
  ScanLine,
  Save,
} from "lucide-react";
import ReferenceMeasure from "@/components/ReferenceMeasure";
import PolygonSelect from "@/components/PolygonSelect";
import type { CaptureTilt, PolygonData, ReferenceData } from "@/lib/types";
import {
  calculatePolygonMeasurement,
} from "@/lib/measure";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Photo {
  id: string;
  image_url: string;
  storage_path: string;
  wall_label: string;
  wall_area_m2: number | null;
  sort_order: number;
  reference_data: ReferenceData | null;
  polygon_data: PolygonData | null;
  tilt_data: CaptureTilt | null;
}

interface Quote {
  id: string;
  created_at: string;
  status: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  wall_area_m2: number | null;
  notes: string | null;
  facade_quote_photos: Photo[];
}

// ── Per-photo measurement state ───────────────────────────────────────────────

interface PhotoMeasureState {
  imageWidth: number;
  imageHeight: number;
  mlsdUrl: string | null;
  mlsdLoading: boolean;
  reference: ReferenceData | null;
  polygon: PolygonData | null;
  area: number | null;
  saving: boolean;
  savedArea: number | null; // last value persisted to DB
}

function initialPhotoState(): PhotoMeasureState {
  return {
    imageWidth: 0,
    imageHeight: 0,
    mlsdUrl: null,
    mlsdLoading: false,
    reference: null,
    polygon: null,
    area: null,
    saving: false,
    savedArea: null,
  };
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminQuotePage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const adminKey = searchParams.get("key") ?? "";
  const quoteId = params.id;

  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [tab, setTab] = useState<"reference" | "polygon">("reference");
  const [measureStates, setMeasureStates] = useState<
    Record<string, PhotoMeasureState>
  >({});
  const [markingDone, setMarkingDone] = useState(false);

  // Load quote
  useEffect(() => {
    if (!quoteId) return;
    setLoading(true);
    fetch(`/api/admin/quote/${quoteId}`, {
      headers: { "x-admin-key": adminKey },
    })
      .then((r) => r.json())
      .then((data: { quote: Quote }) => {
        setQuote(data.quote);
        // Pre-populate measure states from saved DB data
        const states: Record<string, PhotoMeasureState> = {};
        for (const p of data.quote.facade_quote_photos ?? []) {
          states[p.id] = {
            ...initialPhotoState(),
            reference: p.reference_data ?? null,
            polygon: p.polygon_data ?? null,
            savedArea: p.wall_area_m2,
            area: p.wall_area_m2,
          };
        }
        setMeasureStates(states);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [quoteId, adminKey]);

  const photos = quote?.facade_quote_photos ?? [];
  const activePhoto = photos[selectedIdx] ?? null;
  const activeState = activePhoto
    ? (measureStates[activePhoto.id] ?? initialPhotoState())
    : null;

  // Update measure state for the active photo
  const updateState = useCallback(
    (photoId: string, patch: Partial<PhotoMeasureState>) => {
      setMeasureStates((prev) => ({
        ...prev,
        [photoId]: { ...(prev[photoId] ?? initialPhotoState()), ...patch },
      }));
    },
    [],
  );

  // Load image dimensions when photo changes
  const loadedImgRef = useRef<Record<string, boolean>>({});
  useEffect(() => {
    if (!activePhoto || loadedImgRef.current[activePhoto.id]) return;
    loadedImgRef.current[activePhoto.id] = true;
    const img = new Image();
    img.onload = () => {
      updateState(activePhoto.id, {
        imageWidth: img.naturalWidth,
        imageHeight: img.naturalHeight,
      });
    };
    img.src = activePhoto.image_url;
  }, [activePhoto, updateState]);

  // Run MLSD for the active photo
  const runMlsd = useCallback(async () => {
    if (!activePhoto) return;
    updateState(activePhoto.id, { mlsdLoading: true });
    try {
      const r = await fetch("/api/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: activePhoto.image_url }),
      });
      if (r.ok) {
        const { url } = (await r.json()) as { url: string };
        updateState(activePhoto.id, { mlsdUrl: url, mlsdLoading: false });
      } else {
        updateState(activePhoto.id, { mlsdLoading: false });
      }
    } catch {
      updateState(activePhoto.id, { mlsdLoading: false });
    }
  }, [activePhoto, updateState]);

  // Reference set callback
  const handleReferenceSet = useCallback(
    (ref: ReferenceData) => {
      if (!activePhoto) return;
      updateState(activePhoto.id, { reference: ref, polygon: null, area: null });
    },
    [activePhoto, updateState],
  );

  // Polygon set callback — also calculates area
  const handlePolygonSet = useCallback(
    async (poly: PolygonData) => {
      if (!activePhoto || !activeState?.reference) return;
      updateState(activePhoto.id, { polygon: poly });
      try {
        // Use tilt captured by the customer's phone for keystone correction.
        const tilt = activePhoto.tilt_data ?? null;
        const result = await calculatePolygonMeasurement(
          poly.points,
          [],
          activeState.imageWidth,
          activeState.imageHeight,
          activeState.reference,
          {
            useKeystoneCorrection: tilt !== null,
            sensorTiltBetaDeg: tilt?.beta ?? null,
          },
        );
        updateState(activePhoto.id, { area: result.wallAreaM2 });
      } catch (err) {
        console.error("Area calculation failed", err);
      }
    },
    [activePhoto, activeState, updateState],
  );

  // Save measurements for active photo
  const savePhoto = useCallback(async () => {
    if (!activePhoto || !activeState?.area) return;
    updateState(activePhoto.id, { saving: true });
    try {
      const res = await fetch(`/api/admin/photo/${activePhoto.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-admin-key": adminKey,
        },
        body: JSON.stringify({
          wall_area_m2: activeState.area,
          reference_data: activeState.reference,
          polygon_data: activeState.polygon,
        }),
      });
      if (res.ok) {
        updateState(activePhoto.id, {
          savedArea: activeState.area,
          saving: false,
        });
        // Update local quote data
        setQuote((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            facade_quote_photos: prev.facade_quote_photos.map((p) =>
              p.id === activePhoto.id
                ? { ...p, wall_area_m2: activeState.area }
                : p,
            ),
          };
        });
      } else {
        updateState(activePhoto.id, { saving: false });
      }
    } catch {
      updateState(activePhoto.id, { saving: false });
    }
  }, [activePhoto, activeState, adminKey, updateState]);

  // Mark quote as completed with total area
  const markDone = useCallback(async () => {
    if (!quote) return;
    const savedPhotos = photos.filter(
      (p) => measureStates[p.id]?.savedArea != null,
    );
    if (savedPhotos.length === 0) return;
    const totalM2 = savedPhotos.reduce(
      (sum, p) => sum + (measureStates[p.id]?.savedArea ?? 0),
      0,
    );
    setMarkingDone(true);
    await fetch(`/api/admin/quote/${quote.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": adminKey,
      },
      body: JSON.stringify({ status: "completed", wall_area_m2: totalM2 }),
    });
    setQuote((prev) =>
      prev ? { ...prev, status: "completed", wall_area_m2: totalM2 } : prev,
    );
    setMarkingDone(false);
  }, [quote, photos, measureStates, adminKey]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-slate-400" />
      </div>
    );
  }

  if (!quote) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Pyyntöä ei löydy.
      </div>
    );
  }

  const date = new Date(quote.created_at).toLocaleDateString("fi-FI", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const allSaved = photos.every((p) => measureStates[p.id]?.savedArea != null);
  const totalSaved = photos.reduce(
    (sum, p) => sum + (measureStates[p.id]?.savedArea ?? 0),
    0,
  );

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3 flex items-start gap-3 sticky top-0 z-20">
        <Link
          href={`/admin?key=${adminKey}`}
          className="p-1.5 rounded-lg hover:bg-slate-100 mt-0.5"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 truncate">
            {quote.customer_name ?? "Nimetön asiakas"}
          </p>
          <p className="text-xs text-slate-500">
            {quote.customer_phone ?? ""} · {date}
          </p>
        </div>
        {quote.status === "completed" ? (
          <span className="flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2 py-1 rounded-full">
            <CheckCircle2 className="w-3.5 h-3.5" /> Valmis
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs font-semibold text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
            <Clock className="w-3.5 h-3.5" /> Odottaa
          </span>
        )}
      </header>

      <div className="flex flex-col lg:flex-row flex-1 min-h-0">
        {/* Left: photo list */}
        <aside className="lg:w-56 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex lg:flex-col overflow-x-auto lg:overflow-y-auto lg:overflow-x-hidden shrink-0 p-3 gap-2">
          {photos.map((p, idx) => {
            const st = measureStates[p.id];
            const done = st?.savedArea != null;
            const active = idx === selectedIdx;
            return (
              <button
                key={p.id}
                onClick={() => {
                  setSelectedIdx(idx);
                  setTab("reference");
                }}
                className={`relative shrink-0 lg:shrink w-24 lg:w-full aspect-square lg:aspect-video rounded-xl overflow-hidden border-2 transition-all ${
                  active
                    ? "border-blue-500 shadow-md"
                    : "border-transparent hover:border-slate-300"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.image_url}
                  alt={p.wall_label}
                  className="w-full h-full object-cover"
                />
                <div
                  className={`absolute inset-0 ${active ? "bg-blue-900/20" : "bg-black/10"}`}
                />
                <div className="absolute bottom-0 left-0 right-0 px-1.5 py-1 bg-black/50">
                  <p className="text-white text-[10px] font-semibold truncate">
                    {p.wall_label}
                  </p>
                  {done ? (
                    <p className="text-green-400 text-[10px] font-bold">
                      {st.savedArea!.toFixed(2)} m²
                    </p>
                  ) : (
                    <p className="text-amber-300 text-[10px]">Käsittelemättä</p>
                  )}
                </div>
                {done && (
                  <CheckCircle2 className="absolute top-1.5 right-1.5 w-4 h-4 text-green-400 drop-shadow" />
                )}
              </button>
            );
          })}
        </aside>

        {/* Right: measurement interface */}
        <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {activePhoto && activeState ? (
            <>
              {/* Tab bar + MLSD button */}
              <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setTab("reference")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    tab === "reference"
                      ? "bg-blue-600 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  1. Referenssi
                </button>
                <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                <button
                  onClick={() => {
                    if (activeState.reference) setTab("polygon");
                  }}
                  disabled={!activeState.reference}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-40 ${
                    tab === "polygon"
                      ? "bg-blue-600 text-white"
                      : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  2. Polygoni
                </button>

                <div className="flex-1" />

                {/* Tilt badge */}
                {activePhoto.tilt_data && (
                  <span className="text-xs text-cyan-700 bg-cyan-50 border border-cyan-200 px-2 py-1 rounded-lg font-mono">
                    β {activePhoto.tilt_data.beta.toFixed(1)}° — keystonekorjaus käytössä
                  </span>
                )}

                {/* MLSD button */}
                <button
                  onClick={() => void runMlsd()}
                  disabled={activeState.mlsdLoading || !!activeState.mlsdUrl}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700 text-xs font-semibold hover:bg-slate-200 disabled:opacity-50 transition-colors"
                >
                  {activeState.mlsdLoading ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : activeState.mlsdUrl ? (
                    <Check className="w-3.5 h-3.5 text-green-600" />
                  ) : (
                    <ScanLine className="w-3.5 h-3.5" />
                  )}
                  {activeState.mlsdUrl
                    ? "Reunat tunnistettu"
                    : activeState.mlsdLoading
                      ? "Tunnistetaan…"
                      : "Tunnista reunat"}
                </button>
              </div>

              {/* Tool area */}
              <div className="flex-1 min-h-0 p-2">
                {tab === "reference" ? (
                  activeState.imageWidth > 0 ? (
                    <ReferenceMeasure
                      imageDataUrl={activePhoto.image_url}
                      imageWidth={activeState.imageWidth}
                      imageHeight={activeState.imageHeight}
                      mlsdMapUrl={activeState.mlsdUrl ?? undefined}
                      onReferenceSet={handleReferenceSet}
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                    </div>
                  )
                ) : activeState.imageWidth > 0 ? (
                  <PolygonSelect
                    imageUrl={activePhoto.image_url}
                    imageWidth={activeState.imageWidth}
                    imageHeight={activeState.imageHeight}
                    reference={activeState.reference ?? undefined}
                    mlsdMapUrl={activeState.mlsdUrl ?? undefined}
                    onPolygonSet={(p) => void handlePolygonSet(p)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
                  </div>
                )}
              </div>

              {/* Save bar */}
              <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-3 shrink-0">
                {activeState.area != null ? (
                  <div className="flex-1">
                    <p className="text-xs text-slate-500">Laskettu pinta-ala</p>
                    <p className="text-xl font-extrabold text-slate-900">
                      {activeState.area.toFixed(2)}{" "}
                      <span className="text-sm font-semibold text-slate-400">m²</span>
                    </p>
                  </div>
                ) : (
                  <p className="flex-1 text-xs text-slate-400">
                    {tab === "reference"
                      ? "Aseta referenssimitta ensin"
                      : "Piirrä polygoni laskeaksesi pinta-alan"}
                  </p>
                )}

                {activeState.savedArea != null && (
                  <span className="text-xs text-green-600 font-medium flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" /> Tallennettu
                  </span>
                )}

                <button
                  onClick={() => void savePhoto()}
                  disabled={!activeState.area || activeState.saving}
                  className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-blue-600 disabled:bg-slate-300 text-white font-bold text-sm"
                >
                  {activeState.saving ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Save className="w-4 h-4" />
                  )}
                  Tallenna
                </button>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
              Valitse kuva vasemmalta
            </div>
          )}
        </main>
      </div>

      {/* Bottom summary bar */}
      <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center gap-4 shrink-0">
        <div className="flex-1">
          <p className="text-xs text-slate-500">
            Käsitelty {photos.filter((p) => measureStates[p.id]?.savedArea != null).length}/
            {photos.length} seinää
          </p>
          {totalSaved > 0 && (
            <p className="text-lg font-extrabold text-slate-900">
              {totalSaved.toFixed(2)} m² yhteensä
            </p>
          )}
        </div>

        {quote.status !== "completed" && (
          <button
            disabled={!allSaved || markingDone}
            onClick={() => void markDone()}
            className="flex items-center gap-2 px-5 py-3 rounded-xl bg-green-600 disabled:bg-slate-300 text-white font-bold text-sm"
          >
            {markingDone ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            Merkitse valmiiksi
          </button>
        )}

        {quote.status === "completed" && quote.wall_area_m2 != null && (
          <div className="text-right">
            <p className="text-xs text-green-600 font-semibold">Valmis</p>
            <p className="text-lg font-extrabold text-green-700">
              {Number(quote.wall_area_m2).toFixed(1)} m²
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
