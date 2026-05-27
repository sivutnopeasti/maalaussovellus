"use client";

import { useState } from "react";
import { X, Check, Smartphone } from "lucide-react";
import {
  PHONE_MODELS,
  focalRatioFromModel,
  getStoredPhoneModel,
  storePhoneModel,
  type PhoneModel,
} from "@/lib/phoneModels";

interface Props {
  onClose: () => void;
  onSaved: (model: PhoneModel) => void;
}

export default function PhoneModelPicker({ onClose, onSaved }: Props) {
  const [selected, setSelected] = useState<PhoneModel>(
    () => getStoredPhoneModel() ?? PHONE_MODELS[PHONE_MODELS.length - 1],
  );

  const handleSave = () => {
    storePhoneModel(selected);
    onSaved(selected);
    onClose();
  };

  const ratio = focalRatioFromModel(selected);

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full sm:max-w-sm bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col max-h-[90dvh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 shrink-0">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-blue-600" />
            <h2 className="text-base font-bold text-slate-900">
              Valitse puhelinmalli
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-slate-100"
            aria-label="Sulje"
          >
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <p className="px-5 pb-3 text-xs text-slate-500 leading-snug shrink-0">
          Sovellus käyttää valitun mallin pääkameran polttopituutta
          perspektiivikorjauksen tarkkuuden parantamiseen.
        </p>

        {/* Model list */}
        <div className="flex-1 overflow-y-auto px-3 pb-2">
          {PHONE_MODELS.map((model) => {
            const isSelected = selected.id === model.id;
            return (
              <button
                key={model.id}
                onClick={() => setSelected(model)}
                className={`w-full flex items-center justify-between px-4 py-3 rounded-xl mb-1 text-left transition-colors ${
                  isSelected
                    ? "bg-blue-50 border border-blue-200"
                    : "hover:bg-slate-50 border border-transparent"
                }`}
              >
                <div>
                  <p
                    className={`text-sm font-medium ${isSelected ? "text-blue-800" : "text-slate-800"}`}
                  >
                    {model.name}
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {model.f35mm} mm · kerroin {(model.f35mm / 24).toFixed(3)}
                  </p>
                </div>
                {isSelected && (
                  <Check className="w-4 h-4 text-blue-600 shrink-0 ml-2" />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 pt-3 pb-6 border-t border-slate-100 shrink-0">
          <div className="mb-3 px-3 py-2 rounded-xl bg-slate-50 text-xs text-slate-600">
            Polttopituuskerroin:{" "}
            <span className="font-semibold text-slate-900">
              {ratio.toFixed(3)}
            </span>{" "}
            &nbsp;({selected.f35mm} mm / 24 mm)
            {ratio > 1.05 && (
              <span className="text-blue-600">
                {" "}
                — telekamera, isompi korjaus
              </span>
            )}
            {ratio < 0.95 && (
              <span className="text-amber-600">
                {" "}
                — laajakulma, pienempi korjaus
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            className="w-full py-3 rounded-2xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-lg shadow-blue-200 active:scale-[0.98] transition-transform"
          >
            Tallenna valinta
          </button>
        </div>
      </div>
    </div>
  );
}
