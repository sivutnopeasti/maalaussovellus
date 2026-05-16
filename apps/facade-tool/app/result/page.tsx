"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Calculator,
  Loader2,
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Sparkles,
  Camera,
  Plus,
} from "lucide-react";
import PolygonSelect from "@/components/PolygonSelect";
import QuoteForm from "@/components/QuoteForm";
import {
  calculatePolygonMeasurement,
  type PreciseMeasurementResult,
} from "@/lib/measure";
import type {
  AnalysisSession,
  PolygonData,
  ReferenceData,
} from "@/lib/types";
import {
  estimateWallHeightM,
  findReferenceVerticalEdge,
  storeWallHeight,
  addMeasurement,
  getProject,
  projectTotalM2,
  type FacadeProject,
} from "@/lib/wallHeight";

type Panel = "polygon" | "measure" | "quote";

export default function ResultPage() {
  const router = useRouter();
  const [session, setSession] = useState<AnalysisSession | null>(null);
  const [measurement, setMeasurement] = useState<PreciseMeasurementResult | null>(null);
  const [polygon, setPolygon] = useState<PolygonData | null>(null);
  const [openPanel, setOpenPanel] = useState<Panel>("polygon");
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastStoredWallHeightM, setLastStoredWallHeightM] = useState<
    number | null
  >(null);
  const [project, setProject] = useState<FacadeProject | null>(null);
  // Keystone (vertical) correction uses the vanishing point or sensor tilt — reliable for tilted photos.
  // The customer is instructed to photograph the wall head-on (from the center) so no horizontal
  // perspective correction is applied.
  const [useKeystoneCorrection, setUseKeystoneCorrection] = useState(true);

  useEffect(() => {
    const raw = sessionStorage.getItem("facadeSession");
    if (!raw) {
      router.replace("/");
      return;
    }
    const s: AnalysisSession = JSON.parse(raw);
    setSession(s);
    setProject(getProject());
  }, [router]);

  const handleCalculate = async () => {
    if (!session) return;
    const activePolygon = polygon ?? session.polygon;
    if (!activePolygon || activePolygon.points.length < 3) return;

    setIsMeasuring(true);
    setError(null);
    try {
      // In auto-mode (no manual reference), derive a reference line from the
      // longest near-vertical edge of the polygon and the previously stored
      // wall corner height.
      let activeReference: ReferenceData = session.reference;
      if (
        session.autoWallHeightM &&
        (session.reference.pixelsPerMeter === 0 ||
          session.reference.meters === 0)
      ) {
        const edge = findReferenceVerticalEdge(activePolygon.points);
        if (!edge) {
          throw new Error(
            "Polygonissa ei ole pystysuoria reunoja, joista skaalaus voitaisiin johtaa. Piirrä polygoni uudelleen niin että talon nurkat ovat mukana, tai aseta referenssimitta manuaalisesti.",
          );
        }
        activeReference = {
          point1: edge.p1,
          point2: edge.p2,
          meters: session.autoWallHeightM,
          pixelDistance: edge.pixelLength,
          pixelsPerMeter: edge.pixelLength / session.autoWallHeightM,
          angleDeg: 90,
        };
      }

      const result = await calculatePolygonMeasurement(
        activePolygon.points,
        [],
        session.imageWidth,
        session.imageHeight,
        activeReference,
        {
          mlsdMapUrl: session.mlsdMapUrl,
          useKeystoneCorrection,
          sensorTiltBetaDeg: session.captureTilt?.cameraTiltDeg ?? null,
        },
      );
      setMeasurement(result);
      setOpenPanel("quote");

      // Save the wall corner height (median of polygon's vertical edges) for
      // reuse on subsequent photos of the same house.
      const wallHeightM = estimateWallHeightM(
        activePolygon.points,
        activeReference.pixelsPerMeter,
      );
      if (wallHeightM !== null && wallHeightM > 1 && wallHeightM < 25) {
        storeWallHeight(wallHeightM);
        setLastStoredWallHeightM(wallHeightM);
      }

      // Add this measurement to the running project total
      const updated = addMeasurement(result.wallAreaM2);
      setProject(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Laskenta epäonnistui.");
    } finally {
      setIsMeasuring(false);
    }
  };

  const handleNextWall = () => {
    sessionStorage.removeItem("facadeSession");
    router.push("/?camera=1");
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
          visualizedUrl: null,
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

  const activePolygon = polygon ?? session?.polygon;
  const hasPolygon = !!(activePolygon && activePolygon.points.length >= 3);
  const projectTotal = projectTotalM2(project);
  const wallCount = project?.measurements.length ?? 0;

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
            <h1 className="font-bold text-slate-900">
              Seinä {wallCount > 0 && measurement ? wallCount : wallCount + 1}
            </h1>
            <p className="text-xs text-slate-500">
              {wallCount > 0
                ? `Projektissa ${wallCount} seinää · yht. ${projectTotal.toFixed(1)} m²`
                : "Rajaa julkisivu ja laske neliömetrit"}
            </p>
          </div>
          {measurement && (
            <div className="px-3 py-1.5 bg-blue-50 border border-blue-200 rounded-lg text-sm">
              <span className="font-bold text-blue-700">
                {measurement.wallAreaM2.toFixed(1)} m²
              </span>
              <span className="text-blue-500 ml-1">seinäala</span>
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
            {/* Left — analysis maps */}
            <div className="lg:col-span-3 space-y-4">
              {/* Analysis maps — depth + MLSD */}
              {(session.depthMapUrl || session.mlsdMapUrl) && (
                <div className="bg-white rounded-2xl border border-indigo-200 overflow-hidden shadow-sm">
                  <div className="px-4 py-3 border-b border-indigo-100">
                    <span className="text-sm font-medium text-indigo-700">Analyysikartat</span>
                    <span className="text-xs text-indigo-400 ml-2">käytetään pinta-alan laskennassa</span>
                  </div>
                  <div className={`grid gap-0 divide-x divide-slate-100 ${session.depthMapUrl && session.mlsdMapUrl ? "grid-cols-2" : "grid-cols-1"}`}>
                    {session.depthMapUrl && (
                      <div className="p-3 space-y-1">
                        <p className="text-xs text-center font-medium text-slate-600">Syvyyskartta</p>
                        <p className="text-xs text-center text-slate-400">kirkas = lähellä</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={session.depthMapUrl} alt="Syvyyskartta" className="w-full rounded" />
                      </div>
                    )}
                    {session.mlsdMapUrl && (
                      <div className="p-3 space-y-1">
                        <p className="text-xs text-center font-medium text-slate-600">MLSD-viivat</p>
                        <p className="text-xs text-center text-slate-400">suorat rakenteet</p>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={session.mlsdMapUrl} alt="MLSD-viivakartta" className="w-full rounded" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right — accordion panels */}
            <div className="lg:col-span-2 space-y-3">

              {/* Panel 1 — Polygon facade outline */}
              <AccordionPanel
                icon={<HexagonIcon />}
                title="1. Rajaa julkisivu"
                subtitle={
                  hasPolygon
                    ? `${activePolygon!.points.length} pistettä — manuaalisesti piirretty`
                    : "Klikkaa talon nurkat järjestyksessä"
                }
                isOpen={openPanel === "polygon"}
                isDone={hasPolygon}
                onToggle={() => setOpenPanel(openPanel === "polygon" ? "measure" : "polygon")}
              >
                <p className="text-xs text-slate-500 mb-3">
                  Klikkaa talon kaikki kulmat järjestyksessä (esim. vasemmalta myötäpäivään).
                  Harjakatossa lisää myös harjapisteet. Paina <strong>Valmis</strong> kun kaikki on merkitty.
                </p>
                <PolygonSelect
                  imageUrl={session.uploadedImageUrl}
                  imageWidth={session.imageWidth}
                  imageHeight={session.imageHeight}
                  onPolygonSet={(data) => {
                    setPolygon(data);
                    setOpenPanel("measure");
                  }}
                  reference={session.reference}
                  autoWallHeightM={session.autoWallHeightM}
                />
                {hasPolygon && (
                  <button
                    onClick={() => setOpenPanel("measure")}
                    className="w-full mt-3 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors"
                  >
                    Jatka laskentaan →
                  </button>
                )}
              </AccordionPanel>

              {/* Panel 2 — Measure */}
              <AccordionPanel
                icon={<Calculator />}
                title="2. Laske neliömetrit"
                subtitle={
                  measurement
                    ? `${measurement.wallAreaM2.toFixed(1)} m² — ${
                        measurement.method === "keystone"
                          ? "pystyperspektiivi korjattu"
                          : "ei korjausta tarvittu"
                      }`
                    : hasPolygon ? "Monikulmio + pystyperspektiivin korjaus" : "Piirrä ensin rajaus"
                }
                isOpen={openPanel === "measure"}
                isDone={!!measurement}
                onToggle={() =>
                  setOpenPanel(openPanel === "measure" ? "polygon" : "measure")
                }
              >
                <div className="space-y-3">
                  {hasPolygon && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl text-xs text-green-700 flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>Monikulmio-mittaus:</strong>{" "}
                        {activePolygon!.points.length} pistettä.
                        Pinta-ala lasketaan rajatun monikulmion mukaan.
                      </span>
                    </div>
                  )}

                  {/* Reference info */}
                  {session.autoWallHeightM ? (
                    <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl text-xs text-indigo-700 flex items-start gap-2">
                      <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>Automaattinen referenssi:</strong>{" "}
                        nurkkakorkeus{" "}
                        <strong>{session.autoWallHeightM.toFixed(2)} m</strong>{" "}
                        tallennettiin aiemmasta mittauksesta. Skaalaus
                        johdetaan polygonin pisimmästä pystyreunasta laskennan
                        yhteydessä.
                      </span>
                    </div>
                  ) : (
                    <div className="p-3 bg-slate-50 rounded-xl text-xs text-slate-600">
                      <strong>Referenssi:</strong> {session.reference.meters} m
                      = {session.reference.pixelDistance.toFixed(0)} px (
                      {session.reference.pixelsPerMeter.toFixed(1)} px/m)
                    </div>
                  )}

                  {/* Saved wall height notification after measurement */}
                  {lastStoredWallHeightM !== null && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
                      <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>
                        <strong>
                          Nurkkakorkeus {lastStoredWallHeightM.toFixed(2)} m
                          tallennettiin.
                        </strong>{" "}
                        Voit seuraavalle kuvalle ohittaa referenssimittauksen
                        — sovellus käyttää tätä automaattisesti.
                      </span>
                    </div>
                  )}

                  {/* Capture tilt badge (if photo was taken with in-app camera) */}
                  {session.captureTilt && (
                    <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-700">
                      <strong>Kameran kallistus tallennettu:</strong>{" "}
                      {session.captureTilt.cameraTiltDeg.toFixed(1)}°
                      {Math.abs(session.captureTilt.cameraTiltDeg) < 2
                        ? " — suorassa, mittaus tarkka"
                        : " — käytetään pystyperspektiivin korjaukseen"}
                    </div>
                  )}

                  {/* Keystone toggle */}
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                    <p className="text-xs font-medium text-amber-800">Pystyperspektiivin korjaus</p>
                    <p className="text-xs text-amber-700">
                      Korjaa puhelimen kallistuksen aiheuttaman vääristymän kun harja on otettu mukaan kuvaan ylhäältä päin.
                    </p>
                    <label className="flex items-center justify-between gap-2 cursor-pointer">
                      <span className="text-xs text-slate-700">
                        Automaattinen pystyperspektiivin korjaus
                      </span>
                      <button
                        onClick={() => setUseKeystoneCorrection((v) => !v)}
                        className={`relative w-10 h-5 rounded-full transition-colors ${
                          useKeystoneCorrection ? "bg-blue-500" : "bg-slate-300"
                        }`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                          useKeystoneCorrection ? "translate-x-5" : "translate-x-0.5"
                        }`} />
                      </button>
                    </label>
                  </div>

                  {/* Result */}
                  {measurement && (
                    <div className="p-3 bg-green-50 border border-green-200 rounded-xl space-y-1 text-sm">
                      <div className="flex justify-between text-green-700">
                        <span>Julkisivualue</span>
                        <span>{(measurement.wallPixels / 1000).toFixed(0)} kpx</span>
                      </div>
                      <div className="flex justify-between font-bold text-green-800 border-t border-green-200 pt-1">
                        <span>Seinäala</span>
                        <span>{measurement.wallAreaM2.toFixed(2)} m²</span>
                      </div>
                      <div className="border-t border-green-200 pt-1 space-y-0.5 text-xs text-slate-500">
                        {measurement.verticalTiltDeg !== null && (
                          <div className="flex justify-between">
                            <span>Pystykallistus β</span>
                            <span>
                              {measurement.verticalTiltDeg.toFixed(1)}°
                              <span className="text-slate-400">
                                {" "}({measurement.verticalTiltSource === "sensor"
                                  ? "anturi"
                                  : "kuvasta"}
                                {measurement.verticalTiltConfidence !== null &&
                                  measurement.verticalTiltSource === "vanishing-point" &&
                                  `, ${(measurement.verticalTiltConfidence * 100).toFixed(0)}% varmuus`})
                              </span>
                            </span>
                          </div>
                        )}
                        {Math.abs(measurement.keystoneCorrectionFactor - 1) > 0.001 && (
                          <div className="flex justify-between">
                            <span>Keystone-kerroin</span>
                            <span>{measurement.keystoneCorrectionFactor.toFixed(3)}×</span>
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
                    disabled={!hasPolygon || isMeasuring}
                    className="w-full flex items-center justify-center gap-2 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    {isMeasuring ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Calculator className="w-4 h-4" />
                    )}
                    {isMeasuring ? "Lasketaan..." : "Laske neliömetrit"}
                  </button>

                  {/* Project progress + next wall */}
                  {measurement && project && (
                    <div className="space-y-3 pt-2">
                      <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl space-y-1.5">
                        <p className="text-xs font-semibold text-blue-800 uppercase tracking-wide">
                          Tämä projekti
                        </p>
                        {project.measurements.map((m, idx) => (
                          <div
                            key={idx}
                            className="flex items-center justify-between text-sm text-blue-700"
                          >
                            <span>
                              <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 text-green-600" />
                              {m.label}
                            </span>
                            <span className="font-mono">
                              {m.areaM2.toFixed(2)} m²
                            </span>
                          </div>
                        ))}
                        <div className="flex items-center justify-between text-base font-bold text-blue-900 border-t border-blue-200 pt-1.5">
                          <span>Kokonaisala</span>
                          <span className="font-mono">
                            {projectTotal.toFixed(2)} m²
                          </span>
                        </div>
                      </div>

                      <button
                        onClick={handleNextWall}
                        className="w-full flex items-center justify-center gap-2 py-3.5 bg-gradient-to-br from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-white rounded-xl text-base font-semibold shadow-lg shadow-emerald-200/60 transition-colors"
                      >
                        <Camera className="w-5 h-5" />
                        Mittaa seuraava seinä
                        <Plus className="w-4 h-4" />
                      </button>
                      <p className="text-xs text-slate-500 text-center">
                        Sovellus käyttää automaattisesti tallennettua
                        nurkkakorkeutta — ei tarvita uutta referenssiä.
                      </p>
                    </div>
                  )}
                </div>
              </AccordionPanel>

              {/* Panel 3 — Quote */}
              <AccordionPanel
                icon={<Euro />}
                title="3. Tarjouslaskelma"
                subtitle="Laske hinta ja tallenna"
                isOpen={openPanel === "quote"}
                isDone={false}
                onToggle={() =>
                  setOpenPanel(openPanel === "quote" ? "measure" : "quote")
                }
              >
                {measurement ? (
                  <QuoteForm
                    wallAreaM2={measurement.wallAreaM2}
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
