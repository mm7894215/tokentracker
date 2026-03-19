import React from "react";
import { motion, useReducedMotion } from "motion/react";
import { copy } from "../../../lib/copy";

function interpolateQuantile(sortedValues, ratio) {
  if (!Array.isArray(sortedValues) || sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const index = (sortedValues.length - 1) * ratio;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  const weight = index - lower;
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * weight;
}

export function getTrendMonitorScale(values) {
  const finiteValues = Array.isArray(values)
    ? values.filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b)
    : [];

  if (finiteValues.length === 0) {
    return {
      rawMax: 0,
      effectiveMax: 1,
      clippedValues: Array.isArray(values) ? values.map(() => 0) : [],
    };
  }

  const rawMax = finiteValues.at(-1) ?? 0;
  let effectiveMax = rawMax;

  if (finiteValues.length >= 4) {
    const q1 = interpolateQuantile(finiteValues, 0.25);
    const q3 = interpolateQuantile(finiteValues, 0.75);
    const iqr = Math.max(q3 - q1, 0);
    const upperWhisker = q3 + iqr * 1.5;
    const hasOutlier = rawMax > upperWhisker;

    if (hasOutlier) {
      effectiveMax = Math.max(upperWhisker, q3, 1);
    }
  }

  return {
    rawMax,
    effectiveMax: Math.max(effectiveMax, 1),
    clippedValues: Array.isArray(values)
      ? values.map((value) => {
          if (!Number.isFinite(value) || value <= 0) return 0;
          return Math.min(value, Math.max(effectiveMax, 1));
        })
      : [],
  };
}

// Individual animated bar
function TrendBar({ value, displayValue, scale, index, row, totalBars }) {
  const shouldReduceMotion = useReducedMotion();
  const heightPercent = scale.effectiveMax > 0 ? (displayValue / scale.effectiveMax) * 100 : 0;
  const barHeight = `${Math.max(heightPercent, 2)}%`;
  const isMissing = row?.missing;
  const isFuture = row?.future;
  
  // Determine bar color based on value relative to max
  const intensity = scale.rawMax > 0 ? value / scale.rawMax : 0;
  const isHigh = intensity > 0.75;
  const isMedium = intensity > 0.4 && intensity <= 0.75;
  
  // Dynamic border radius based on bar width (fewer bars = wider bars = larger radius)
  const borderRadius = totalBars <= 7 ? "6px" : totalBars <= 14 ? "4px" : "3px";

  return (
    <motion.div
      className="group relative flex-1 self-stretch"
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.4,
        delay: shouldReduceMotion ? 0 : index * 0.03,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      style={{ originY: 1 }}
    >
      <div className="absolute inset-x-0 bottom-0" style={{ height: barHeight }}>
        <div
          data-trend-bar="true"
          className="h-full w-full cursor-pointer relative overflow-hidden transition-all duration-200 group-hover:brightness-110"
          style={{
            minHeight: value > 0 ? "4px" : "2px",
            opacity: isMissing || isFuture ? 0.2 : 1,
            borderRadius: `${borderRadius} ${borderRadius} 0 0`,
            background: value > 0
              ? isHigh
                ? "linear-gradient(180deg, #34d399 0%, #059669 50%, #047857 100%)"
                : isMedium
                  ? "linear-gradient(180deg, #6ee7b7 0%, #10b981 50%, #059669 100%)"
                  : "linear-gradient(180deg, #a7f3d0 0%, #34d399 50%, #10b981 100%)"
              : "var(--oai-gray-100)",
          }}
          title={`${value.toLocaleString()}`}
        >
          {/* Shine effect */}
          {value > 0 && !shouldReduceMotion && (
            <div 
              className="absolute inset-0 opacity-20"
              style={{
                background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)",
                transform: "skewX(-20deg) translateX(-100%)",
                animation: "shine 3s ease-in-out infinite",
              }}
            />
          )}
        </div>
        {/* Tooltip */}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2 py-1 bg-oai-black text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-20">
          {value.toLocaleString()}
        </div>
      </div>
    </motion.div>
  );
}

export function TrendMonitor({
  rows,
  from,
  to,
  period,
  timeZoneLabel,
  showTimeZoneLabel = true,
  className = "",
}) {
  const series = Array.isArray(rows) && rows.length ? rows : [];

  const seriesValues = series.map((row) => {
    if (row?.missing || row?.future) return 0;
    const raw = row?.billable_total_tokens ?? row?.total_tokens ?? row?.value;
    if (raw == null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  });
  const scale = getTrendMonitorScale(seriesValues);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.3 }}
      className={`rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-5 ${className}`}
    >
      <div className="mb-3">
        <h3 className="text-sm font-medium text-oai-gray-500 dark:text-oai-gray-400 uppercase tracking-wide">
          {copy("trend.monitor.label")}
        </h3>
        {showTimeZoneLabel && timeZoneLabel && (
          <p className="text-sm text-oai-gray-400 dark:text-oai-gray-500 mt-0.5">{timeZoneLabel}</p>
        )}
      </div>
      <div className="space-y-3">
        <div className="relative">
          {/* Grid lines */}
          <div className="absolute inset-0 flex flex-col justify-between pointer-events-none">
            {[0, 25, 50, 75, 100].map((pct) => (
              <div
                key={pct}
                className="w-full border-t border-oai-gray-100 dark:border-oai-gray-800"
                style={{ top: `${100 - pct}%` }}
              />
            ))}
          </div>

          {/* Bars */}
          <div className="h-40 flex items-end gap-1 relative z-0">
            {seriesValues.length > 0 ? (
              seriesValues.map((value, index) => (
                <TrendBar
                  key={index}
                  value={value}
                  displayValue={scale.clippedValues[index] ?? 0}
                  scale={scale}
                  index={index}
                  row={series[index]}
                  totalBars={seriesValues.length}
                />
              ))
            ) : (
              <EmptyTrendState />
            )}
          </div>
        </div>

        {from && to && (
          <div className="flex justify-between text-xs text-oai-gray-500 dark:text-oai-gray-400 font-medium pt-2 border-t border-oai-gray-100 dark:border-oai-gray-800">
            <span>{from}</span>
            <span>{to}</span>
          </div>
        )}
      </div>

      {/* Shine animation keyframes */}
      <style>{`
        @keyframes shine {
          0% { transform: skewX(-20deg) translateX(-100%); }
          50%, 100% { transform: skewX(-20deg) translateX(200%); }
        }
      `}</style>
    </motion.div>
  );
}

// Preview data for empty state - shows what the chart will look like with real data
const PREVIEW_DATA = [
  12, 18, 15, 24, 32, 28, 45, 38, 52, 48, 65, 72,
  58, 82, 76, 95, 88, 112, 98, 125, 142, 128, 155, 168,
  145, 172, 188, 165, 192, 205, 182, 218, 235, 198, 242, 258,
];

function PreviewTrendBar({ value, max, index }) {
  const shouldReduceMotion = useReducedMotion();
  const heightPercent = max > 0 ? (value / max) * 100 : 0;

  return (
    <motion.div
      className="relative flex-1 self-stretch"
      initial={{ opacity: 0, scaleY: 0 }}
      animate={{ opacity: 1, scaleY: 1 }}
      transition={{
        duration: shouldReduceMotion ? 0 : 0.4,
        delay: shouldReduceMotion ? 0 : index * 0.02,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      style={{ originY: 1 }}
    >
      <div
        className="absolute inset-x-0 bottom-0 rounded-t"
        style={{
          height: `${Math.max(heightPercent, 2)}%`,
          minHeight: "4px",
          background: "linear-gradient(180deg, rgba(16, 185, 129, 0.35) 0%, rgba(5, 150, 105, 0.25) 100%)",
        }}
      />
    </motion.div>
  );
}

function EmptyTrendState() {
  const shouldReduceMotion = useReducedMotion();
  const maxValue = Math.max(...PREVIEW_DATA);

  return (
    <div className="flex-1 flex flex-col relative">
      {/* Preview Chart */}
      <div className="h-40 flex items-end gap-1 relative z-0">
        {PREVIEW_DATA.map((value, index) => (
          <PreviewTrendBar key={index} value={value} max={maxValue} index={index} />
        ))}
      </div>

      {/* Overlay with message */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-t from-white/80 via-white/40 to-transparent dark:from-oai-gray-900/80 dark:via-oai-gray-900/40"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: shouldReduceMotion ? 0 : 0.6 }}
      >
        <motion.div
          className="text-center"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: shouldReduceMotion ? 0 : 0.8 }}
        >
          <div className="w-10 h-10 mb-2 mx-auto rounded-full bg-oai-gray-100 dark:bg-oai-gray-800 flex items-center justify-center">
            <svg className="w-5 h-5 text-oai-gray-400 dark:text-oai-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 3v18h18" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16l4-4 4 4 6-6" />
            </svg>
          </div>
          <p className="text-sm font-medium text-oai-gray-600 dark:text-oai-gray-300">
            Your trend will appear here
          </p>
          <p className="text-xs text-oai-gray-400 dark:text-oai-gray-500 mt-1">
            Keep coding to see your usage pattern
          </p>
        </motion.div>
      </motion.div>
    </div>
  );
}