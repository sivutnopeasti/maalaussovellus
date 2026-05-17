"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { ArrowLeft, Check } from "lucide-react";

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

import IntroScreen from "./_screens/IntroScreen";
import InstructionModal from "./_screens/InstructionModal";
import AnalysingScreen from "./_screens/AnalysingScreen";
import BetweenWallsScreen from "./_screens/BetweenWallsScreen";
import FinalSummaryScreen from "./_screens/FinalSummaryScreen";

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

  const wallCount = project?.measurements.length ?? 0;
  const wallIndex = wallCount + 1;
  const autoMode = storedWallHeightM !== null && storedWallHeightM > 0;

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
        const wh = wallHeightRef.current ?? storedWallHeightM;
        if (wh && wh > 0) {
          // Auto-mode: skip the reference step entirely
          setStep("poly-intro");
        } else {
          setStep("ref-intro");
        }
      };
      img.src = dataUrl;
    },
    [storedWallHeightM],
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
    if (!uploadedImageUrl) {
      try {
        const fd = new FormData();
        fd.append("file", imageFile);
        const res = await fetch("/api/upload", { method: "POST", body: fd });
        if (res.ok) {
          const { url } = await res.json();
          setUploadedImageUrl(url);
          void (async () => {
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
              /* snap is non-essential */
            }
          })();
        }
      } catch {
        /* upload errors surface in the analysing step instead */
      }
    }
  }, [imageFile, uploadedImageUrl]);

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

        // Persist into the project + remember the wall height for next photo
        const updated = addMeasurement(result.wallAreaM2);
        setProject(updated);

        const newWh = estimateWallHeightM(
          data.points,
          activeReference.pixelsPerMeter,
        );
        if (newWh !== null && newWh > 1 && newWh < 25) {
          storeWallHeight(newWh);
          setStoredWallHeightM(newWh);
          wallHeightRef.current = newWh;
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
  const allowScroll = step === "final";
  const lastMeasurement = project?.measurements[project.measurements.length - 1];

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      data-scroll={allowScroll ? "true" : "false"}
    >
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
              ? "Aloita päätyseinästä. Pidä puhelin suorassa."
              : autoMode
                ? "Sovellus käyttää tallennettua nurkkakorkeutta."
                : "Asetu kohtisuoraan seinään nähden."
          }
        />
      )}

      {/* ── 3. REFERENCE INTRO ───────────────────────────────────────────── */}
      {step === "ref-intro" && (
        <>
          <PhotoBackground dataUrl={imageDataUrl} />
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
          reference={reference}
          onReferenceSet={handleReferenceSet}
          onConfirm={handleReferenceConfirm}
          onBack={handleBackToCamera}
        />
      )}

      {/* ── 5. POLYGON INTRO ─────────────────────────────────────────────── */}
      {step === "poly-intro" && (
        <>
          <PhotoBackground dataUrl={imageDataUrl} />
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
          error={error}
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
  reference: ReferenceData | null;
  onReferenceSet: (data: ReferenceData) => void;
  onConfirm: () => void;
  onBack: () => void;
}

function ReferenceDrawScreen({
  imageDataUrl,
  reference,
  onReferenceSet,
  onConfirm,
  onBack,
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
            Piirrä referenssimitta
          </p>
          <p className="text-[11px] text-slate-500 truncate">
            Esim. oven leveys 0,9 m
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">
          2 / 3
        </span>
      </header>

      <div className="flex-1 min-h-0 overflow-hidden p-3">
        <ReferenceMeasure
          imageDataUrl={imageDataUrl}
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
            ? `Hyvä — referenssi ${reference!.meters} m vahvistettu`
            : "Piirrä viiva ja anna mitta"}
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
  error,
}: PolygonDrawProps) {
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
            Rajaa maalattava alue
          </p>
          <p className="text-[11px] text-slate-500 truncate">
            Klikkaa nurkat järjestyksessä — paina <strong>Valmis</strong> kun valmis
          </p>
        </div>
        <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">
          3 / 3
        </span>
      </header>

      {error && (
        <div className="mx-3 mt-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 shrink-0">
          {error}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-hidden p-3">
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
