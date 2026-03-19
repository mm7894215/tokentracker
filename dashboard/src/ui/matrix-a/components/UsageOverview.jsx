import React, { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Card, Button, Counter } from "../../openai/components";
import { FadeIn } from "../../foundation/FadeIn.jsx";
import { useTheme } from "../../../hooks/useTheme.js";

function normalizePeriods(periods) {
  if (!Array.isArray(periods)) return [];
  return periods.map((p) => {
    if (typeof p === "string") {
      return { key: p, label: p.toUpperCase() };
    }
    return { key: p.key, label: p.label || String(p.key).toUpperCase() };
  });
}

function parseAnimatedCounterValue(displayValue) {
  if (typeof displayValue !== "string") return null;
  const match = displayValue.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

// Provider color mapping for visual distinction
const PROVIDER_COLORS = {
  CODEX: "#10b981",     // emerald-500
  CLAUDE: "#8b5cf6",    // violet-500
  OPENCODE: "#f59e0b",  // amber-500
  GEMINI: "#3b82f6",    // blue-500
};

function getProviderColor(label, index) {
  const normalized = label?.toUpperCase?.() || "";
  return PROVIDER_COLORS[normalized] || `hsl(${150 + index * 40}, 60%, 45%)`;
}

// Refresh button with rotation animation
function RefreshButton({ loading, onClick }) {
  const shouldReduceMotion = useReducedMotion();

  return (
    <Button variant="secondary" size="sm" disabled={loading} onClick={onClick} className="w-8 p-0">
      <motion.span
        animate={loading ? { rotate: 360 } : { rotate: 0 }}
        transition={
          loading && !shouldReduceMotion
            ? { duration: 1, repeat: Infinity, ease: "linear" }
            : { duration: 0.3 }
        }
        style={{ display: "inline-block" }}
      >
        ↻
      </motion.span>
    </Button>
  );
}

export function UsageOverview({
  period,
  periods,
  onPeriodChange,
  summaryValue,
  summaryLabel,
  summaryCostValue,
  onCostInfo,
  fleetData = [],
  onRefresh,
  loading,
  className = "",
}) {
  const tabs = normalizePeriods(periods);
  const summaryCounterValue = parseAnimatedCounterValue(String(summaryValue ?? ""));
  const showAnimatedSummary = summaryCounterValue != null;
  const [expandedProvider, setExpandedProvider] = useState(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  const gradientFrom = isDark ? "rgba(10,10,10,0.98)" : "rgba(255,255,255,0.96)";
  const gradientTo = isDark ? "rgba(10,10,10,0)" : "rgba(255,255,255,0)";

  // FleetData is already grouped by provider
  const providers = fleetData.filter((f) => f.models?.length > 0);

  return (
    <FadeIn delay={0.2}>
      <Card className={className}>
        {/* Header: Period Tabs + Refresh */}
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex gap-1">
            {tabs.map((p) => (
              <button
                key={p.key}
                type="button"
                className={`text-xs font-medium px-3 py-1.5 rounded-md transition-colors ${
                  period === p.key
                    ? "text-oai-black dark:text-oai-white bg-oai-gray-100 dark:bg-oai-gray-800"
                    : "text-oai-gray-500 dark:text-oai-gray-400 hover:text-oai-black dark:hover:text-oai-white hover:bg-oai-gray-50 dark:hover:bg-oai-gray-800"
                }`}
                onClick={() => onPeriodChange?.(p.key)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {onRefresh && (
            <RefreshButton loading={loading} onClick={onRefresh} />
          )}
        </div>

        {/* Main Stats */}
        <div className="text-center mb-8">
          <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400 uppercase tracking-wider mb-3">{summaryLabel}</div>
          <div className="text-6xl md:text-7xl font-bold text-oai-black dark:text-oai-white tracking-tight tabular-nums">
            {showAnimatedSummary ? (
              <Counter
                value={summaryCounterValue}
                displayValue={summaryValue}
                fontSize={72}
                padding={6}
                gap={1}
                textColor="var(--oai-black, #111827)"
                fontWeight={700}
                gradientHeight={isDark ? 0 : 8}
                gradientFrom={gradientFrom}
                gradientTo={gradientTo}
                counterStyle={{ paddingLeft: 0, paddingRight: 0, gap: 0 }}
                digitStyle={{ width: "0.88ch" }}
              />
            ) : (
              summaryValue
            )}
          </div>
          {summaryCostValue && (
            <div className="flex items-center justify-center gap-2 mt-4">
              <span className="text-xl font-bold text-oai-brand">{summaryCostValue}</span>
              {onCostInfo && (
                <button
                  type="button"
                  onClick={onCostInfo}
                  className="w-5 h-5 rounded-full bg-oai-gray-100 dark:bg-oai-gray-800 text-oai-gray-500 dark:text-oai-gray-400 hover:bg-oai-brand hover:text-white text-xs transition-colors"
                  aria-label="Cost info"
                >
                  ?
                </button>
              )}
            </div>
          )}
        </div>

        {/* Provider Distribution */}
        {providers.length > 0 && (
          <div className="space-y-6">
            {/* Distribution Bar */}
            <div className="h-1.5 w-full bg-oai-gray-100 dark:bg-oai-gray-800 rounded-full overflow-hidden flex">
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                return (
                  <motion.div
                    key={provider.label}
                    initial={{ width: 0 }}
                    animate={{ width: `${provider.totalPercent}%` }}
                    transition={{ duration: 0.6, delay: 0.3 + idx * 0.1 }}
                    className="h-full"
                    style={{ backgroundColor: color }}
                    title={`${provider.label}: ${provider.totalPercent}%`}
                  />
                );
              })}
            </div>

            {/* Provider Cards */}
            <div className="flex flex-wrap gap-3">
              {providers.map((provider, idx) => {
                const color = getProviderColor(provider.label, idx);
                const isExpanded = expandedProvider === provider.label;

                return (
                  <button
                    key={provider.label}
                    onClick={() => setExpandedProvider(isExpanded ? null : provider.label)}
                    className={`flex-1 min-w-[140px] text-left p-3 rounded-lg border transition-colors duration-200 ${
                      isExpanded
                        ? "border-oai-gray-300 dark:border-oai-gray-600 bg-oai-gray-50 dark:bg-oai-gray-800"
                        : "border-oai-gray-200 dark:border-oai-gray-700 hover:border-oai-gray-300 dark:hover:border-oai-gray-600"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="text-sm font-medium text-oai-black dark:text-oai-white">{provider.label}</span>
                    </div>
                    <div className="text-lg font-semibold text-oai-black dark:text-oai-white tabular-nums">
                      {provider.totalPercent}%
                    </div>
                    <div className="text-xs text-oai-gray-400 dark:text-oai-gray-500 mt-0.5">
                      {provider.models.length} models
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Expanded Provider Details */}
            {expandedProvider && (
              <div
                className="border border-oai-gray-200 dark:border-oai-gray-700 rounded-lg p-4 bg-oai-gray-50/30 dark:bg-oai-gray-800/30 overflow-hidden"
              >
                {providers
                  .filter((p) => p.label === expandedProvider)
                  .map((provider) => {
                    const color = getProviderColor(provider.label, 0);
                    const sortedModels = [...provider.models].sort(
                      (a, b) => (b.share || 0) - (a.share || 0)
                    );

                    return (
                      <div key={provider.label}>
                        <div className="flex items-center gap-2 mb-3">
                          <div
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: color }}
                          />
                          <span className="text-sm font-medium text-oai-black dark:text-oai-white">{provider.label}</span>
                          <span className="text-xs text-oai-gray-400 dark:text-oai-gray-500">
                            {provider.totalPercent}%
                          </span>
                        </div>

                        <div className="space-y-2">
                          {sortedModels.map((model) => (
                            <div
                              key={model.id || model.name}
                              className="flex items-center gap-3"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 mb-1">
                                  <span className="text-sm text-oai-gray-700 dark:text-oai-gray-300 truncate">
                                    {model.name}
                                  </span>
                                  <span className="text-sm font-medium text-oai-black dark:text-oai-white tabular-nums shrink-0">
                                    {model.share}%
                                  </span>
                                </div>
                                <div className="h-1 bg-oai-gray-200 dark:bg-oai-gray-700 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                      width: `${model.share}%`,
                                      backgroundColor: color,
                                      opacity: 0.7,
                                    }}
                                  />
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}

          </div>
        )}
      </Card>
    </FadeIn>
  );
}
