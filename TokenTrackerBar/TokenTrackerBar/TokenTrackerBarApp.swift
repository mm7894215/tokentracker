import SwiftUI

@main
struct TokenTrackerBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        Settings { EmptyView() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {

    private var statusBarController: StatusBarController?
    private let viewModel = DashboardViewModel()
    private let serverManager = ServerManager()
    private let launchAtLoginManager = LaunchAtLoginManager()

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusBarController = StatusBarController(
            viewModel: viewModel,
            serverManager: serverManager,
            launchAtLoginManager: launchAtLoginManager
        )

        Task { @MainActor in
            await serverManager.ensureServerRunning()
            if serverManager.isServerRunning {
                await viewModel.syncThenLoad()
                viewModel.startAutoRefresh()
            }
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        serverManager.stopServer()
    }
}
