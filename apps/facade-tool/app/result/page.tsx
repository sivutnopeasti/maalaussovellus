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
import PolygonSelect from "@/components/PolygonSelect";
import ClickSegment from "@/components/ClickSegment";
import VanishingPointLine, { type VanishingPoint } from "@/components/VanishingPointLine";
import ColorPicker from "@/components/ColorPicker";
import QuoteForm from "@/components/QuoteForm";
import {
  enrichMasksWithPixelCounts,
  calculatePreciseMeasurement,
  calculatePolygonMeasurement,
  type PreciseMeasurementResult,
} from "@/lib/measure";
import { autoClassifyMasks } from "@/lib/autoClassify";
import type { AnalysisSession, MaskResult, PaintColor, PolygonData } from "@/lib/types";

type Panel = "polygon" | "segment" | "measure" | "color" | "quote";

export default function ResultPage() {
  const router = useRouter();
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [masks, setMasks] = useState<MaskResult[]>([]);
  const [isAutoClassifying, setIsAutoClassifying] = useState(false);
  const [measurement, setMeasurement] = useState<PreciseMeasurementResult | null>(null);
  const [polygon, setPolygon] = useState<PolygonData | null>(
    // Restore polygon if session already had one (shouldn't happen anymore, but safe)
    null,
  );
  const [vanishingPoint, setVanishingPoint] = useState<VanishingPoint | null>(null);
  const [showVpPanel, setShowVpPanel] = useState(false);
  const [showAnalysisMaps, setShowAnalysisMaps] = useState(false);
  const [selectedColor, setSelectedColor] = useState<PaintColor | null>(null);
  const [customHex, setCustomHex] = useState<string>("#FFFFFF");
  const [visualizedUrl, setVisualizedUrl] = useState<string | null>(null);
  const [openPanel, setOpenPanel] = useState<Panel>("polygon");
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isVisualizing, setIsVisualizing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load session and run auto-classification on mount
  useEffect(() => {
    const raw = sessionStorage.getItem("facadeSession");
    if (!raw) {
      router.replace("/");
      return;
    }
    const s: AnalysisSession = JSON.parse(raw);
    setSession(s);
    setMasks(s.masks);

    // Auto-classify masks using all available signals
    setIsAutoClassifying(true);
    autoClassifyMasks({
      masks: s.masks,
      imageWidth: s.imageWidth,
      imageHeight: s.imageHeight,
      wallHints: s.wallHints ?? [],
      openingHints: s.openingHints ?? [],
      ignoreHints: s.ignoreHints ?? [],
      depthMapUrl: s.depthMapUrl,
      imageUrl: s.uploadedImageUrl,
    })
      .then((classified) => setMasks(classified))
      .catch((e) => console.warn("Auto-classify error:", e))
      .finally(() => setIsAutoClassifying(false));
  }, [router]);

  const handleMasksUpdated = useCallback((updated: MaskResult[]) => {
    setMasks(updated);
  }, []);

  const handleMaskAdded = useCallback((newMask: MaskResult) => {
    setMasks((prev) => [...prev, newMask]);
  }, []);

  const handleCalculate = async () => {
    if (!session) return;
    setIsMeasuring(true);
    setError(null);
    try {
      const activePolygon = polygon ?? session.polygon;
      if (activePolygon && activePolygon.points.length >= 3) {
        // Polygon-based calculation: depth-weighted pixel integration minus openings
        const result = await calculatePolygonMeasurement(
          activePolygon.points,
          masks,
          session.imageWidth,
          session.imageHeight,
          session.reference,
          session.depthMapUrl,    // vertical perspective (camera tilt)
          session.mlsdMapUrl,     // roll separation (phone tilt)
        );
        setMeasurement(result);
      } else {
        // Fallback: mask-based calculation
        const enriched = await enrichMasksWithPixelCounts(masks);
        setMasks(enriched);
        const result = await calculatePreciseMeasurement(
          enriched,
          session.reference,
          session.depthMapUrl,
          session.mlsdMapUrl ?? null,
          vanishingPoint,
        );
        setMeasurement(result);
      }
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
  // Can calculate if we have a polygon (preferred) OR wall masks (fallback)
  const activePolygon = polygon ?? session?.polygon;
  const hasPolygon = !!(activePolygon && activePolygon.points.length >= 3);
  const canCalculate = hasPolygon || wallCount > 0;

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
            {/* Left — original image + visualization + analysis maps */}
            <div className="lg:col-span-3 space-y-4">
              {/* Segmentation overlay — always visible as main view */}
              {!visualizedUrl && (
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">
                      {isAutoClassifying ? "Analysoidaan..." : "Tunnistetut alueet"}
                    </span>
                    <span className="text-xs text-slate-400">
                      {session.imageWidth} × {session.imageHeight} px
                    </span>
                  </div>
                  <div className="p-2">
                    <SegmentationOverlay
                      masks={masks}
                      originalImageUrl={session.uploadedImageUrl}
                      imageWidth={session.imageWidth}
                      imageHeight={session.imageHeight}
                      isAutoClassifying={isAutoClassifying}
                      onMasksUpdated={handleMasksUpdated}
                      polygonPoints={activePolygon?.points}
                      canvasOnly
                    />
                  </div>
                </div>
              )}

              {/* Analysis maps — depth + canny side by side */}
              {(session.depthMapUrl || session.cannyMapUrl || session.mlsdMapUrl) && (
                <div className="bg-white rounded-2xl border border-indigo-200 overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-indigo-100">
                    <span className="text-sm font-medium text-indigo-700">Analyysikartat</span>
                    <span className="text-xs text-indigo-400 ml-2">käytetään pinta-alan laskennassa</span>
                  </div>
                  <div className="grid grid-cols-3 gap-0 divide-x divide-slate-100">
                    {session.depthMapUrl && (
                      <div className="p-2 space-y-1">
                        <p className="text-xs text-center font-medium text-slate-600">Syvyyskartta</p>
                        <p className="text-xs text-center text-slate-400">kirkas = lähellä</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={session.depthMapUrl} alt="Syvyyskartta" className="w-full rounded" />
                      </div>
                    )}
                    {session.mlsdMapUrl && (
                      <div className="p-2 space-y-1">
                        <p className="text-xs text-center font-medium text-slate-600">MLSD-viivat</p>
                        <p className="text-xs text-center text-slate-400">suorat rakenteet</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={session.mlsdMapUrl} alt="MLSD-viivakartta" className="w-full rounded" />
                      </div>
                    )}
                    {session.cannyMapUrl && (
                      <div className="p-2 space-y-1">
                        <p className="text-xs text-center font-medium text-slate-600">Canny-reunat</p>
                        <p className="text-xs text-center text-slate-400">kaikki reunat</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={session.cannyMapUrl} alt="Canny-reunakartta" className="w-full rounded" />
                      </div>
                    )}
                  </div>
                </div>
              )}

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

              {/* Panel 0 — Polygon facade outline */}
              <AccordionPanel
                icon={<HexagonIcon />}
                title="1. Rajaa julkisivu"
                subtitle={
                  hasPolygon
                    ? `${activePolygon!.points.length} pistettä — ${
                        session.wallMaskUrl ? "automaattisesti tunnistettu" : "manuaalisesti piirretty"
                      }`
                    : session.wallMaskUrl
                      ? "Tekoäly tunnistaa rajat automaattisesti"
                      : "Klikkaa talon nurkat"
                }
                isOpen={openPanel === "polygon"}
                isDone={hasPolygon}
                onToggle={() => setOpenPanel(openPanel === "polygon" ? "segment" : "polygon")}
              >
                <p className="text-xs text-slate-500 mb-3">
                  Tekoäly on tunnistanut seinän rajat automaattisesti. Tarkista ja hyväksy,
                  tai säädä pisteitä tarvittaessa.
                </p>
                <PolygonSelect
                  imageUrl={session.uploadedImageUrl}
                  imageWidth={session.imageWidth}
                  imageHeight={session.imageHeight}
                  onPolygonSet={(data) => {
                    setPolygon(data);
                    setOpenPanel("segment");
                  }}
                  autoDetectMaskUrl={session.wallMaskUrl}
                />
                {hasPolygon && (
                  <button
                    onClick={() => setOpenPanel("segment")}
                    className="w-full mt-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Jatka →
                  </button>
                )}
              </AccordionPanel>

              {/* Panel 2 — Segmentation */}
              <AccordionPanel
                icon={<Layers />}
                title="2. Tarkista aukot"
                subtitle={
                  isAutoClassifying
                    ? "Tekoäly luokittelee automaattisesti..."
                    : canCalculate
                      ? `${wallCount} seinää, ${openingCount} aukkoa — tarkista ja korjaa tarvittaessa`
                      : "Merkitse seinät ja aukot"
                }
                isOpen={openPanel === "segment"}
                isDone={canCalculate && !isAutoClassifying}
                onToggle={() =>
                  setOpenPanel(openPanel === "segment" ? "measure" : "segment")
                }
              >
                {isAutoClassifying && (
                  <div className="flex items-center gap-2 p-3 bg-blue-50 rounded-xl text-sm text-blue-700 mb-3">
                    <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                    <span>Analysoidaan automaattisesti: SAM 3 semantiikka + syvyys + väri + sijainti...</span>
                  </div>
                )}
                {/* Mask list for manual correction (canvas shown in left column) */}
                <SegmentationOverlay
                  masks={masks}
                  originalImageUrl={session.uploadedImageUrl}
                  imageWidth={session.imageWidth}
                  imageHeight={session.imageHeight}
                  isAutoClassifying={isAutoClassifying}
                  onMasksUpdated={handleMasksUpdated}
                  listOnly
                />

                {/* Click-to-segment — add walls/openings by clicking */}
                <div className="mt-3 pt-3 border-t border-slate-100">
                  <p className="text-xs font-medium text-slate-600 mb-2">
                    Lisää alueita klikkaamalla
                  </p>
                  <ClickSegment
                    imageUrl={session.uploadedImageUrl}
                    imageWidth={session.imageWidth}
                    imageHeight={session.imageHeight}
                    onMaskAdded={handleMaskAdded}
                  />
                </div>

                {canCalculate && (
                  <button
                    onClick={() => setOpenPanel("measure")}
                    className="w-full mt-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Jatka laskentaan
                  </button>
                )}
              </AccordionPanel>

              {/* Panel 3 — Measure */}
              <AccordionPanel
                icon={<Calculator />}
                title="3. Laske neliömetrit"
                  subtitle={
                    measurement
                      ? `${measurement.wallAreaM2.toFixed(1)} m² — ${
                          measurement.method === "depth+perspective"
                            ? hasPolygon ? "monikulmio + perspektiivikorjaus" : "syvyys + perspektiivikorjaus"
                            : measurement.method === "depth"
                              ? "syvyyskorjattu"
                              : "peruslaskenta"
                        }`
                      : hasPolygon ? "Monikulmio + perspektiivikorjaus" : "Syvyys + perspektiivikorjaus"
                  }
                isOpen={openPanel === "measure"}
                isDone={!!measurement}
                onToggle={() =>
                  setOpenPanel(openPanel === "measure" ? "segment" : "measure")
                }
              >
                <div className="space-y-3">
                  {/* Polygon info */}
                  {hasPolygon && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>Monikulmio-mittaus:</strong>{" "}
                        {activePolygon!.points.length} pistettä — tarkin menetelmä.
                        Ikkunat ja ovet vähennetään automaattisesti.
                      </span>
                    </div>
                  )}

                  {/* Reference info */}
                  <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600 space-y-1">
                    <p>
                      <strong>Referenssi:</strong> {session.reference.meters} m
                      = {session.reference.pixelDistance.toFixed(0)} px (
                      {session.reference.pixelsPerMeter.toFixed(1)} px/m)
                    </p>
                    <div className="flex gap-2 mt-1 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        session.depthMapUrl ? "bg-blue-100 text-blue-700" : "bg-slate-200 text-slate-500"
                      }`}>
                        Syvyyskartta {session.depthMapUrl ? "✓" : "✗"}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        session.mlsdMapUrl ? "bg-indigo-100 text-indigo-700" : "bg-slate-200 text-slate-500"
                      }`}>
                        MLSD-viivat {session.mlsdMapUrl ? "✓" : "✗"}
                      </span>
                      <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                        session.cannyMapUrl ? "bg-violet-100 text-violet-700" : "bg-slate-200 text-slate-500"
                      }`}>
                        Canny-reunat {session.cannyMapUrl ? "✓" : "✗"}
                      </span>
                    </div>
                  </div>

                  {/* Vanishing point — perspective correction */}
                  <div className="border border-amber-200 rounded-xl overflow-hidden">
                    <button
                      onClick={() => setShowVpPanel((v) => !v)}
                      className="w-full flex items-center justify-between px-3 py-2 bg-amber-50 hover:bg-amber-100 transition-colors text-xs font-medium text-amber-800"
                    >
                      <span className="flex items-center gap-1.5">
                        <span>Perspektiivikorjaus (valinnainen)</span>
                        {vanishingPoint && !vanishingPoint.atInfinity && (
                          <span className="px-1.5 py-0.5 bg-amber-200 text-amber-800 rounded text-xs">✓ asetettu</span>
                        )}
                      </span>
                      {showVpPanel ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                    </button>
                    {showVpPanel && (
                      <div className="p-3">
                        <p className="text-xs text-slate-500 mb-2">
                          Piirrä toinen vaakalinja rakennuksessa (ikkunalauta, lauta, räystäs).
                          Järjestelmä laskee katoavan pisteen perspektiivikorjaukseksi.
                          Toimii myös harjakattoisissa taloissa.
                        </p>
                        <VanishingPointLine
                          imageUrl={session.uploadedImageUrl}
                          imageWidth={session.imageWidth}
                          imageHeight={session.imageHeight}
                          reference={session.reference}
                          onVanishingPointSet={setVanishingPoint}
                        />
                      </div>
                    )}
                  </div>

                  {/* Analysis maps (depth/MLSD/Canny) */}
                  {(session.depthMapUrl || session.mlsdMapUrl || session.cannyMapUrl) && (
                    <button
                      onClick={() => setShowAnalysisMaps((v) => !v)}
                      className="w-full text-xs text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1 py-1"
                    >
                      {showAnalysisMaps ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      {showAnalysisMaps ? "Piilota" : "Näytä"} analyysikartat
                    </button>
                  )}

                  {showAnalysisMaps && (
                    <div className="grid grid-cols-3 gap-1.5">
                      {session.depthMapUrl && (
                        <div className="space-y-0.5">
                          <p className="text-xs text-center text-slate-500">Syvyys</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={session.depthMapUrl}
                            alt="Syvyyskartta"
                            className="w-full rounded-lg border border-slate-200"
                          />
                        </div>
                      )}
                      {session.mlsdMapUrl && (
                        <div className="space-y-0.5">
                          <p className="text-xs text-center text-slate-500">MLSD-viivat</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={session.mlsdMapUrl}
                            alt="MLSD-viivakartta"
                            className="w-full rounded-lg border border-slate-200"
                          />
                        </div>
                      )}
                      {session.cannyMapUrl && (
                        <div className="space-y-0.5">
                          <p className="text-xs text-center text-slate-500">Canny-reunat</p>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={session.cannyMapUrl}
                            alt="Canny-reunakartta"
                            className="w-full rounded-lg border border-slate-200"
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Result */}
                  {measurement && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl space-y-1 text-sm">
                      <div className="flex justify-between text-green-700">
                        <span>Seinäalueet</span>
                        <span>{(measurement.wallPixels / 1000).toFixed(0)} kpx</span>
                      </div>
                      <div className="flex justify-between text-red-600">
                        <span>Aukot (vähennetty)</span>
                        <span>−{(measurement.openingPixels / 1000).toFixed(0)} kpx</span>
                      </div>
                      <div className="flex justify-between font-bold text-green-800 border-t border-green-200 pt-1">
                        <span>Nettoseinäala</span>
                        <span>{measurement.wallAreaM2.toFixed(2)} m²</span>
                      </div>
                      <div className="border-t border-green-200 pt-1 space-y-0.5 text-xs text-slate-500">
                        <div className="flex justify-between">
                          <span>Syvyyskorjaus (pystysuunta)</span>
                          <span>{measurement.depthCorrectionFactor.toFixed(3)}×</span>
                        </div>
                        {measurement.vanishingPointCorrectionFactor !== 1 && (
                          <div className="flex justify-between text-amber-600">
                            <span>Katoavapiste-korjaus</span>
                            <span>{measurement.vanishingPointCorrectionFactor.toFixed(3)}×</span>
                          </div>
                        )}
                        {measurement.perspectiveCorrectionFactor !== 1 && (
                          <div className="flex justify-between">
                            <span>MLSD-korjaus</span>
                            <span>{measurement.perspectiveCorrectionFactor.toFixed(3)}×
                              {measurement.dominantLineAngleDeg !== null && (
                                <span className="text-slate-400"> ({measurement.dominantLineAngleDeg.toFixed(1)}°)</span>
                              )}
                            </span>
                          </div>
                        )}
                        <div className="flex justify-between font-medium text-slate-600">
                          <span>Menetelmä</span>
                          <span>{measurement.method}</span>
                        </div>
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
                    {isMeasuring ? "Lasketaan (syvyys + viivat)..." : "Laske neliömetrit"}
                  </button>
                </div>
              </AccordionPanel>

              {/* Panel 4 — Visualize */}
              <AccordionPanel
                icon={<Palette />}
                title="4. Visualisoi väri"
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

              {/* Panel 5 — Quote */}
              <AccordionPanel
                icon={<Euro />}
                title="5. Tarjouslaskelma"
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

function HexagonIcon() {
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
      <polygon points="12 2 20 7 20 17 12 22 4 17 4 7" />
    </svg>
  );
}

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
