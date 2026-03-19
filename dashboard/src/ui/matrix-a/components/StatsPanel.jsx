import React from "react";
import { copy } from "../../../lib/copy";
import { formatCompactNumber } from "../../../lib/format";
import { Card, Badge } from "../../openai/components";
import { FadeIn } from "../../foundation/FadeIn.jsx";
import { HoverCard, HoverScale } from "../../foundation/HoverCard.jsx";
import { CelebrationBadge } from "../../foundation/CelebrationBadge.jsx";

function normalizeBadgePart(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toTitleWords(value) {
  const normalized = normalizeBadgePart(value);
  if (!normalized) return "";
  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function buildSubscriptionItems(subscriptions) {
  if (!Array.isArray(subscriptions)) return [];
  const deduped = new Map();
  for (const entry of subscriptions) {
    if (!entry || typeof entry !== "object") continue;
    const toolRaw = normalizeBadgePart(entry.tool);
    const planRaw = normalizeBadgePart(entry.planType) || normalizeBadgePart(entry.plan_type);
    if (!toolRaw || !planRaw) continue;
    const tool = toTitleWords(toolRaw) || toolRaw;
    const plan = toTitleWords(planRaw) || planRaw;
    deduped.set(`${toolRaw.toLowerCase()}::${planRaw.toLowerCase()}`, { tool, plan });
  }
  return Array.from(deduped.values());
}

export function StatsPanel({
  rankLabel,
  streakDays,
  subscriptions = [],
  rolling,
  topModels = [],
  className = "",
}) {
  const placeholder = copy("shared.placeholder.short");
  const percentSymbol = copy("shared.unit.percent");

  const rankValue = rankLabel ?? copy("identity_card.rank_placeholder");
  const streakDaysNum = Number.isFinite(Number(streakDays)) ? Number(streakDays) : 0;
  const streakValue = streakDaysNum
    ? copy("identity_card.streak_value", { days: streakDaysNum })
    : copy("identity_card.rank_placeholder");
  const subscriptionItems = buildSubscriptionItems(subscriptions);

  const compactConfig = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
  };
  const formatValue = (value) => {
    if (value == null) return placeholder;
    const formatted = formatCompactNumber(value, compactConfig);
    return formatted === "-" ? placeholder : formatted;
  };

  const displayModels = topModels.slice(0, 3);

  return (
    <FadeIn delay={0.1}>
      <HoverCard className={className} scale={1.01} y={-2}>
        <Card className="h-full">
          {/* Rolling Stats - 4个badge撑满宽度 */}
          <div className="grid grid-cols-4 gap-2">
            <HoverLift className="flex flex-col items-center justify-center px-2 py-2 oai-bg-elevated rounded-lg cursor-default">
              <span className="text-sm font-semibold text-oai-black dark:text-oai-white tabular-nums transition-colors duration-200">
                {formatValue(rolling?.last_7d?.totals?.billable_total_tokens)}
              </span>
              <span className="oai-text-caption oai-text-muted mt-0.5">7d</span>
            </HoverLift>
            <HoverLift className="flex flex-col items-center justify-center px-2 py-2 oai-bg-elevated rounded-lg cursor-default">
              <span className="text-sm font-semibold text-oai-black dark:text-oai-white tabular-nums transition-colors duration-200">
                {formatValue(rolling?.last_30d?.totals?.billable_total_tokens)}
              </span>
              <span className="oai-text-caption oai-text-muted mt-0.5">30d</span>
            </HoverLift>
            <HoverLift className="flex flex-col items-center justify-center px-2 py-2 oai-bg-elevated rounded-lg cursor-default">
              <span className="text-sm font-semibold text-oai-black dark:text-oai-white tabular-nums transition-colors duration-200">
                {formatValue(rolling?.last_30d?.avg_per_active_day)}
              </span>
              <span className="oai-text-caption oai-text-muted mt-0.5">avg</span>
            </HoverLift>
            <HoverLift className="flex flex-col items-center justify-center px-2 py-2 oai-bg-elevated rounded-lg cursor-default">
              <span className="text-sm font-semibold text-oai-black dark:text-oai-white tabular-nums transition-colors duration-200">
                {formatValue(rolling?.last_30d?.totals?.conversation_count)}
              </span>
              <span className="oai-text-caption oai-text-muted mt-0.5">convs</span>
            </HoverLift>
          </div>

          {/* Top Models - 带设计感的排名 */}
          {displayModels.length > 0 && (
            <div className="mt-4 pt-3 border-t border-oai-gray-100 dark:border-oai-gray-800 transition-colors duration-200">
              {displayModels.map((row, index) => {
                const name = row?.name ? String(row.name) : placeholder;
                const percent = row?.percent ? String(row.percent) : "";
                const isLast = index === displayModels.length - 1;
                const rankNum = index + 1;

                // 排名颜色：1=gold, 2=silver, 3=bronze
                const rankColors = [
                  "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
                  "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
                  "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
                ];
                const rankColor = rankColors[index] || "bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400";

                return (
                  <div
                    key={row.id || name}
                    className={`flex items-center py-2.5 ${!isLast ? "border-b border-oai-gray-50 dark:border-oai-gray-800" : ""} transition-colors duration-200`}
                  >
                    {/* 排名徽章 */}
                    <HoverScale scale={1.2}>
                      <CelebrationBadge
                        trigger={index === 0}
                        className={`w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${rankColor} flex-shrink-0 transition-colors duration-200`}
                      >
                        {rankNum}
                      </CelebrationBadge>
                    </HoverScale>
                    <span className="flex-1 text-sm text-oai-gray-700 dark:text-oai-gray-300 truncate px-3 transition-colors duration-200" title={name}>
                      {name}
                    </span>
                    <span className="text-sm font-semibold text-oai-black dark:text-oai-white tabular-nums flex-shrink-0 transition-colors duration-200">
                      {percent}{percentSymbol}
                    </span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Subscriptions */}
          {subscriptionItems.length > 0 && (
            <div className="mt-3 pt-3 border-t border-oai-gray-100 dark:border-oai-gray-800 flex flex-wrap gap-1.5 transition-colors duration-200">
              {subscriptionItems.map((entry, index) => (
                <Badge
                  key={`${entry.tool}:${entry.plan}:${index}`}
                  variant="secondary"
                  size="sm"
                >
                  {entry.tool} {entry.plan}
                </Badge>
              ))}
            </div>
          )}

          {/* Footer: Started + Active days - 弱化显示 */}
          <div className="mt-4 pt-3 border-t border-oai-gray-100 dark:border-oai-gray-800 flex items-center justify-between text-xs text-oai-gray-400 dark:text-oai-gray-500 transition-colors duration-200">
            <div className="flex items-center gap-1.5">
              <span>{copy("identity_card.rank_label")}</span>
              <span className="text-oai-gray-500 dark:text-oai-gray-400 tabular-nums transition-colors duration-200">{rankValue}</span>
            </div>
            <div className="flex items-center gap-1">
              <span>{copy("identity_card.streak_label")}</span>
              <span className="text-oai-gray-500 dark:text-oai-gray-400 tabular-nums transition-colors duration-200">{streakValue}</span>
              {streakDaysNum >= 7 && (
                <CheckBadge />
              )}
            </div>
          </div>
        </Card>
      </HoverCard>
    </FadeIn>
  );
}

// Simple check badge for active streak
function CheckBadge() {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 transition-colors duration-200">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    </span>
  );
}

// Inline HoverLift component for stats badges
function HoverLift({ children, className = "" }) {
  return (
    <div className={`transition-transform duration-200 hover:-translate-y-0.5 ${className}`}>
      {children}
    </div>
  );
}
