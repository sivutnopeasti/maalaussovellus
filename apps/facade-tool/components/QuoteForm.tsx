"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { Save, Calculator } from "lucide-react";

interface FormValues {
  unitPrice: number;
  fixedCosts: number;
  notes: string;
  projectId: string;
}

interface Props {
  wallAreaM2: number;
  visualizedImageUrl?: string;
  onSave: (data: {
    unitPrice: number;
    fixedCosts: number;
    totalPrice: number;
    notes: string;
    projectId: string;
  }) => Promise<void>;
  isSaving?: boolean;
}

export default function QuoteForm({
  wallAreaM2,
  visualizedImageUrl,
  onSave,
  isSaving,
}: Props) {
  const {
    register,
    watch,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { unitPrice: 18, fixedCosts: 200, notes: "", projectId: "" },
  });

  const unitPrice = watch("unitPrice") ?? 0;
  const fixedCosts = watch("fixedCosts") ?? 0;
  const totalPrice = wallAreaM2 * Number(unitPrice) + Number(fixedCosts);
  const [saved, setSaved] = useState(false);

  const onSubmit = async (values: FormValues) => {
    await onSave({
      unitPrice: Number(values.unitPrice),
      fixedCosts: Number(values.fixedCosts),
      totalPrice,
      notes: values.notes,
      projectId: values.projectId,
    });
    setSaved(true);
  };

  void visualizedImageUrl; // used by parent

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Calculator className="w-4 h-4 text-blue-600" />
        Tarjouslaskelma
      </div>

      {/* Area summary */}
      <div className="p-3 bg-blue-50 rounded-xl border border-blue-100">
        <div className="flex justify-between items-center">
          <span className="text-sm text-blue-700">Nettoseinäala</span>
          <span className="text-lg font-bold text-blue-800">
            {wallAreaM2.toFixed(1)} m²
          </span>
        </div>
      </div>

      {/* Pricing inputs */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Yksikköhinta (€/m²)
          </label>
          <input
            type="number"
            min="0"
            step="0.5"
            {...register("unitPrice", { required: true, min: 0 })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {errors.unitPrice && (
            <p className="text-xs text-red-500 mt-0.5">Pakollinen</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 mb-1">
            Kiinteät kulut (€)
          </label>
          <input
            type="number"
            min="0"
            step="10"
            {...register("fixedCosts", { min: 0 })}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Calculation breakdown */}
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1 text-sm">
        <div className="flex justify-between text-slate-600">
          <span>
            {wallAreaM2.toFixed(1)} m² × {Number(unitPrice).toFixed(2)} €/m²
          </span>
          <span>{(wallAreaM2 * Number(unitPrice)).toFixed(2)} €</span>
        </div>
        <div className="flex justify-between text-slate-600">
          <span>Kiinteät kulut</span>
          <span>{Number(fixedCosts).toFixed(2)} €</span>
        </div>
        <div className="flex justify-between font-bold text-slate-900 border-t border-slate-200 pt-1 mt-1">
          <span>Arvioitu hinta yhteensä</span>
          <span className="text-blue-700">{totalPrice.toFixed(2)} €</span>
        </div>
      </div>

      {/* Optional fields */}
      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Lisätiedot / muistiinpanot
        </label>
        <textarea
          {...register("notes")}
          rows={2}
          placeholder="Esim. arkkitehtoniset yksityiskohdat, erikoistyöt..."
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-600 mb-1">
          Projekti-ID (valinnainen)
        </label>
        <input
          type="text"
          {...register("projectId")}
          placeholder="UUID olemassa olevasta projektista"
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      <button
        type="submit"
        disabled={isSaving || saved}
        className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-green-600 text-white rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
      >
        <Save className="w-4 h-4" />
        {isSaving ? "Tallennetaan..." : saved ? "Tallennettu!" : "Tallenna tarjous"}
      </button>
    </form>
  );
}
