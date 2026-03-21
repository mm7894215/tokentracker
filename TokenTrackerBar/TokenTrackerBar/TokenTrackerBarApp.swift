import SwiftUI

@main
struct TokenTrackerBarApp: App {
    @StateObject private var viewModel = DashboardViewModel()
    @StateObject private var serverManager = ServerManager()

    var body: some Scene {
        MenuBarExtra {
            DashboardView(viewModel: viewModel, serverManager: serverManager)
                .frame(width: 450, height: 640)
                .task {
                    await serverManager.ensureServerRunning()
                    if serverManager.isServerRunning {
                        await viewModel.syncThenLoad()
                        viewModel.startAutoRefresh()
                    }
                }
        } label: {
            Image("MenuBarIcon")
                .renderingMode(.template)
        }
        .menuBarExtraStyle(.window)
    }
}
