"use client";

/**
 * v2 — AR-enhanced facade measurement flow.
 *
 * Key difference from the main flow (app/page.tsx):
 *   ref-intro + ref-draw  →  ar-measure + ref-draw (meters pre-filled from AR)
 *
 * Everything else (camera, polygon, analysis, between-walls, final) is
 * identical.  If this proves unstable the user can tap "← Takaisin vanhaan"
 * and the main app at "/" is completely unaffected.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Check, HelpCircle } from "lucide-react";
import Link from "next/link";

import ReferenceMeasure from "@/components/ReferenceMeasure";
import PolygonSelect from "@/components/PolygonSelect";
import ArReferencePicker, {
  type ArResult,
} from "@/components/ArReferencePicker";
import type {
  AnalysisSession,
  CaptureTilt,
  PolygonData,
  ReferenceData,
} from "@/lib/types";
import {
  calculatePolygonMeasurement,
  type PreciseMeasurementResult,
} from "@/lib/measure";
import {
  addMeasurement,
  clearProject,
  clearStoredWallHeight,
  estimateWallHeightM,
  findReferenceVerticalEdge,
  getProject,
  getStoredWallHeight,
  storeWallHeight,
  type FacadeProject,
} from "@/lib/wallHeight";
import IntroScreen from "@/app/_screens/IntroScreen";
import InstructionModal from "@/app/_screens/InstructionModal";
import AnalysingScreen from "@/app/_screens/AnalysingScreen";
import BetweenWallsScreen from "@/app/_screens/BetweenWallsScreen";
import FinalSummaryScreen from "@/app/_screens/FinalSummaryScreen";
import PinchZoomBlocker from "@/app/_screens/PinchZoomBlocker";

const CameraCapture = dynamic(() => import("@/components/CameraCapture"), {
  ssr: false,
});

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Steps in the v2 flow.
 * `ar-measure` replaces `ref-intro` — the user measures real-world width with
 * AR (or types it manually).  `ref-draw` follows as before but the meters
 * field is pre-filled with the AR result.
 */
type Step =
  | "intro"
  | "camera"
  | "ar-measure" // NEW: pick reference width via AR or manual
  | "ref-draw" // tap two points in the photo (meters pre-filled)
  | "poly-intro"
  | "poly-draw"
  | "analysing"
  | "between"
  | "final";

const ANALYSING_MESSAGES: Record<string, string> = {
  upload: "Ladataan kuvaa pilveen...",
  lines: "Tunnistetaan rakenteen reunoja...",
  measure: "Lasketaan pinta-alaa...",
};

// ─────────────────────────────────────────────────────────────────────────────

export default function V2Page() {
  const [step, setStep] = useState<Step>("intro");
  const [project, setProject] = useState<FacadeProject | null>(null);
  const [storedWallHeightM, setStoredWallHeightM] = useState<number | null>(
    null,
  );
  const wallHeightRef = useRef<number | null>(null);

  // Current photo state
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 });
  const [captureTilt, setCaptureTilt] = useState<CaptureTilt | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [uploadedStoragePath, setUploadedStoragePath] = useState<string | null>(
    null,
  );
  const [mlsdMapUrl, setMlsdMapUrl] = useState<string | null>(null);

  // Reference state
  const [arMeters, setArMeters] = useState<number | null>(null); // from AR step
  const [reference, setReference] = useState<ReferenceData | null>(null);

  const [polygon, setPolygon] = useState<PolygonData | null>(null);
  const [analysingMessage, setAnalysingMessage] = useState<string>(
    ANALYSING_MESSAGES.upload,
  );
  const [error, setError] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  // Restore project on mount
  useEffect(() => {
    const proj = getProject();
    if (proj) setProject(proj);
    const wh = getStoredWallHeight();
    if (wh?.valueM && wh.valueM > 0) {
      setStoredWallHeightM(wh.valueM);
      wallHeightRef.current = wh.valueM;
    }
  }, []);

  // ── Shared helpers ──────────────────────────────────────────────────────────

  const resetCurrentPhoto = useCallback(() => {
    setImageFile(null);
    setImageDataUrl("");
    setImageDims({ w: 0, h: 0 });
    setCaptureTilt(null);
    setUploadedImageUrl(null);
    setUploadedStoragePath(null);
    setMlsdMapUrl(null);
    setArMeters(null);
    setReference(null);
    setPolygon(null);
    setError(null);
  }, []);

  /** Upload image to Fal (for MLSD) and Supabase (for quotes) in the background. */
  const runUploadAndMlsdForFile = useCallback(async (file: File) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        console.error("[v2/upload]", body?.detail ?? body?.error ?? res.status);
        return;
      }
      const { url, storageUrl, path } = (await res.json()) as {
        url: string;
        storageUrl?: string;
        path?: string;
      };
      setUploadedImageUrl(storageUrl ?? url);
      if (path) setUploadedStoragePath(path);
      try {
        const r = await fetch("/api/lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: url }),
        });
        if (r.ok) {
          const { url: mlsdUrl } = (await r.json()) as { url: string };
          if (mlsdUrl) setMlsdMapUrl(mlsdUrl);
        } else {
          console.error("[v2/mlsd]", await r.text().catch(() => r.status));
        }
      } catch (err) {
        console.error("[v2/mlsd]", err);
      }
    } catch (err) {
      console.error("[v2/upload]", err);
    }
  }, []);

  const wallCount = project?.measurements.length ?? 0;
  const wallIndex = wallCount + 1;
  const autoMode = storedWallHeightM !== null && storedWallHeightM > 0;

  // ── Step handlers ───────────────────────────────────────────────────────────

  const handleOpenCamera = useCallback(() => {
    resetCurrentPhoto();
    setStep("camera");
  }, [resetCurrentPhoto]);

  const handleClearAll = useCallback(() => {
    clearProject();
    clearStoredWallHeight();
    setProject(null);
    setStoredWallHeightM(null);
    wallHeightRef.current = null;
    resetCurrentPhoto();
    setStep("intro");
  }, [resetCurrentPhoto]);

  // Camera → captured
  const handleCaptured = useCallback(
    (file: File, dataUrl: string, tilt: CaptureTilt | null) => {
      setImageFile(file);
      setImageDataUrl(dataUrl);
      setCaptureTilt(tilt);

      const img = new Image();
      img.onload = () => {
        setImageDims({ w: img.width, h: img.height });
        const fromStorage = getStoredWallHeight()?.valueM;
        const wh =
          wallHeightRef.current ??
          storedWallHeightM ??
          (fromStorage && fromStorage > 0 ? fromStorage : null);
        if (wh && wh > 0) {
          wallHeightRef.current = wallHeightRef.current ?? wh;
          setStep("poly-intro");
        } else {
          // v2: go to AR measurement instead of ref-intro
          setStep("ar-measure");
        }
        // Start upload + MLSD immediately for all paths
        void runUploadAndMlsdForFile(file);
      };
      img.src = dataUrl;
    },
    [storedWallHeightM, runUploadAndMlsdForFile],
  );

  const handleCancelCamera = useCallback(() => {
    setStep(wallCount > 0 ? "between" : "intro");
  }, [wallCount]);

  // AR measure → ref-draw (with meters pre-filled)
  const handleArResult = useCallback((result: ArResult) => {
    setArMeters(result.meters);
    setStep("ref-draw");
  }, []);

  // ref-draw
  const handleReferenceSet = useCallback((data: ReferenceData) => {
    setReference(data);
  }, []);

  const handleReferenceConfirm = useCallback(() => {
    if (!reference || reference.pixelsPerMeter <= 0) return;
    setStep("poly-intro");
  }, [reference]);

  // poly-intro → poly-draw
  const handlePolygonIntroDone = useCallback(async () => {
    if (!imageFile) return;
    setStep("poly-draw");
    if (!uploadedImageUrl && imageFile) {
      void runUploadAndMlsdForFile(imageFile);
    }
  }, [imageFile, uploadedImageUrl, runUploadAndMlsdForFile]);

  const handleBackToCamera = useCallback(() => {
    resetCurrentPhoto();
    setStep("camera");
  }, [resetCurrentPhoto]);

  // poly-draw → analysing → between/final
  const handlePolygonSet = useCallback(
    async (data: PolygonData) => {
      setPolygon(data);
      setStep("analysing");
      setAnalysingMessage(ANALYSING_MESSAGES.measure);
      setError(null);

      try {
        let imgUrl = uploadedImageUrl;
        let storagePath = uploadedStoragePath;
        if (!imgUrl && imageFile) {
          setAnalysingMessage(ANALYSING_MESSAGES.upload);
          const fd = new FormData();
          fd.append("file", imageFile);
          const res = await fetch("/api/upload", { method: "POST", body: fd });
          if (!res.ok) throw new Error("Kuvan lataaminen epäonnistui.");
          const payload = (await res.json()) as {
            url: string;
            storageUrl?: string;
            path?: string;
          };
          imgUrl = payload.storageUrl ?? payload.url;
          storagePath = payload.path ?? null;
          setUploadedImageUrl(imgUrl);
          setUploadedStoragePath(storagePath);
        }

        const wh = wallHeightRef.current ?? storedWallHeightM;
        let activeReference: ReferenceData;
        if ((!reference || reference.pixelsPerMeter <= 0) && wh && wh > 0) {
          const edge = findReferenceVerticalEdge(data.points);
          if (!edge) {
            throw new Error(
              "Polygonissa ei ole pystysuoraa nurkkaa josta mittakaava saataisiin.",
            );
          }
          activeReference = {
            point1: edge.p1,
            point2: edge.p2,
            meters: wh,
            pixelDistance: edge.pixelLength,
            pixelsPerMeter: edge.pixelLength / wh,
            angleDeg: 90,
          };
        } else if (reference && reference.pixelsPerMeter > 0) {
          activeReference = reference;
        } else {
          throw new Error("Referenssitietoa ei löytynyt.");
        }

        setAnalysingMessage(ANALYSING_MESSAGES.measure);
        const result: PreciseMeasurementResult = await calculatePolygonMeasurement(
          data.points,
          [],
          imageDims.w,
          imageDims.h,
          activeReference,
          {
            useKeystoneCorrection: true,
            sensorTiltBetaDeg: captureTilt?.cameraTiltDeg ?? null,
          },
        );

        const updated = addMeasurement(result.wallAreaM2, {
          imageUrl: imgUrl ?? undefined,
          storagePath: storagePath ?? undefined,
        });
        setProject(updated);

        const estimatedWh = estimateWallHeightM(
          data.points,
          activeReference.pixelsPerMeter,
        );
        const refMeters = activeReference.meters;
        let persistedWh: number | null = null;
        if (
          estimatedWh !== null &&
          Number.isFinite(estimatedWh) &&
          estimatedWh > 0.3 &&
          estimatedWh < 80
        ) {
          persistedWh = estimatedWh;
        } else if (Number.isFinite(refMeters) && refMeters > 0) {
          persistedWh = refMeters;
        }
        if (persistedWh !== null) {
          storeWallHeight(persistedWh);
          setStoredWallHeightM(persistedWh);
          wallHeightRef.current = persistedWh;
        }

        const session: AnalysisSession = {
          uploadedImageUrl: imgUrl!,
          imageWidth: imageDims.w,
          imageHeight: imageDims.h,
          reference: activeReference,
          captureTilt: captureTilt ?? undefined,
          autoWallHeightM: wh ?? undefined,
          polygon: data,
        };
        try {
          sessionStorage.setItem("facadeSession", JSON.stringify(session));
        } catch {
          /* private mode */
        }

        setStep("between");
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Laskenta epäonnistui.";
        setError(msg);
        setStep("poly-draw");
      }
    },
    [
      uploadedImageUrl,
      uploadedStoragePath,
      imageFile,
      reference,
      imageDims,
      captureTilt,
      storedWallHeightM,
    ],
  );

  const handleNextWall = useCallback(() => {
    resetCurrentPhoto();
    setStep("camera");
  }, [resetCurrentPhoto]);

  const handleFinish = useCallback(() => setStep("final"), []);

  // ── Render ──────────────────────────────────────────────────────────────────

  const allowScroll = step === "final";
  const lastMeasurement = project?.measurements[project.measurements.length - 1];

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      data-scroll={allowScroll ? "true" : "false"}
    >
      <PinchZoomBlocker />

      {/* Back-to-v1 link — shown on intro only */}
      {step === "intro" && (
        <div className="absolute top-3 right-3 z-50">
          <Link
            href="/"
            className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white/80 backdrop-blur-sm text-xs text-slate-500 border border-slate-200 hover:bg-white shadow-sm"
          >
            ← Vanha versio
          </Link>
        </div>
      )}

      {/* 1. INTRO */}
      {step === "intro" && (
        <IntroScreen
          project={project}
          onOpenCamera={handleOpenCamera}
          onClearProject={handleClearAll}
        />
      )}

      {/* 2. CAMERA */}
      {step === "camera" && (
        <CameraCapture
          onCapture={handleCaptured}
          onClose={handleCancelCamera}
          title={
            wallCount === 0
              ? "Seinä 1 — pääty"
              : `Seinä ${wallIndex}${autoMode ? " — automaattinen" : ""}`
          }
          hint={
            wallCount === 0
              ? "Aloita päätyseinästä. Vesivaaka vihertää kun puhelin on suorassa."
              : autoMode
                ? "Referenssivaihe ohitetaan — rajaa vain nurkat."
                : "Asetu kohtisuoraan seinään nähden."
          }
        />
      )}

      {/* 3. AR MEASURE — pick reference width */}
      {step === "ar-measure" && (
        <ArReferencePicker
          onResult={handleArResult}
          onBack={handleBackToCamera}
        />
      )}

      {/* 4. REF-DRAW — tap two points in image (meters pre-filled from AR) */}
      {step === "ref-draw" && imageDataUrl && (
        <ArReferenceDrawScreen
          imageDataUrl={imageDataUrl}
          imageDims={imageDims}
          mlsdMapUrl={mlsdMapUrl}
          reference={reference}
          initialMeters={arMeters ?? undefined}
          onReferenceSet={handleReferenceSet}
          onConfirm={handleReferenceConfirm}
          onBack={() => setStep("ar-measure")}
          onShowHelp={() => setShowHelp(true)}
        />
      )}
      {step === "ref-draw" && showHelp && (
        <InstructionModal
          kind="reference"
          onContinue={() => setShowHelp(false)}
        />
      )}

      {/* 5. POLY INTRO */}
      {step === "poly-intro" && (
        <>
          {imageDataUrl ? (
            <PhotoBackground dataUrl={imageDataUrl} />
          ) : (
            <IntroBackdrop />
          )}
          <InstructionModal
            kind="polygon"
            onContinue={handlePolygonIntroDone}
            autoMode={autoMode}
          />
        </>
      )}

      {/* 6. POLY DRAW */}
      {step === "poly-draw" && (
        <PolygonDrawScreen
          imageDataUrl={imageDataUrl}
          imageDims={imageDims}
          mlsdMapUrl={mlsdMapUrl}
          reference={reference ?? undefined}
          autoWallHeightM={
            reference && reference.pixelsPerMeter > 0
              ? undefined
              : (storedWallHeightM ?? undefined)
          }
          onPolygonSet={handlePolygonSet}
          onBack={handleBackToCamera}
          onShowHelp={() => setShowHelp(true)}
          error={error}
        />
      )}
      {step === "poly-draw" && showHelp && (
        <InstructionModal
          kind="polygon"
          onContinue={() => setShowHelp(false)}
          autoMode={autoMode}
        />
      )}

      {/* 7. ANALYSING */}
      {step === "analysing" && <AnalysingScreen message={analysingMessage} />}

      {/* 8. BETWEEN WALLS */}
      {step === "between" && project && lastMeasurement && (
        <BetweenWallsScreen
          project={project}
          storedWallHeightM={storedWallHeightM}
          onNextWall={handleNextWall}
          onFinish={handleFinish}
        />
      )}

      {/* 9. FINAL SUMMARY */}
      {step === "final" && project && (
        <FinalSummaryScreen
          project={project}
          onBack={() => setStep("between")}
          onStartOver={handleClearAll}
        />
      )}
    </div>
  );
}

// ── Local sub-screens (mirror of page.tsx equivalents) ───────────────────────

function IntroBackdrop() {
  return <div className="absolute inset-0 bg-slate-900" />;
}

function PhotoBackground({ dataUrl }: { dataUrl: string }) {
  if (!dataUrl) return null;
  return (
    <div className="absolute inset-0 bg-slate-900">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={dataUrl}
        alt=""
        className="absolute inset-0 w-full h-full object-cover opacity-60"
      />
    </div>
  );
}

// ── AR-aware reference draw screen ───────────────────────────────────────────

interface ArReferenceDrawProps {
  imageDataUrl: string;
  imageDims: { w: number; h: number };
  mlsdMapUrl: string | null;
  reference: ReferenceData | null;
  initialMeters?: number;
  onReferenceSet: (data: ReferenceData) => void;
  onConfirm: () => void;
  onBack: () => void;
  onShowHelp: () => void;
}

function ArReferenceDrawScreen({
  imageDataUrl,
  imageDims,
  mlsdMapUrl,
  reference,
  initialMeters,
  onReferenceSet,
  onConfirm,
  onBack,
  onShowHelp,
}: ArReferenceDrawProps) {
  const canConfirm = !!reference && reference.pixelsPerMeter > 0;
  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <header className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-slate-100"
          aria-label="Takaisin"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-slate-900 leading-tight">
            Merkitse aukon reunat kuvaan
          </p>
          {initialMeters !== undefined && (
            <p className="text-xs text-blue-600 font-medium">
              AR-mitta: {initialMeters} m — napauta saman aukon reunat
            </p>
          )}
        </div>
        <button
          onClick={onShowHelp}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100"
          aria-label="Näytä ohjeet"
        >
          <HelpCircle className="w-4 h-4" />
          Ohjeet
        </button>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden p-2.5">
        <ReferenceMeasure
          imageDataUrl={imageDataUrl}
          imageWidth={imageDims.w}
          imageHeight={imageDims.h}
          mlsdMapUrl={mlsdMapUrl ?? undefined}
          initialMeters={initialMeters}
          onReferenceSet={onReferenceSet}
        />
      </div>

      <div className="px-3 pb-3 pt-2 border-t border-slate-200 shrink-0">
        <button
          onClick={onConfirm}
          disabled={!canConfirm}
          className="w-full py-3 rounded-2xl bg-blue-600 disabled:bg-slate-300 text-white font-bold text-base shadow-lg shadow-blue-200 flex items-center justify-center gap-2 active:scale-[0.98]"
        >
          <Check className="w-5 h-5" />
          {canConfirm
            ? `Jatka — ${reference!.meters} m`
            : "Napauta aukko tai piirrä viiva"}
        </button>
      </div>
    </div>
  );
}

// ── Polygon draw screen (same as page.tsx) ───────────────────────────────────

interface PolygonDrawProps {
  imageDataUrl: string;
  imageDims: { w: number; h: number };
  mlsdMapUrl: string | null;
  reference?: ReferenceData;
  autoWallHeightM?: number;
  onPolygonSet: (data: PolygonData) => void;
  onBack: () => void;
  onShowHelp: () => void;
  error: string | null;
}

function PolygonDrawScreen({
  imageDataUrl,
  imageDims,
  mlsdMapUrl,
  reference,
  autoWallHeightM,
  onPolygonSet,
  onBack,
  onShowHelp,
  error,
}: PolygonDrawProps) {
  return (
    <div className="absolute inset-0 flex flex-col bg-white">
      <header className="px-3 py-2.5 border-b border-slate-200 flex items-center gap-2 shrink-0 z-20 bg-white">
        <button
          onClick={onBack}
          className="p-1.5 rounded-lg hover:bg-slate-100"
          aria-label="Takaisin"
        >
          <ArrowLeft className="w-5 h-5 text-slate-600" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm text-slate-900 leading-tight">
            Rajaa maalattava alue
          </p>
        </div>
        <button
          onClick={onShowHelp}
          className="flex items-center gap-1 px-2.5 py-1.5 rounded-full bg-blue-50 text-blue-700 text-xs font-semibold hover:bg-blue-100"
          aria-label="Näytä ohjeet"
        >
          <HelpCircle className="w-4 h-4" />
          Ohjeet
        </button>
      </header>

      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden p-2.5">
        {imageDataUrl && imageDims.w > 0 && (
          <PolygonSelect
            imageUrl={imageDataUrl}
            imageWidth={imageDims.w}
            imageHeight={imageDims.h}
            onPolygonSet={onPolygonSet}
            reference={reference}
            autoWallHeightM={autoWallHeightM}
            mlsdMapUrl={mlsdMapUrl ?? undefined}
          />
        )}
      </div>
    </div>
  );
}
