import Foundation

/// Pure preference and value-selection policy for the Dynamic Island's
/// compact collapsed layout. Keeping this independent of SwiftUI makes its
/// fallback behaviour deterministic and directly testable.
enum DynamicIslandCompactPolicy {
    static let enabledDefaultsKey = "DynamicIslandCompactModeEnabled"

    static func isEnabled(from defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: enabledDefaultsKey)
    }

    static func write(_ enabled: Bool, to defaults: UserDefaults = .standard) {
        defaults.set(enabled, forKey: enabledDefaultsKey)
    }

    /// The first currently healthy, visible limit metric. `keepingSelected` is
    /// deliberately empty: a stale selected slot must not become an auto-ring
    /// candidate while its provider is unavailable.
    static func resolveAutoRingMetric(
        limits: UsageLimitsResponse?,
        hiddenProviders: Set<String>
    ) -> MenuBarDisplayMetric? {
        MenuBarDisplayPreferences.availableItemIDs(
            for: limits,
            keepingSelected: [],
            hiddenProviders: hiddenProviders
        )
        .compactMap(MenuBarDisplayMetric.init(rawValue:))
        .first { $0.settingsCategory == "limits" }
    }

    /// Uses a viable Primary slot directly. A non-limit or unavailable Primary
    /// falls back to auto, while nil preserves the user's explicit empty slot.
    static func resolveRingMetric(
        primarySlot: MenuBarDisplayMetric?,
        limits: UsageLimitsResponse?,
        hiddenProviders: Set<String>
    ) -> MenuBarDisplayMetric? {
        guard let primarySlot else { return nil }
        let auto = resolveAutoRingMetric(limits: limits, hiddenProviders: hiddenProviders)
        let available = MenuBarDisplayPreferences.availableItemIDs(
            for: limits,
            keepingSelected: [],
            hiddenProviders: hiddenProviders
        )
        guard primarySlot.settingsCategory == "limits",
              available.contains(primarySlot.rawValue) else {
            return auto
        }
        return primarySlot
    }

    /// `trim` follows the selected display mode; `color` always tracks raw
    /// utilization so a short remaining ring can still communicate urgency.
    static func ringValues(
        pct: Double?,
        displayMode: LimitDisplayMode
    ) -> (trim: Double, color: Double)? {
        guard let pct else { return nil }
        let used = min(max(pct, 0), 100) / 100
        return (displayMode == .remaining ? 1 - used : used, used)
    }

    static func quotaColor(colorValue: Double) -> RingColorTier {
        switch colorValue {
        case ..<0.5: return .green
        case ..<0.8: return .yellow
        default: return .red
        }
    }
}

enum RingColorTier: Equatable {
    case green
    case yellow
    case red
}
