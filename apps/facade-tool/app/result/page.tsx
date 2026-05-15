"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calculator,
  Palette,
  Wand2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import SegmentationOverlay from "@/components/SegmentationOverlay";
import ColorPicker from "@/components/ColorPicker";
import QuoteForm from "@/components/QuoteForm";
import {
  enrichMasksWithPixelCounts,
  calculateWallArea,
  depthCorrectedArea,
} from "@/lib/measure";
import type {
  AnalysisSession,
  MaskResult,
  PaintColor,
  MeasurementResult,
} from "@/lib/types";

type Panel = "segment" | "measure" | "color" | "quote";

export default function ResultPage() {
  const router = useRouter();
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [masks, setMasks] = useState<MaskResult[]>([]);
  const [measurement, setMeasurement] = useState<MeasurementResult | null>(null);
  const [selectedColor, setSelectedColor] = useState<PaintColor | null>(null);
  const [customHex, setCustomHex] = useState<string>("#FFFFFF");
  const [visualizedUrl, setVisualizedUrl] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<Panel>("segment");
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isVisualizing, setIsVisualizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load session from sessionStorage on mount
  useEffect(() => {
    const raw = sessionStorage.getItem("facadeSession");
    if (!raw) {
      router.replace("/");
      return;
    }
    const s: AnalysisSession = JSON.parse(raw);
    setSession(s);
    setMasks(s.masks);
  }, [router]);

  const handleMasksUpdated = useCallback((updated: MaskResult[]) => {
    setMasks(updated);
  }, []);

  const handleCalculate = async () => {
    if (!session) return;
    setIsMeasuring(true);
    setError(null);
    try {
      // Enrich masks with pixel counts (browser-side canvas)
      const enriched = await enrichMasksWithPixelCounts(masks);
      setMasks(enriched);

      const rawResult = calculateWallArea(enriched, session.reference);

      // Try depth correction; fall back to raw if it fails
      let finalM2 = rawResult.wallAreaM2;
      const wallMasks = enriched.filter((m) => m.category === "wall");
      if (wallMasks.length > 0 && session.depthMapUrl) {
        try {
          // Use the first wall mask URL for depth sampling
          finalM2 = await depthCorrectedArea(
            rawResult.wallAreaM2,
            session.depthMapUrl,
            session.reference,
            wallMasks[0].url,
          );
        } catch {
          // Depth correction is optional; ignore errors
        }
      }

      setMeasurement({ ...rawResult, wallAreaM2: finalM2 });
      setOpenPanel("color");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laskenta epäonnistui.");
    } finally {
      setIsMeasuring(false);
    }
  };

  const handleVisualize = async () => {
    if (!session || !selectedColor) return;
    setIsVisualizing(true);
    setError(null);
    try {
      const res = await fetch("/api/visualize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageUrl: session.uploadedImageUrl,
          colorName: selectedColor.name,
          colorHex: selectedColor.hex,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "Visualisointi epäonnistui.");
      }
      const { visualizedUrl: url } = await res.json();
      setVisualizedUrl(url);
      setOpenPanel("quote");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Visualisointi epäonnistui.");
    } finally {
      setIsVisualizing(false);
    }
  };

  const handleSaveQuote = async (data: {
    unitPrice: number;
    fixedCosts: number;
    totalPrice: number;
    notes: string;
    projectId: string;
  }) => {
    if (!measurement || !session) return;
    setIsSaving(true);
    try {
      const res = await fetch("/api/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: data.projectId || null,
          imageUrl: session.uploadedImageUrl,
          visualizedUrl: visualizedUrl ?? null,
          wallAreaM2: measurement.wallAreaM2,
          unitPrice: data.unitPrice,
          fixedCosts: data.fixedCosts,
          notes: data.notes,
        }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error ?? "Tallentaminen epäonnistui.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Tallentaminen epäonnistui.");
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
      </div>
    );
  }

  const wallCount = masks.filter((m) => m.category === "wall").length;
  const openingCount = masks.filter((m) => m.category === "opening").length;
  const canCalculate = wallCount > 0;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-slate-600" />
          </button>
          <div className="flex-1">
            <h1 className="font-bold text-slate-900">Analyysitulokset</h1>
            <p className="text-xs text-slate-500">
              {session.masks.length} aluetta tunnistettu
            </p>
          </div>
          {measurement && (
            <div className="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <span className="font-bold text-blue-700">
                {measurement.wallAreaM2.toFixed(1)} m²
              </span>
              <span className="text-blue-500 ml-1">nettoseinäala</span>
            </div>
          )}
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 px-4 py-6">
        <div className="max-w-5xl mx-auto">
          {error && (
            <div className="mb-4 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Virhe</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* Left — original + visualized images */}
            <div className="lg:col-span-3 space-y-4">
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">
                    Alkuperäinen kuva
                  </span>
                  <span className="text-xs text-slate-400">
                    {session.imageWidth} × {session.imageHeight} px
                  </span>
                </div>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={session.imageDataUrl}
                  alt="Alkuperäinen julkisivu"
                  className="w-full"
                />
              </div>

              {visualizedUrl && (
                <div className="bg-white rounded-2xl border border-blue-200 overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-blue-100 flex items-center gap-2">
                    <div
                      className="w-4 h-4 rounded-full border border-slate-300"
                      style={{
                        backgroundColor: selectedColor?.hex ?? "#FFFFFF",
                      }}
                    />
                    <span className="text-sm font-medium text-blue-700">
                      Visualisointi — {selectedColor?.name}
                    </span>
                  </div>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={visualizedUrl}
                    alt="Värivisualisointi"
                    className="w-full"
                  />
                </div>
              )}
            </div>

            {/* Right — accordion panels */}
            <div className="lg:col-span-2 space-y-3">
              {/* Panel 1 — Segmentation */}
              <AccordionPanel
                icon={<Layers />}
                title="1. Luokittele alueet"
                subtitle={
                  canCalculate
                    ? `${wallCount} seinä, ${openingCount} aukkoa`
                    : "Merkitse seinät ja aukot"
                }
                isOpen={openPanel === "segment"}
                isDone={canCalculate}
                onToggle={() =>
                  setOpenPanel(openPanel === "segment" ? "measure" : "segment")
                }
              >
                <SegmentationOverlay
                  masks={masks}
                  originalImageUrl={session.imageDataUrl}
                  imageWidth={session.imageWidth}
                  imageHeight={session.imageHeight}
                  onMasksUpdated={handleMasksUpdated}
                />
                {canCalculate && (
                  <button
                    onClick={() => setOpenPanel("measure")}
                    className="w-full mt-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Jatka laskentaan
                  </button>
                )}
              </AccordionPanel>

              {/* Panel 2 — Measure */}
              <AccordionPanel
                icon={<Calculator />}
                title="2. Laske neliömetrit"
                subtitle={
                  measurement
                    ? `${measurement.wallAreaM2.toFixed(1)} m² (netto)`
                    : "Perspektiivikorjattu laskenta"
                }
                isOpen={openPanel === "measure"}
                isDone={!!measurement}
                onToggle={() =>
                  setOpenPanel(openPanel === "measure" ? "segment" : "measure")
                }
              >
                <div className="space-y-3">
                  <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 space-y-1">
                    <p>
                      <strong>Referenssi:</strong> {session.reference.meters} m
                      = {session.reference.pixelDistance.toFixed(0)} px (
                      {session.reference.pixelsPerMeter.toFixed(1)} px/m)
                    </p>
                    <p>
                      Syvyyskartta syvyyden perspektiivikorjaukseen
                      saatavilla.
                    </p>
                  </div>

                  {measurement && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl space-y-1 text-sm">
                      <div className="flex justify-between text-green-700">
                        <span>Seinäpikselit</span>
                        <span>
                          {(measurement.wallPixels / 1000).toFixed(0)} kpx
                        </span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>Aukot (vähennetty)</span>
                        <span>
                          −{(measurement.openingPixels / 1000).toFixed(0)} kpx
                        </span>
                      </div>
                      <div className="flex justify-between font-bold text-green-800 border-t border-green-200 pt-1">
                        <span>Nettoseinäala</span>
                        <span>{measurement.wallAreaM2.toFixed(2)} m²</span>
                      </div>
                    </div>
                  )}

                  <button
                    onClick={handleCalculate}
                    disabled={!canCalculate || isMeasuring}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isMeasuring ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Calculator className="w-4 h-4" />
                    )}
                    {isMeasuring ? "Lasketaan..." : "Laske neliömetrit"}
                  </button>
                </div>
              </AccordionPanel>

              {/* Panel 3 — Visualize */}
              <AccordionPanel
                icon={<Palette />}
                title="3. Visualisoi väri"
                subtitle={
                  visualizedUrl
                    ? selectedColor?.name ?? "Valmis"
                    : "Valitse väri ja generoi"
                }
                isOpen={openPanel === "color"}
                isDone={!!visualizedUrl}
                onToggle={() =>
                  setOpenPanel(openPanel === "color" ? "measure" : "color")
                }
              >
                <div className="space-y-3">
                  <ColorPicker
                    selected={selectedColor}
                    onSelect={setSelectedColor}
                    customHex={customHex}
                    onCustomHexChange={setCustomHex}
                  />
                  <button
                    onClick={handleVisualize}
                    disabled={!selectedColor || isVisualizing}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-purple-600 text-white rounded-xl text-sm font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isVisualizing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4" />
                    )}
                    {isVisualizing
                      ? "Generoidaan (~30s)..."
                      : "Generoi värivisualisointi"}
                  </button>
                </div>
              </AccordionPanel>

              {/* Panel 4 — Quote */}
              <AccordionPanel
                icon={<Euro />}
                title="4. Tarjouslaskelma"
                subtitle="Laske hinta ja tallenna"
                isOpen={openPanel === "quote"}
                isDone={false}
                onToggle={() =>
                  setOpenPanel(openPanel === "quote" ? "color" : "quote")
                }
              >
                {measurement ? (
                  <QuoteForm
                    wallAreaM2={measurement.wallAreaM2}
                    visualizedImageUrl={visualizedUrl ?? undefined}
                    onSave={handleSaveQuote}
                    isSaving={isSaving}
                  />
                ) : (
                  <p className="text-sm text-slate-500 text-center py-4">
                    Laske ensin neliömetrit (vaihe 2).
                  </p>
                )}
              </AccordionPanel>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// ─── Accordion panel ─────────────────────────────────────────────────────────

function Layers() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  );
}

function Euro() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path d="M4 10h12M4 14h12M19.5 9.5c-1.5-1.5-3-2.5-5-2.5a7 7 0 0 0 0 14c2 0 3.5-1 5-2.5" />
    </svg>
  );
}

interface AccordionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  isOpen: boolean;
  isDone: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function AccordionPanel({
  icon,
  title,
  subtitle,
  isOpen,
  isDone,
  onToggle,
  children,
}: AccordionProps) {
  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm overflow-hidden transition-colors ${
        isOpen ? "border-blue-300" : "border-slate-200"
      }`}
    >
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-slate-50 transition-colors"
      >
        <div
          className={`p-1.5 rounded-lg ${
            isDone
              ? "bg-green-100 text-green-600"
              : isOpen
                ? "bg-blue-100 text-blue-600"
                : "bg-slate-100 text-slate-500"
          }`}
        >
          {isDone ? <CheckCircle2 className="w-4 h-4" /> : icon}
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-xs text-slate-500">{subtitle}</p>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {isOpen && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
