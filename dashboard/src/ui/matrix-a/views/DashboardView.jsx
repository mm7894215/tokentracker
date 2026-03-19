import React from "react";
import { motion } from "motion/react";
import { Shell, Card, Button } from "../../openai/components";
import { CostAnalysisModal } from "../components/CostAnalysisModal.jsx";
import { DataDetails } from "../components/DataDetails.jsx";
import { StatsPanel } from "../components/StatsPanel.jsx";
import { UsageOverview } from "../components/UsageOverview.jsx";
import { TrendMonitor } from "../components/TrendMonitor.jsx";
import { FadeIn } from "../../foundation/FadeIn.jsx";

export function DashboardView(props) {
  const {
    copy,
    screenshotMode,
    publicViewInvalid,
    publicViewInvalidTitle,
    publicViewInvalidBody,
    showExpiredGate,
    showAuthGate,
    screenshotTitleLine1,
    screenshotTitleLine2,
    identityDisplayName,
    identityStartDate,
    activeDays,
    identitySubscriptions,
    identityScrambleDurationMs,
    projectUsageEntries,
    projectUsageLimit,
    setProjectUsageLimit,
    topModels,
    signedIn,
    publicMode,
    shouldShowInstall,
    installPrompt,
    handleCopyInstall,
    installCopied,
    installInitCmdDisplay,
    publicViewTitle,
    handleTogglePublicView,
    publicViewBusy,
    publicViewEnabled,
    publicViewCopyButtonLabel,
    handleCopyPublicView,
    trendRowsForDisplay,
    trendFromForDisplay,
    trendToForDisplay,
    period,
    trendTimeZoneLabel,
    activityHeatmapBlock,
    isCapturing,
    handleShareToX,
    screenshotTwitterButton,
    screenshotTwitterHint,
    periodsForDisplay,
    setSelectedPeriod,
    summaryLabel,
    summaryValue,
    summaryCostValue,
    rollingUsage,
    costInfoEnabled,
    openCostModal,
    costModalOpen,
    closeCostModal,
    allowBreakdownToggle,
    refreshAll,
    usageLoadingState,
    fleetData,
    hasDetailsActual,
    dailyEmptyPrefix,
    installSyncCmd,
    dailyEmptySuffix,
    detailsColumns,
    ariaSortFor,
    toggleSort,
    sortIconFor,
    pagedDetails,
    dailyBreakdownRows,
    dailyBreakdownColumns,
    dailyBreakdownAriaSortFor,
    dailyBreakdownSortIconFor,
    dailyBreakdownDateKey,
    detailsDateKey,
    renderDetailDate,
    renderDailyBreakdownDate,
    renderDetailCell,
    DETAILS_PAGED_PERIODS,
    detailsPageCount,
    detailsPage,
    setDetailsPage,
  } = props;

  // Header 和 Footer 已简化
  const header = null;
  const footer = null;

  return (
    <>
      <Shell
        hideHeader={screenshotMode}
        header={header}
        footer={!screenshotMode ? footer : null}
        className={screenshotMode ? "screenshot-mode" : ""}
      >
        {publicViewInvalid ? (
          <div className="mb-6">
            <Card title={publicViewInvalidTitle} className="border-oai-gray-200 dark:border-oai-gray-800">
              <p className="text-sm text-oai-gray-500 dark:text-oai-gray-400 mt-0">{publicViewInvalidBody}</p>
            </Card>
          </div>
        ) : null}
        {(showExpiredGate || showAuthGate) ? null : (
          <>
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              <div className="lg:col-span-4 flex flex-col gap-4 min-w-0">
                {screenshotMode ? (
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <span className="text-3xl md:text-4xl font-semibold text-oai-black dark:text-oai-white tracking-tight leading-none">
                        {screenshotTitleLine1}
                      </span>
                      <span className="text-2xl md:text-3xl font-semibold text-oai-black dark:text-oai-white tracking-tight leading-none">
                        {screenshotTitleLine2}
                      </span>
                    </div>
                  </div>
                ) : null}
                <StatsPanel
                  title={copy("dashboard.identity.title")}
                  subtitle={copy("dashboard.identity.subtitle")}
                  rankLabel={identityStartDate ?? copy("identity_card.rank_placeholder")}
                  streakDays={activeDays}
                  subscriptions={identitySubscriptions}
                  rolling={rollingUsage}
                  topModels={topModels}
                />

                {shouldShowInstall ? (
                  <FadeIn delay={0.25}>
                    <div className="rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-3">
                      <div className="text-xs text-oai-gray-500 dark:text-oai-gray-400 mb-1.5">{installPrompt}</div>
                      <motion.button
                        onClick={handleCopyInstall}
                        whileHover={{ scale: 1.01 }}
                        whileTap={{ scale: 0.99 }}
                        className="w-full flex items-center justify-between px-3 py-2 bg-oai-gray-50 dark:bg-oai-gray-800 hover:bg-oai-gray-100 dark:hover:bg-oai-gray-700 rounded-lg transition-colors"
                      >
                        <code className="text-xs font-mono text-oai-gray-700 dark:text-oai-gray-300">{installInitCmdDisplay}</code>
                        <motion.span
                          key={installCopied ? "copied" : "copy"}
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-xs text-oai-brand"
                        >
                          {installCopied ? "Copied ✓" : "Copy"}
                        </motion.span>
                      </motion.button>
                    </div>
                  </FadeIn>
                ) : null}

                {!screenshotMode && signedIn && !publicMode ? (
                  <FadeIn delay={0.3}>
                    <div className="rounded-xl border border-oai-gray-200 dark:border-oai-gray-800 bg-white dark:bg-oai-gray-900 p-3 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <motion.button
                          type="button"
                          onClick={handleTogglePublicView}
                          disabled={publicViewBusy}
                          whileTap={{ scale: 0.95 }}
                          className={`relative inline-flex h-4 w-7 items-center px-0.5 transition-colors rounded-full ${
                            publicViewEnabled ? "bg-oai-brand" : "bg-oai-gray-300 dark:bg-oai-gray-600"
                          } disabled:opacity-50`}
                        >
                          <motion.span
                            initial={false}
                            animate={{ x: publicViewEnabled ? 12 : 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                            className="inline-block h-3 w-3 bg-white rounded-full"
                          />
                        </motion.button>
                        <motion.span
                          key={publicViewEnabled ? "public" : "private"}
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          className="text-xs text-oai-gray-600 dark:text-oai-gray-400"
                        >
                          {publicViewEnabled ? "Public" : "Private"}
                        </motion.span>
                      </div>
                      <motion.button
                        onClick={handleCopyPublicView}
                        disabled={!publicViewEnabled || publicViewBusy}
                        whileHover={{ scale: publicViewEnabled ? 1.05 : 1 }}
                        whileTap={{ scale: publicViewEnabled ? 0.95 : 1 }}
                        className="text-xs text-oai-brand hover:text-oai-brand-dark disabled:text-oai-gray-300 dark:disabled:text-oai-gray-600 transition-colors"
                      >
                        {publicViewCopyButtonLabel}
                      </motion.button>
                    </div>
                  </FadeIn>
                ) : null}

                {activityHeatmapBlock && (
                  <FadeIn delay={0.4}>
                    {activityHeatmapBlock}
                  </FadeIn>
                )}

                {!screenshotMode ? (
                  <TrendMonitor
                    rows={trendRowsForDisplay}
                    from={trendFromForDisplay}
                    to={trendToForDisplay}
                    period={period}
                    timeZoneLabel={trendTimeZoneLabel}
                    showTimeZoneLabel={false}
                  />
                ) : null}
                {screenshotMode ? (
                  <div
                    className="mt-4 flex flex-col items-center gap-2"
                    data-screenshot-exclude="true"
                    style={isCapturing ? { display: "none" } : undefined}
                  >
                    <Button
                      type="button"
                      onClick={handleShareToX}
                      variant="primary"
                      size="lg"
                      disabled={isCapturing}
                    >
                      {screenshotTwitterButton}
                    </Button>
                    <span className="text-sm text-oai-gray-500 dark:text-oai-gray-400">
                      {screenshotTwitterHint}
                    </span>
                  </div>
                ) : null}
              </div>

              <div className="lg:col-span-8 flex flex-col gap-4 min-w-0">
                <UsageOverview
                  period={period}
                  periods={periodsForDisplay}
                  onPeriodChange={setSelectedPeriod}
                  summaryLabel={summaryLabel}
                  summaryValue={summaryValue}
                  summaryCostValue={summaryCostValue}
                  onCostInfo={costInfoEnabled ? openCostModal : null}
                  fleetData={fleetData}
                  onRefresh={screenshotMode ? null : refreshAll}
                  loading={usageLoadingState}
                />

                {!screenshotMode ? (
                  <FadeIn delay={0.5}>
                    <DataDetails
                    projectEntries={projectUsageEntries}
                    projectLimit={projectUsageLimit}
                    onProjectLimitChange={setProjectUsageLimit}
                    copy={copy}
                    hasDetailsActual={hasDetailsActual}
                    dailyEmptyPrefix={dailyEmptyPrefix}
                    installSyncCmd={installSyncCmd}
                    dailyEmptySuffix={dailyEmptySuffix}
                    detailsColumns={detailsColumns}
                    ariaSortFor={ariaSortFor}
                    toggleSort={toggleSort}
                    sortIconFor={sortIconFor}
                    pagedDetails={pagedDetails}
                    dailyBreakdownRows={dailyBreakdownRows}
                    dailyBreakdownColumns={dailyBreakdownColumns}
                    dailyBreakdownAriaSortFor={dailyBreakdownAriaSortFor}
                    dailyBreakdownSortIconFor={dailyBreakdownSortIconFor}
                    dailyBreakdownDateKey={dailyBreakdownDateKey}
                    detailsDateKey={detailsDateKey}
                    renderDetailDate={renderDetailDate}
                    renderDailyBreakdownDate={renderDailyBreakdownDate}
                    renderDetailCell={renderDetailCell}
                    DETAILS_PAGED_PERIODS={DETAILS_PAGED_PERIODS}
                    period={period}
                    detailsPageCount={detailsPageCount}
                    detailsPage={detailsPage}
                    setDetailsPage={setDetailsPage}
                  />
                  </FadeIn>
                ) : null}
              </div>
            </div>
          </>
        )}
      </Shell>
      <CostAnalysisModal isOpen={costModalOpen} onClose={closeCostModal} fleetData={fleetData} />
    </>
  );
}
