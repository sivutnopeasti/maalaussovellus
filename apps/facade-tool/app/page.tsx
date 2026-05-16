"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Building2,
  ChevronRight,
  CheckCircle2,
  Loader2,
  AlertCircle,
  Sparkles,
  X,
} from "lucide-react";
import ImageUpload from "@/components/ImageUpload";
import ReferenceMeasure from "@/components/ReferenceMeasure";
import type {
  ReferenceData,
  AnalysisSession,
  CaptureTilt,
} from "@/lib/types";
import {
  getStoredWallHeight,
  clearStoredWallHeight,
  type StoredWallHeight,
} from "@/lib/wallHeight";

type Step = "upload" | "reference" | "analysing";

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
  const [step, setStep] = useState<Step>("upload");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const [imageDimensions, setImageDimensions] = useState({ w: 0, h: 0 });
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [captureTilt, setCaptureTilt] = useState<CaptureTilt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [storedWallHeight, setStoredWallHeight] =
    useState<StoredWallHeight | null>(null);
  const [autoMode, setAutoMode] = useState(false);

  useEffect(() => {
    setStoredWallHeight(getStoredWallHeight());
  }, []);

  const handleImageSelected = (
    file: File,
    dataUrl: string,
    tilt?: CaptureTilt | null,
  ) => {
    setImageFile(file);
    setImageDataUrl(dataUrl);
    setReference(null);
    setCaptureTilt(tilt ?? null);
    setAutoMode(false);
    const img = new Image();
    img.onload = () => setImageDimensions({ w: img.width, h: img.height });
    img.src = dataUrl;
    setStep("reference");
  };

  const handleReferenceSet = (data: ReferenceData) => {
    setReference(data);
  };

  const handleUseStoredWallHeight = () => {
    if (!storedWallHeight) return;
    setAutoMode(true);
    setReference(PLACEHOLDER_REFERENCE);
  };

  const handleClearStored = () => {
    clearStoredWallHeight();
    setStoredWallHeight(null);
    if (autoMode) {
      setAutoMode(false);
      setReference(null);
    }
  };

  const handleAnalyse = async () => {
    if (!imageFile || !reference) return;
    setStep("analysing");
    setError(null);

    try {
      // 1. Upload image to fal.ai storage
      const uploadForm = new FormData();
      uploadForm.append("file", imageFile);
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        body: uploadForm,
      });
      if (!uploadRes.ok) throw new Error("Kuvan lataaminen epäonnistui.");
      const { url: uploadedImageUrl } = await uploadRes.json();

      // 2. Run depth estimation (provides MLSD for keystone correction).
      //    Opening (window/door) detection has been disabled — measurements
      //    are based purely on the user-drawn polygon.
      const depthRes = await fetch("/api/depth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: uploadedImageUrl }),
      });

      if (!depthRes.ok) {
        const e = await depthRes.json().catch(() => ({}));
        throw new Error(e.error ?? "Syvyyskartan luominen epäonnistui.");
      }

      const {
        depthMapUrl,
        mlsdMapUrl,
      }: { depthMapUrl: string; mlsdMapUrl: string | null } =
        await depthRes.json();

      const session: AnalysisSession = {
        uploadedImageUrl,
        imageWidth: imageDimensions.w,
        imageHeight: imageDimensions.h,
        reference,
        depthMapUrl,
        mlsdMapUrl,
        captureTilt: captureTilt ?? undefined,
        autoWallHeightM:
          autoMode && storedWallHeight ? storedWallHeight.valueM : undefined,
      };

      sessionStorage.setItem("facadeSession", JSON.stringify(session));
      router.push("/result");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Tuntematon virhe.");
      setStep("reference");
    }
  };

  const STEPS = [
    { key: "upload",    label: "Lataa kuva" },
    { key: "reference", label: "Referenssimitta" },
    { key: "analysing", label: "Analysointi" },
  ] as const;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="p-2 bg-blue-600 rounded-lg">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-slate-900 leading-tight">Julkisivutyökalu</h1>
            <p className="text-xs text-slate-500">
              Maalausliike — neliömetrilaskenta ja värivisualisointi
            </p>
          </div>
        </div>
      </header>

      {/* Step indicators */}
      <div className="bg-white border-b border-slate-100 px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          {STEPS.map((s, i) => {
            const stepIndex = STEPS.findIndex((x) => x.key === step);
            const done = i < stepIndex;
            const active = s.key === step;
            return (
              <div key={s.key} className="flex items-center gap-2">
                {i > 0 && <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />}
                <div className={`flex items-center gap-1.5 text-sm font-medium px-3 py-1 rounded-full transition-colors ${
                  done ? "bg-green-100 text-green-700"
                       : active ? "bg-blue-600 text-white" : "text-slate-400"
                }`}>
                  {done && <CheckCircle2 className="w-3.5 h-3.5" />}
                  {active && s.key === "analysing" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {s.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <main className="flex-1 px-4 py-8">
        <div className="max-w-3xl mx-auto space-y-6">
          {error && (
            <div className="flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <div><p className="font-medium">Virhe</p><p>{error}</p></div>
            </div>
          )}

          {/* Step: upload */}
          {(step === "upload" || step === "reference") && (
            <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  step === "upload" ? "bg-blue-600 text-white" : "bg-green-100 text-green-700"
                }`}>
                  {step === "upload" ? "1" : <CheckCircle2 className="w-4 h-4" />}
                </div>
                <h2 className="font-semibold text-slate-800">Lataa julkisivukuva</h2>
              </div>

              {step === "upload" && (
                <>
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl space-y-2 text-sm">
                    <p className="font-semibold text-blue-800">Kuvausohjeet — tarkka mittaus</p>
                    <ul className="text-blue-700 space-y-1 list-disc pl-5 text-xs">
                      <li>
                        <strong>Asetu seinän keskikohtaan</strong>, noin kohtisuoraan seinään nähden.
                        Älä ota kuvaa kulmasta tai vinosti — se aiheuttaa mittavirheitä.
                      </li>
                      <li>
                        <strong>Astu tarpeeksi kauas</strong> jotta koko seinä mahtuu kuvaan,
                        myös harja jos talossa on harjakatto.
                      </li>
                      <li>
                        <strong>Pidä puhelin vaakasuorassa</strong> (älä kallista ylös). Jos käytät
                        sovelluksen kameraa, vesivaaka auttaa tämän kanssa.
                      </li>
                      <li>
                        Yhdellä kerralla mitataan <strong>yksi seinä</strong>.
                      </li>
                    </ul>
                  </div>

                  {storedWallHeight && (
                    <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-xl flex items-start gap-2 text-sm">
                      <Sparkles className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold text-indigo-800 text-xs">
                          Aiempi mittaus tallessa
                        </p>
                        <p className="text-xs text-indigo-700">
                          Nurkkakorkeus{" "}
                          <strong>{storedWallHeight.valueM.toFixed(2)} m</strong>{" "}
                          on tallennettu aiemmasta kuvasta. Voit ohittaa
                          referenssimittauksen seuraavalla seinällä — sovellus
                          ehdottaa automaatiota seuraavassa vaiheessa.
                        </p>
                      </div>
                      <button
                        onClick={handleClearStored}
                        className="p-1 hover:bg-indigo-100 rounded shrink-0"
                        title="Unohda tallennettu mitta"
                      >
                        <X className="w-3.5 h-3.5 text-indigo-500" />
                      </button>
                    </div>
                  )}
                </>
              )}

              <ImageUpload
                onImageSelected={handleImageSelected}
                previewUrl={imageDataUrl || undefined}
                onClear={() => {
                  setImageFile(null);
                  setImageDataUrl("");
                  setReference(null);
                  setStep("upload");
                }}
              />
            </section>
          )}

          {/* Step: reference measure */}
          {step === "reference" && imageDataUrl && (
            <section className="bg-white rounded-2xl border border-slate-200 p-6 space-y-4 shadow-sm">
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                  reference ? "bg-green-100 text-green-700" : "bg-blue-600 text-white"
                }`}>
                  {reference ? <CheckCircle2 className="w-4 h-4" /> : "2"}
                </div>
                <h2 className="font-semibold text-slate-800">
                  {autoMode ? "Automaattinen referenssi" : "Aseta referenssimitta"}
                </h2>
              </div>

              {/* Smart-reference card — visible only when a wall corner height
                  has been measured in a previous photo of the same house. */}
              {storedWallHeight && !autoMode && !reference && (
                <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-300 rounded-xl space-y-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-semibold text-blue-900 text-sm">
                        Käytä tallennettua nurkkakorkeutta
                      </p>
                      <p className="text-xs text-blue-700 mt-0.5">
                        Aiemmasta mittauksesta talteen jäänyt nurkkakorkeus on{" "}
                        <strong>{storedWallHeight.valueM.toFixed(2)} m</strong>.
                        Ohita referenssimittaus — sovellus johtaa skaalan
                        automaattisesti polygonin pystysuorista reunoista.
                      </p>
                    </div>
                    <button
                      onClick={handleClearStored}
                      className="p-1 hover:bg-blue-100 rounded-lg shrink-0"
                      title="Unohda tallennettu mitta"
                    >
                      <X className="w-3.5 h-3.5 text-blue-500" />
                    </button>
                  </div>
                  <button
                    onClick={handleUseStoredWallHeight}
                    className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    <Sparkles className="w-4 h-4" />
                    Käytä {storedWallHeight.valueM.toFixed(2)} m nurkkakorkeutta
                  </button>
                </div>
              )}

              {autoMode ? (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl space-y-2">
                  <div className="flex items-start gap-2 text-sm text-green-800">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>
                      <strong>Automaattinen referenssi aktivoitu.</strong>{" "}
                      Skaalaus johdetaan polygonin pystyreunoista käyttäen
                      tallennettua nurkkakorkeutta{" "}
                      <strong>{storedWallHeight?.valueM.toFixed(2)} m</strong>.
                      Voit jatkaa suoraan analysointiin.
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
                    Piirrä viiva pitkin <strong>tunnetun mittaista</strong> rakennetta —
                    esim. ulko-oven leveys (0,9 m), korkeus (2,0 m), sokkelin
                    reuna tai ikkuna. Viiva antaa mittakaavan koko kuvalle.
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
                        <strong>{reference.pixelDistance.toFixed(0)} pikseliä</strong>
                        {" — "}{reference.pixelsPerMeter.toFixed(1)} px/m
                        {Math.abs(reference.angleDeg ?? 0) > 1 && (
                          <span className="ml-1 text-slate-500">
                            · kulma {(reference.angleDeg ?? 0).toFixed(1)}°
                          </span>
                        )}
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
              {autoMode ? "Analysoi ja piirrä polygoni" : "Analysoi julkisivu"}
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
                <p className="font-semibold text-slate-800">Analysoidaan kuvaa...</p>
                <p className="text-sm text-slate-500">
                  Lasketaan syvyyskartta ja viivat perspektiivin korjaukseen.
                  Tämä kestää noin 15–30 sekuntia.
                </p>
              </div>
              <div className="w-full max-w-xs bg-slate-100 rounded-full h-1.5 overflow-hidden">
                <div className="h-full bg-blue-500 rounded-full animate-pulse w-3/4" />
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
}
