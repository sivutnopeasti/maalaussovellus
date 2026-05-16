"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Sparkles,
  Camera,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import ReferenceMeasure from "@/components/ReferenceMeasure";
import type {
  ReferenceData,
  AnalysisSession,
  CaptureTilt,
} from "@/lib/types";
import {
  getStoredWallHeight,
  clearStoredWallHeight,
  getProject,
  clearProject,
  projectTotalM2,
  type StoredWallHeight,
  type FacadeProject,
} from "@/lib/wallHeight";

const CameraCapture = dynamic(() => import("@/components/CameraCapture"), {
  ssr: false,
});

type Step = "capture" | "reference" | "analysing";

/** Placeholder used when the user picks auto-mode: the real reference is
 *  computed on the result page from the polygon's vertical edges. */
const PLACEHOLDER_REFERENCE: ReferenceData = {
  point1: { x: 0, y: 0 },
  point2: { x: 0, y: 0 },
  meters: 0,
  pixelsPerMeter: 0,
  pixelDistance: 0,
  angleDeg: 0,
};

export default function HomePage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("capture");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const [imageDimensions, setImageDimensions] = useState({ w: 0, h: 0 });
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [captureTilt, setCaptureTilt] = useState<CaptureTilt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storedWallHeight, setStoredWallHeight] =
    useState<StoredWallHeight | null>(null);
  const [project, setProject] = useState<FacadeProject | null>(null);
  const [autoMode, setAutoMode] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [introShown, setIntroShown] = useState(false);
  const cameraAutoOpenedRef = useRef(false);

  // Load persisted project + wall height on mount
  useEffect(() => {
    const wh = getStoredWallHeight();
    setStoredWallHeight(wh);
    const proj = getProject();
    setProject(proj);

    // If we have a stored wall height (= previous measurement exists),
    // skip the intro and open the camera immediately. Otherwise show a
    // short intro the first time so the user knows what's happening.
    if (wh && !cameraAutoOpenedRef.current) {
      cameraAutoOpenedRef.current = true;
      // Auto-enter auto-mode for subsequent measurements
      setAutoMode(true);
      setReference(PLACEHOLDER_REFERENCE);
      setCameraOpen(true);
      setIntroShown(true);
    } else if (!wh) {
      setIntroShown(true);
    }
  }, []);

  // Allow `/?camera=1` query to force the camera to open (e.g. when navigated
  // here from the result page after "Mittaa seuraava seinä").
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("camera") === "1" && !cameraAutoOpenedRef.current) {
      cameraAutoOpenedRef.current = true;
      setCameraOpen(true);
    }
  }, []);

  const wallCount = project?.measurements.length ?? 0;
  const wallIndex = wallCount + 1;
  const cameraTitle =
    wallCount === 0 ? "Seinä 1 — pääty" : `Seinä ${wallIndex}`;

  const runAnalysis = async (
    file: File,
    dimensions: { w: number; h: number },
    ref: ReferenceData,
    tilt: CaptureTilt | null,
  ) => {
    setStep("analysing");
    setError(null);

    try {
      const uploadForm = new FormData();
      uploadForm.append("file", file);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: uploadForm,
      });
      if (!uploadRes.ok) throw new Error("Kuvan lataaminen epäonnistui.");
      const { url: uploadedImageUrl } = await uploadRes.json();

      const session: AnalysisSession = {
        uploadedImageUrl,
        imageWidth: dimensions.w,
        imageHeight: dimensions.h,
        reference: ref,
        captureTilt: tilt ?? undefined,
        autoWallHeightM:
          autoMode && storedWallHeight ? storedWallHeight.valueM : undefined,
      };

      sessionStorage.setItem("facadeSession", JSON.stringify(session));
      router.push("/result");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Tuntematon virhe.");
      setStep(autoMode ? "capture" : "reference");
    }
  };

  const handleCameraCapture = (
    file: File,
    dataUrl: string,
    tilt: CaptureTilt | null,
  ) => {
    setCameraOpen(false);
    setImageFile(file);
    setImageDataUrl(dataUrl);
    setCaptureTilt(tilt);

    const img = new Image();
    img.onload = () => {
      const dims = { w: img.width, h: img.height };
      setImageDimensions(dims);

      // Auto-mode: known wall corner height → skip the manual reference
      // line step and analyse straight away.
      if (autoMode && storedWallHeight) {
        setReference(PLACEHOLDER_REFERENCE);
        void runAnalysis(file, dims, PLACEHOLDER_REFERENCE, tilt);
      } else {
        setReference(null);
        setStep("reference");
      }
    };
    img.src = dataUrl;
  };

  const handleReferenceSet = (data: ReferenceData) => {
    setReference(data);
  };

  const handleClearProject = () => {
    clearProject();
    clearStoredWallHeight();
    setProject(null);
    setStoredWallHeight(null);
    setAutoMode(false);
    setReference(null);
    setImageFile(null);
    setImageDataUrl("");
    setStep("capture");
  };

  const handleAnalyse = () => {
    if (!imageFile || !reference) return;
    void runAnalysis(imageFile, imageDimensions, reference, captureTilt);
  };

  const STEPS = [
    { key: "capture", label: "Ota kuva" },
    { key: "reference", label: "Referenssi" },
    { key: "analysing", label: "Analyysi" },
  ] as const;

  const totalArea = projectTotalM2(project);

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div className="flex-1">
            <h1 className="font-bold text-slate-900 leading-tight">
              Julkisivutyökalu
            </h1>
            <p className="text-xs text-slate-500">
              {project && wallCount > 0
                ? `Mitattu ${wallCount} seinää · yhteensä ${totalArea.toFixed(1)} m²`
                : "Maalausliike — neliömetrilaskenta"}
            </p>
          </div>
          {project && wallCount > 0 && (
            <button
              onClick={handleClearProject}
              className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
              title="Aloita uusi projekti"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
        {/* Step indicator */}
        <div className="max-w-3xl mx-auto mt-4 flex items-center gap-1 flex-wrap text-xs">
          {STEPS.map((s, i) => {
            const sIdx = STEPS.findIndex((t) => t.key === step);
            const tIdx = STEPS.findIndex((t) => t.key === s.key);
            const done = tIdx < sIdx;
            const active = tIdx === sIdx;
            return (
              <div key={s.key} className="flex items-center gap-2">
                {i > 0 && <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />}
                <div
                  className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full transition-colors ${
                    done
                      ? "bg-green-100 text-green-700"
                      : active
                        ? "bg-blue-600 text-white"
                        : "text-slate-400"
                  }`}
                >
                  {done && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {active && s.key === "analysing" && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  )}
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium">Virhe</p>
                <p>{error}</p>
              </div>
            </div>
          )}

          {/* Step 1 — Capture (no upload, only camera) */}
          {step === "capture" && introShown && (
            <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-5 shadow-sm">
              <div className="text-center space-y-3">
                <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center">
                  <Camera className="w-8 h-8 text-blue-600" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-slate-900">
                    {wallCount === 0
                      ? "Aloita pääätyseinästä"
                      : `Seinä ${wallIndex} / ${wallCount + 1}+`}
                  </h2>
                  <p className="text-sm text-slate-500 mt-1">
                    {wallCount === 0
                      ? "Ota ensimmäinen kuva päätyseinästä (lyhyt sivu). Sovellus ohjaa läpi: kuva → referenssi → rajaus → seuraava seinä."
                      : "Ota nyt kuva seuraavasta seinästä. Sovellus käyttää aiempaa nurkkakorkeutta automaattisesti — ei tarvitse uutta referenssimittausta."}
                  </p>
                </div>
              </div>

              {/* Project status if multi-photo */}
              {project && wallCount > 0 && (
                <div className="p-4 bg-indigo-50 border border-indigo-200 rounded-xl space-y-2">
                  <p className="text-xs font-semibold text-indigo-800 uppercase tracking-wide">
                    Tämä projekti
                  </p>
                  <ul className="space-y-1">
                    {project.measurements.map((m, idx) => (
                      <li
                        key={idx}
                        className="flex items-center justify-between text-sm text-indigo-700"
                      >
                        <span>
                          <CheckCircle2 className="w-3.5 h-3.5 inline mr-1.5 text-green-600" />
                          {m.label}
                        </span>
                        <span className="font-mono">
                          {m.areaM2.toFixed(2)} m²
                        </span>
                      </li>
                    ))}
                    <li className="flex items-center justify-between text-sm font-bold text-indigo-900 border-t border-indigo-200 pt-1.5">
                      <span>Yhteensä</span>
                      <span className="font-mono">
                        {totalArea.toFixed(2)} m²
                      </span>
                    </li>
                  </ul>
                  {storedWallHeight && (
                    <p className="text-xs text-indigo-600 flex items-center gap-1 pt-1">
                      <Sparkles className="w-3 h-3" />
                      Tallennettu nurkkakorkeus:{" "}
                      <strong>{storedWallHeight.valueM.toFixed(2)} m</strong>
                    </p>
                  )}
                </div>
              )}

              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1 text-sm text-slate-600">
                <p className="font-semibold text-slate-800">Kuvausohjeet</p>
                <ul className="space-y-1 list-disc pl-5 text-xs">
                  <li>
                    Asetu kohtisuoraan seinään nähden, sen <strong>keskikohdalle</strong>.
                  </li>
                  <li>
                    Astu tarpeeksi kauas niin että <strong>koko seinä</strong>{" "}
                    mahtuu kuvaan harjaa myöten.
                  </li>
                  <li>
                    Vesivaaka ohjaa: <strong>vihreä viiva</strong> = puhelin
                    suorassa = ota kuva.
                  </li>
                </ul>
              </div>

              <button
                onClick={() => setCameraOpen(true)}
                className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold rounded-2xl shadow-lg shadow-blue-200 transition-colors"
              >
                <Camera className="w-5 h-5" />
                {wallCount === 0
                  ? "Avaa kamera"
                  : `Ota kuva seinästä ${wallIndex}`}
              </button>
            </section>
          )}

          {/* Step 2 — Reference (manual or auto) */}
          {step === "reference" && imageDataUrl && (
            <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    reference && (autoMode || reference.pixelsPerMeter > 0)
                      ? "bg-green-100 text-green-700"
                      : "bg-blue-600 text-white"
                  }`}
                >
                  {reference && (autoMode || reference.pixelsPerMeter > 0) ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    "2"
                  )}
                </div>
                <h2 className="font-semibold text-slate-800">
                  {autoMode
                    ? "Referenssi (automaattinen)"
                    : "Aseta referenssimitta"}
                </h2>
              </div>

              {autoMode ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl space-y-2">
                  <div className="flex items-start gap-2 text-sm text-green-800">
                    <Sparkles className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Käytetään tallennettua nurkkakorkeutta{" "}
                      {storedWallHeight?.valueM.toFixed(2)} m.</strong>{" "}
                      Skaalaus johdetaan polygonin pystyreunoista — voit jatkaa
                      suoraan analysointiin.
                    </span>
                  </div>
                  <button
                    onClick={() => {
                      setAutoMode(false);
                      setReference(null);
                    }}
                    className="text-xs text-green-700 underline hover:text-green-800"
                  >
                    Vaihda manuaaliseen referenssimittaukseen
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-sm text-slate-500">
                    Piirrä viiva pitkin <strong>tunnetun mittaista</strong>{" "}
                    rakennetta — esim. ulko-oven leveys (0,9 m), korkeus (2,0 m)
                    tai sokkelin reuna. Viiva antaa mittakaavan koko kuvalle.
                  </p>
                  <ReferenceMeasure
                    imageDataUrl={imageDataUrl}
                    onReferenceSet={handleReferenceSet}
                  />
                  {reference && reference.pixelsPerMeter > 0 && (
                    <div className="flex items-center gap-2 p-3 bg-green-50 rounded-xl border border-green-200 text-sm text-green-700">
                      <CheckCircle2 className="w-4 h-4 shrink-0" />
                      <span>
                        Referenssimitta asetettu:{" "}
                        <strong>{reference.meters} m</strong> ={" "}
                        <strong>
                          {reference.pixelDistance.toFixed(0)} pikseliä
                        </strong>{" "}
                        — {reference.pixelsPerMeter.toFixed(1)} px/m
                      </span>
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {/* Analyse button */}
          {step === "reference" && reference && (
            <button
              onClick={handleAnalyse}
              className="w-full flex items-center justify-center gap-2 py-4 bg-blue-600 hover:bg-blue-700 text-white text-base font-semibold rounded-2xl shadow-lg shadow-blue-200 transition-colors"
            >
              {autoMode ? "Jatka rajaukseen" : "Analysoi kuva"}
              <ChevronRight className="w-5 h-5" />
            </button>
          )}

          {/* Loading state */}
          {step === "analysing" && (
            <section className="bg-white rounded-2xl border border-slate-200 p-10 flex flex-col items-center gap-4 shadow-sm">
              <div className="p-4 bg-blue-50 rounded-full">
                <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
              </div>
              <div className="text-center space-y-1">
                <p className="font-semibold text-slate-800">Ladataan kuvaa...</p>
                <p className="text-sm text-slate-500">
                  Vie kuvan pilveen ja siirtää sinut rajaukseen muutamassa
                  sekunnissa.
                </p>
              </div>
              <div className="w-full max-w-xs bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full animate-pulse w-3/4" />
              </div>
            </section>
          )}
        </div>
      </main>

      {/* Camera modal */}
      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
          title={cameraTitle}
          hint={
            wallCount === 0
              ? "Asetu päätyseinän eteen ja pidä puhelin suorassa."
              : `Ota kuva seinästä ${wallIndex} kohtisuoraan keskikohdasta.`
          }
        />
      )}
    </div>
  );
}
