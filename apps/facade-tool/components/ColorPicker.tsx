"use client";

import { Check } from "lucide-react";
import type { PaintColor } from "@/lib/types";
import { PAINT_COLORS } from "@/lib/types";

interface Props {
  selected: PaintColor | null;
  onSelect: (color: PaintColor) => void;
  customHex?: string;
  onCustomHexChange?: (hex: string) => void;
}

export default function ColorPicker({
  selected,
  onSelect,
  customHex,
  onCustomHexChange,
}: Props) {
  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-slate-700">Valitse uusi seinäväri</p>

      <div className="grid grid-cols-5 gap-2">
        {PAINT_COLORS.map((color) => (
          <button
            key={color.hex}
            onClick={() => onSelect(color)}
            title={color.name}
            className="relative group flex flex-col items-center gap-1"
          >
            <div
              className={`w-10 h-10 rounded-full border-2 transition-transform group-hover:scale-110 ${
                selected?.hex === color.hex
                  ? "border-blue-600 scale-110 ring-2 ring-blue-300"
                  : "border-slate-200"
              }`}
              style={{ backgroundColor: color.hex }}
            >
              {selected?.hex === color.hex && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Check
                    className="w-4 h-4 drop-shadow"
                    style={{
                      color:
                        isLightColor(color.hex) ? "#1E293B" : "#FFFFFF",
                    }}
                  />
                </div>
              )}
            </div>
            <span className="text-xs text-slate-500 truncate w-full text-center leading-tight">
              {color.name}
            </span>
          </button>
        ))}
      </div>

      {/* Custom colour via native colour picker */}
      {onCustomHexChange && (
        <div className="flex items-center gap-3 pt-1">
          <label className="text-sm text-slate-600 shrink-0">Oma väri:</label>
          <input
            type="color"
            value={customHex ?? "#FFFFFF"}
            onChange={(e) => onCustomHexChange(e.target.value)}
            className="w-10 h-10 rounded-lg border border-slate-300 cursor-pointer"
          />
          {customHex && (
            <button
              onClick={() =>
                onSelect({ name: "Oma väri", hex: customHex })
              }
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-sm transition-colors"
            >
              Käytä tätä
            </button>
          )}
        </div>
      )}

      {selected && (
        <div className="flex items-center gap-2 p-2 bg-slate-50 rounded-lg border border-slate-200">
          <div
            className="w-5 h-5 rounded-full border border-slate-300 shrink-0"
            style={{ backgroundColor: selected.hex }}
          />
          <span className="text-sm text-slate-700">
            <span className="font-medium">{selected.name}</span>
            <span className="text-slate-400 ml-1">{selected.hex}</span>
          </span>
        </div>
      )}
    </div>
  );
}

function isLightColor(hex: string): boolean {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceived luminance
  return r * 0.299 + g * 0.587 + b * 0.114 > 160;
}
