"use client";

import { useRef, useState, useCallback } from "react";
import { Upload, ImageIcon, X, Loader2, Camera } from "lucide-react";
import dynamic from "next/dynamic";
import type { CaptureTilt } from "@/lib/types";

const CameraCapture = dynamic(() => import("./CameraCapture"), { ssr: false });

interface Props {
  onImageSelected: (
    file: File,
    dataUrl: string,
    tilt?: CaptureTilt | null,
  ) => void;
  previewUrl?: string;
  onClear?: () => void;
}

const ACCEPTED_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
];

function isHeic(file: File): boolean {
  if (file.type === "image/heic" || file.type === "image/heif") return true;
  const ext = file.name.split(".").pop()?.toLowerCase();
  return ext === "heic" || ext === "heif";
}

function isAccepted(file: File): boolean {
  if (ACCEPTED_TYPES.includes(file.type)) return true;
  return isHeic(file);
}

export default function ImageUpload({
  onImageSelected,
  previewUrl,
  onClear,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(false);

  const handleFile = useCallback(
    async (file: File, tilt?: CaptureTilt | null) => {
      if (!isAccepted(file)) return;

      let processedFile = file;
      if (isHeic(file)) {
        setIsConverting(true);
        try {
          const heic2any = (await import("heic2any")).default;
          const blob = await heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 0.92,
          });
          const converted = Array.isArray(blob) ? blob[0] : blob;
          processedFile = new File(
            [converted],
            file.name.replace(/\.heic$/i, ".jpg").replace(/\.heif$/i, ".jpg"),
            { type: "image/jpeg" },
          );
        } catch (err) {
          console.error("HEIC-muunnos epäonnistui:", err);
          setIsConverting(false);
          return;
        } finally {
          setIsConverting(false);
        }
      }

      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          onImageSelected(processedFile, e.target.result as string, tilt);
        }
      };
      reader.readAsDataURL(processedFile);
    },
    [onImageSelected],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleCameraCapture = useCallback(
    (file: File, _dataUrl: string, tilt: CaptureTilt | null) => {
      setCameraOpen(false);
      handleFile(file, tilt);
    },
    [handleFile],
  );

  if (previewUrl) {
    return (
      <div className="relative group rounded-xl overflow-hidden border-2 border-slate-200 bg-slate-100">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previewUrl}
          alt="Ladattu julkisivukuva"
          className="w-full max-h-80 object-contain"
        />
        {onClear && (
          <button
            onClick={onClear}
            className="absolute top-2 right-2 bg-white/90 hover:bg-white rounded-full p-1.5 shadow transition-opacity opacity-0 group-hover:opacity-100"
            title="Poista kuva"
          >
            <X className="w-4 h-4 text-slate-600" />
          </button>
        )}
      </div>
    );
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex flex-col items-center justify-center gap-4 border-2 border-dashed rounded-xl p-8 transition-colors ${
          isConverting
            ? "border-blue-300 bg-blue-50 cursor-wait"
            : isDragging
              ? "border-blue-500 bg-blue-50"
              : "border-slate-300 bg-slate-50"
        }`}
      >
        <div className="p-4 bg-blue-100 rounded-full">
          {isConverting ? (
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          ) : isDragging ? (
            <ImageIcon className="w-8 h-8 text-blue-600" />
          ) : (
            <Upload className="w-8 h-8 text-blue-600" />
          )}
        </div>
        <div className="text-center">
          <p className="font-semibold text-slate-700">
            {isConverting
              ? "Muunnetaan HEIC → JPEG..."
              : "Lataa kuva tai ota uusi"}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            JPG, PNG, WebP, <strong>HEIC</strong> (iPhone) — max 20 Mt
          </p>
        </div>

        <div className="flex flex-wrap gap-2 justify-center w-full">
          <button
            type="button"
            onClick={() => !isConverting && setCameraOpen(true)}
            disabled={isConverting}
            className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Camera className="w-4 h-4" />
            Ota kuva kameralla
          </button>
          <button
            type="button"
            onClick={() => !isConverting && inputRef.current?.click()}
            disabled={isConverting}
            className="flex items-center gap-2 px-4 py-2.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-sm font-medium disabled:opacity-50"
          >
            <Upload className="w-4 h-4" />
            Lataa tiedosto
          </button>
        </div>

        <p className="text-xs text-center text-slate-500">
          Kameralla otetussa kuvassa puhelimen kallistus tallennetaan automaattisesti — tarkempi mittaus.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*,.heic,.heif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {cameraOpen && (
        <CameraCapture
          onCapture={handleCameraCapture}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </>
  );
}
