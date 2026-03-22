import Foundation
import ServiceManagement

@MainActor
final class LaunchAtLoginManager: ObservableObject {

    @Published var isEnabled: Bool = false

    init() {
        isEnabled = SMAppService.mainApp.status == .enabled
    }

    func toggle() {
        do {
            if isEnabled {
                try SMAppService.mainApp.unregister()
            } else {
                try SMAppService.mainApp.register()
            }
        } catch {
            // Registration failed — revert the UI state
        }
        isEnabled = SMAppService.mainApp.status == .enabled
    }
}
