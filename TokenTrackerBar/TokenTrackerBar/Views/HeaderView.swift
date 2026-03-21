import SwiftUI

struct HeaderView: View {
    @ObservedObject var viewModel: DashboardViewModel

    @State private var syncRotation: Double = 0

    @State private var hoveringSync = false

    var body: some View {
        HStack(spacing: 8) {
            BoltIcon(size: 14, color: .accentColor)
            Text(Strings.appTitle)
                .font(.subheadline)
                .fontWeight(.medium)

            Spacer()

            // Refresh time + button grouped together
            HStack(spacing: 4) {
                if let lastRefreshed = viewModel.lastRefreshed,
                   let timeText = relativeTime(from: lastRefreshed) {
                    Text(timeText)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }

                Button {
                    Task { await viewModel.triggerSync() }
                } label: {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 11))
                        .foregroundStyle(viewModel.isSyncing ? .tertiary : .secondary)
                        .rotationEffect(.degrees(syncRotation))
                        .scaleEffect(hoveringSync && !viewModel.isSyncing ? 1.15 : 1.0)
                        .animation(.easeOut(duration: 0.15), value: hoveringSync)
                }
                .frame(width: 24, height: 24)
                .contentShape(Rectangle())
                .buttonStyle(.plain)
                .onHover { hovering in
                    hoveringSync = hovering
                    if hovering { NSCursor.pointingHand.push() } else { NSCursor.pop() }
                }
                .disabled(viewModel.isSyncing)
            }
            .onChange(of: viewModel.isSyncing) { syncing in
                if syncing {
                    withAnimation(.linear(duration: 1).repeatForever(autoreverses: false)) {
                        syncRotation = 360
                    }
                } else {
                    withAnimation(.default) {
                        syncRotation = 0
                    }
                }
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
    }

    private func relativeTime(from date: Date) -> String? {
        let seconds = Int(Date().timeIntervalSince(date))
        if seconds < 60 { return nil }
        let minutes = seconds / 60
        if minutes < 60 { return Strings.minutesAgo(minutes) }
        let hours = minutes / 60
        if hours < 24 { return Strings.hoursAgo(hours) }
        return nil
    }
}
