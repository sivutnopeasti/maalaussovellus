"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Check, HelpCircle } from "lucide-react";

import ReferenceMeasure from "@/components/ReferenceMeasure";
import PolygonSelect from "@/components/PolygonSelect";
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
import { useMlsdLineMap } from "@/lib/useMlsdLineMap";

import IntroScreen from "./_screens/IntroScreen";
import InstructionModal from "./_screens/InstructionModal";
import AnalysingScreen from "./_screens/AnalysingScreen";
import BetweenWallsScreen from "./_screens/BetweenWallsScreen";
import FinalSummaryScreen from "./_screens/FinalSummaryScreen";
import PinchZoomBlocker from "./_screens/PinchZoomBlocker";

const CameraCapture = dynamic(() => import("@/components/CameraCapture"), {
  ssr: false,
});

/**
 * Single-page Snapchat-style flow.
 *
 *   intro → camera → ref-intro → ref-draw → poly-intro → poly-draw →
 *   analysing → between (or final)
 *
 * For walls 2+ a stored corner height auto-references the photo so the
 * `ref-intro` and `ref-draw` steps are skipped. Every step is locked to
 * the viewport (no scrolling) except the final summary.
 */
type Step =
  | "intro"
  | "camera"
  | "ref-intro"
  | "ref-draw"
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

export default function HomePage() {
  const [step, setStep] = useState<Step>("intro");
  const [project, setProject] = useState<FacadeProject | null>(null);
  const [storedWallHeightM, setStoredWallHeightM] = useState<number | null>(null);
  /** Latest fully-validated wall height — survives across photos in case
   *  localStorage is blocked (e.g. iOS Safari private mode). */
  const wallHeightRef = useRef<number | null>(null);

  // ── Current photo state ───────────────────────────────────────────────────
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState<string>("");
  const [imageDims, setImageDims] = useState({ w: 0, h: 0 });
  const [captureTilt, setCaptureTilt] = useState<CaptureTilt | null>(null);
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(null);
  const [mlsdMapUrl, setMlsdMapUrl] = useState<string | null>(null);
  const [reference, setReference] = useState<ReferenceData | null>(null);
  const [polygon, setPolygon] = useState<PolygonData | null>(null);
  const [analysingMessage, setAnalysingMessage] = useState<string>(
    ANALYSING_MESSAGES.upload,
  );
  const [error, setError] = useState<string | null>(null);
  /** When true, the instruction modal for the CURRENT step is shown
   *  on top of the active screen (triggered by the "Ohjeet" button in
   *  the header). The modal closes the same way the auto-shown one
   *  does — by tapping the continue button. */
  const [showHelp, setShowHelp] = useState(false);

  // ── Mount: restore project + stored wall height ───────────────────────────
  useEffect(() => {
    const proj = getProject();
    setProject(proj);
    const wh = getStoredWallHeight();
    if (wh) {
      setStoredWallHeightM(wh.valueM);
      wallHeightRef.current = wh.valueM;
    }
  }, []);

  // Auto-close any help modal whenever the step changes.
  useEffect(() => {
    setShowHelp(false);
  }, [step]);

  // ── Helpers ───────────────────────────────────────────────────────────────
  const resetCurrentPhoto = useCallback(() => {
    setImageFile(null);
    setImageDataUrl("");
    setImageDims({ w: 0, h: 0 });
    setCaptureTilt(null);
    setUploadedImageUrl(null);
    setMlsdMapUrl(null);
    setReference(null);
    setPolygon(null);
    setError(null);
  }, []);

  /** Host the capture on Fal storage + request MLSD in the background.
   *  Called as early as possible on wall 1 (before ref-draw) so reference
   *  snapping has a line map; poly-intro reuses the same upload when
   *  it completes first. */
  const runUploadAndMlsdForFile = useCallback(async (file: File) => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: fd });
      if (!res.ok) return;
      const { url } = await res.json();
      setUploadedImageUrl(url);
      try {
        const r = await fetch("/api/lines", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl: url }),
        });
        if (r.ok) {
          const { url: mlsdUrl } = await r.json();
          if (mlsdUrl) setMlsdMapUrl(mlsdUrl);
        }
      } catch {
        /* non-essential */
      }
    } catch {
      /* upload errors surface in the analysing step */
    }
  }, []);

  const wallCount = project?.measurements.length ?? 0;
  const wallIndex = wallCount + 1;
  const autoMode = storedWallHeightM !== null && storedWallHeightM > 0;
  const { ready: mlsdReady } = useMlsdLineMap(mlsdMapUrl);

  // ── 1. Intro → open camera ────────────────────────────────────────────────
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

  // ── 2. Camera → capture done → ref-intro OR poly-intro (auto) ────────────
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
          // Keep ref in sync so analyse sees the same height even if state lagged.
          wallHeightRef.current = wallHeightRef.current ?? wh;
          // Auto-mode: skip the reference step entirely
          setStep("poly-intro");
        } else {
          setStep("ref-intro");
          // Warm up hosted image + MLSD while the user reads ref-intro so
          // reference-line snapping works on ref-draw.
          void runUploadAndMlsdForFile(file);
        }
      };
      img.src = dataUrl;
    },
    [storedWallHeightM, runUploadAndMlsdForFile],
  );

  const handleCancelCamera = useCallback(() => {
    setStep(wallCount > 0 ? "between" : "intro");
  }, [wallCount]);

  // ── 3. Reference intro → ref-draw ────────────────────────────────────────
  const handleReferenceIntroDone = useCallback(() => setStep("ref-draw"), []);

  // ── 4. Reference set → poly-intro ────────────────────────────────────────
  const handleReferenceSet = useCallback((data: ReferenceData) => {
    setReference(data);
  }, []);

  const handleReferenceConfirm = useCallback(() => {
    if (!reference || reference.pixelsPerMeter <= 0) return;
    setStep("poly-intro");
  }, [reference]);

  // ── 5. Polygon intro → poly-draw (kick off upload + MLSD in parallel) ────
  const handlePolygonIntroDone = useCallback(async () => {
    if (!imageFile) return;
    setStep("poly-draw");

    // Upload + MLSD run in the background while the user is placing
    // their first corner. By the time they finish drawing (typically
    // 20-30 s), both should be ready.
    if (!uploadedImageUrl && imageFile) {
      void runUploadAndMlsdForFile(imageFile);
    }
  }, [imageFile, uploadedImageUrl, runUploadAndMlsdForFile]);

  // ── 6. Polygon drawn → analyse ───────────────────────────────────────────
  const handlePolygonSet = useCallback(
    async (data: PolygonData) => {
      setPolygon(data);
      setStep("analysing");
      setAnalysingMessage(ANALYSING_MESSAGES.measure);
      setError(null);

      try {
        // Ensure we have an uploaded URL (in case the user drew faster
        // than the upload completed).
        let imgUrl = uploadedImageUrl;
        if (!imgUrl && imageFile) {
          setAnalysingMessage(ANALYSING_MESSAGES.upload);
          const fd = new FormData();
          fd.append("file", imageFile);
          const res = await fetch("/api/upload", { method: "POST", body: fd });
          if (!res.ok) throw new Error("Kuvan lataaminen epäonnistui.");
          const { url } = await res.json();
          imgUrl = url;
          setUploadedImageUrl(url);
        }

        // Resolve the reference data
        const wh = wallHeightRef.current ?? storedWallHeightM;
        let activeReference: ReferenceData;
        if ((!reference || reference.pixelsPerMeter <= 0) && wh && wh > 0) {
          const edge = findReferenceVerticalEdge(data.points);
          if (!edge) {
            throw new Error(
              "Polygonissa ei ole pystysuoraa nurkkaa josta mittakaava saataisiin. Piirrä polygoni siten että ainakin yksi pystysuora reuna on mukana.",
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
        const result = await calculatePolygonMeasurement(
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

        const updated = addMeasurement(result.wallAreaM2);
        setProject(updated);

        // Persist into the project + remember the wall height for next photo.
        // Always store something when analysis succeeded: prefer a geometry
        // estimate, but fall back to the reference segment height (user input
        // on wall 1, or known auto height on wall 2+). Previously we only
        // stored when the estimate landed in 1–25 m; if it was null or out of
        // range, the next capture incorrectly returned to ref-intro.
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

        // Cache the analysed session in sessionStorage purely for any
        // post-hoc inspection (e.g. opening /result manually). The new
        // flow doesn't navigate there.
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
          /* private mode — ignore */
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
      imageFile,
      imageDims,
      reference,
      captureTilt,
      storedWallHeightM,
    ],
  );

  // ── 7. Between → next wall (re-open camera) or final ─────────────────────
  const handleNextWall = useCallback(() => {
    resetCurrentPhoto();
    setStep("camera");
  }, [resetCurrentPhoto]);

  const handleFinish = useCallback(() => setStep("final"), []);

  // Used by the "back" button on individual steps (e.g. polygon)
  const handleBackToCamera = useCallback(() => {
    resetCurrentPhoto();
    setStep("camera");
  }, [resetCurrentPhoto]);

  // ── Bound the visible area & lock scrolling per-step ─────────────────────
  // Only the final summary scrolls; all measurement steps stay viewport-locked.
  const allowScroll = step === "final";
  const lastMeasurement = project?.measurements[project.measurements.length - 1];

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      data-scroll={allowScroll ? "true" : "false"}
    >
      {/* iOS Safari pinch-zoom blocker — keeps the whole page from
          zooming when the user pinches anywhere outside the canvas. */}
      <PinchZoomBlocker />

      {/* ── 1. INTRO ─────────────────────────────────────────────────────── */}
      {step === "intro" && (
        <IntroScreen
          project={project}
          onOpenCamera={handleOpenCamera}
          onClearProject={handleClearAll}
        />
      )}

      {/* ── 2. CAMERA — fullscreen overlay ───────────────────────────────── */}
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

      {/* ── 3. REFERENCE INTRO ───────────────────────────────────────────── */}
      {step === "ref-intro" && (
        <>
          {mlsdReady && imageDataUrl ? (
            <PhotoBackground dataUrl={imageDataUrl} />
          ) : (
            <IntroBackdrop />
          )}
          <InstructionModal
            kind="reference"
            onContinue={handleReferenceIntroDone}
          />
        </>
      )}

      {/* ── 4. REFERENCE DRAW ────────────────────────────────────────────── */}
      {step === "ref-draw" && imageDataUrl && (
        <ReferenceDrawScreen
          imageDataUrl={imageDataUrl}
          imageDims={imageDims}
          mlsdMapUrl={mlsdMapUrl}
          reference={reference}
          onReferenceSet={handleReferenceSet}
          onConfirm={handleReferenceConfirm}
          onBack={handleBackToCamera}
          onShowHelp={() => setShowHelp(true)}
        />
      )}
      {step === "ref-draw" && showHelp && (
        <InstructionModal
          kind="reference"
          onContinue={() => setShowHelp(false)}
        />
      )}

      {/* ── 5. POLYGON INTRO ─────────────────────────────────────────────── */}
      {step === "poly-intro" && (
        <>
          {mlsdReady && imageDataUrl ? (
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

      {/* ── 6. POLYGON DRAW ──────────────────────────────────────────────── */}
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

      {/* ── 7. ANALYSING ─────────────────────────────────────────────────── */}
      {step === "analysing" && <AnalysingScreen message={analysingMessage} />}

      {/* ── 8. BETWEEN WALLS ─────────────────────────────────────────────── */}
      {step === "between" && project && lastMeasurement && (
        <BetweenWallsScreen
          project={project}
          storedWallHeightM={storedWallHeightM}
          onNextWall={handleNextWall}
          onFinish={handleFinish}
        />
      )}

      {/* ── 9. FINAL SUMMARY ─────────────────────────────────────────────── */}
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

// ── Sub-screens (kept here because they share the page's state shape) ──────

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

// ─── Reference draw ─────────────────────────────────────────────────────────

interface ReferenceDrawProps {
  imageDataUrl: string;
  imageDims: { w: number; h: number };
  mlsdMapUrl: string | null;
  reference: ReferenceData | null;
  onReferenceSet: (data: ReferenceData) => void;
  onConfirm: () => void;
  onBack: () => void;
  onShowHelp: () => void;
}

function ReferenceDrawScreen({
  imageDataUrl,
  imageDims,
  mlsdMapUrl,
  reference,
  onReferenceSet,
  onConfirm,
  onBack,
  onShowHelp,
}: ReferenceDrawProps) {
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
            Referenssimitta
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

      <div className="flex-1 min-h-0 overflow-hidden p-2.5">
        <ReferenceMeasure
          imageDataUrl={imageDataUrl}
          imageWidth={imageDims.w}
          imageHeight={imageDims.h}
          mlsdMapUrl={mlsdMapUrl ?? undefined}
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

// ─── Polygon draw ───────────────────────────────────────────────────────────

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
