import { Dialog } from "@base-ui/react/dialog";
import React from "react";
import { copy } from "../../../lib/copy";
import { formatUsdCurrency, toFiniteNumber } from "../../../lib/format";
import { Button } from "../../openai/components";

function formatUsdValue(value) {
  if (!Number.isFinite(value)) return copy("shared.placeholder.short");
  const formatted = formatUsdCurrency(value.toFixed(6));
  return formatted === "-" ? copy("shared.placeholder.short") : formatted;
}

function formatModelCost(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  if (value < 0.01) return "<$0.01";
  return formatUsdCurrency(value.toFixed(2));
}

export const CostAnalysisModal = React.memo(function CostAnalysisModal({
  isOpen,
  onClose,
  fleetData = [],
}) {
  if (!isOpen) return null;

  const percentSymbol = copy("shared.unit.percent");

  const normalizedFleet = (Array.isArray(fleetData) ? fleetData : []).map((fleet) => {
    const usdValue = toFiniteNumber(fleet?.usd);
    const normalizedUsd = Number.isFinite(usdValue) ? usdValue : 0;
    const models = Array.isArray(fleet?.models) ? fleet.models : [];
    return {
      label: fleet?.label ? String(fleet.label) : "",
      usdValue: normalizedUsd,
      usdLabel: formatUsdValue(normalizedUsd),
      models: models.map((model) => {
        const shareValue = toFiniteNumber(model?.share);
        const shareLabel = Number.isFinite(shareValue)
          ? `${shareValue}${percentSymbol}`
          : copy("shared.placeholder.short");
        const costValue = toFiniteNumber(model?.cost);
        const costLabel = formatModelCost(costValue);
        return {
          id: model?.id ? String(model.id) : "",
          name: model?.name ? String(model.name) : "",
          shareLabel,
          costLabel,
        };
      }),
    };
  });

  const totalUsd = normalizedFleet.reduce((acc, fleet) => acc + fleet.usdValue, 0);
  const totalUsdLabel = formatUsdValue(totalUsd);

  return (
    <Dialog.Root
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="cost-modal-backdrop" data-cost-analysis-backdrop="true" />
        <Dialog.Viewport className="fixed inset-0 z-[101] flex items-center justify-center p-4">
          <Dialog.Popup className="cost-modal-popup w-full max-w-xl rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 shadow-oai-lg overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-oai-gray-200 dark:border-oai-gray-800 flex items-center justify-between">
              <Dialog.Title className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-300 uppercase tracking-wide">
                {copy("dashboard.cost_breakdown.title")}
              </Dialog.Title>
              <Dialog.Close
                type="button"
                className="w-7 h-7 flex items-center justify-center rounded-md text-oai-gray-400 dark:text-oai-gray-500 hover:text-oai-gray-600 dark:hover:text-oai-gray-300 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-800 transition-colors"
                aria-label={copy("dashboard.cost_breakdown.close")}
              >
                ✕
              </Dialog.Close>
            </div>

            {/* Total */}
            <div className="px-6 py-6 text-center border-b border-oai-gray-100 dark:border-oai-gray-800">
              <div className="text-xs text-oai-gray-400 dark:text-oai-gray-400 uppercase tracking-wide mb-2">
                {copy("dashboard.cost_breakdown.total_label")}
              </div>
              <div className="text-3xl font-bold text-oai-brand tabular-nums tracking-tight">
                {totalUsdLabel}
              </div>
            </div>

            {/* Fleet List */}
            <div className="px-6 py-4 max-h-[45vh] overflow-y-auto oai-scrollbar">
              <div className="space-y-5">
                {normalizedFleet.map((fleet, index) => (
                  <div key={`${fleet.label}-${index}`}>
                    <div className="flex justify-between items-baseline pb-2 mb-2 border-b border-oai-gray-100 dark:border-oai-gray-800">
                      <span className="text-sm font-semibold text-oai-black dark:text-oai-white">
                        {fleet.label}
                      </span>
                      <span className="text-sm font-semibold text-oai-brand tabular-nums">
                        {fleet.usdLabel}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {fleet.models.map((model, modelIndex) => {
                        const modelKey = model?.id || `${model.name}-${modelIndex}`;
                        return (
                          <div
                            key={modelKey}
                            className="flex justify-between items-center py-1 text-xs"
                          >
                            <span className="text-oai-gray-600 dark:text-oai-gray-300">
                              {model.name}
                              <span className="ml-1.5 text-oai-gray-400 dark:text-oai-gray-500 tabular-nums">
                                {model.shareLabel}
                              </span>
                            </span>
                            {model.costLabel ? (
                              <span className="text-oai-gray-600 dark:text-oai-gray-300 font-medium tabular-nums">
                                {model.costLabel}
                              </span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-oai-gray-200 dark:border-oai-gray-800 flex justify-between items-center">
              <span className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                {copy("dashboard.cost_breakdown.footer")}
              </span>
              <Dialog.Close render={<Button variant="secondary" size="sm" />}>
                {copy("dashboard.cost_breakdown.close")}
              </Dialog.Close>
            </div>
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
});
