"use client";

import { useRef, useState, useCallback } from "react";
import { Upload, ImageIcon, X } from "lucide-react";

interface Props {
  onImageSelected: (file: File, dataUrl: string) => void;
  previewUrl?: string;
  onClear?: () => void;
}

export default function ImageUpload({
  onImageSelected,
  previewUrl,
  onClear,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          onImageSelected(file, e.target.result as string);
        }
      };
      reader.readAsDataURL(file);
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
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
      className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors ${
        isDragging
          ? "border-blue-500 bg-blue-50"
          : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50/50"
      }`}
    >
      <div className="p-4 bg-blue-100 rounded-full">
        {isDragging ? (
          <ImageIcon className="w-8 h-8 text-blue-600" />
        ) : (
          <Upload className="w-8 h-8 text-blue-600" />
        )}
      </div>
      <div className="text-center">
        <p className="font-semibold text-slate-700">
          Raahaa kuva tähän tai klikkaa valitaksesi
        </p>
        <p className="text-sm text-slate-500 mt-1">
          JPG, PNG, WebP — max 20 Mt
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
