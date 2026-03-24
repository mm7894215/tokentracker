import AppKit
import Foundation

@MainActor
final class UpdateChecker {

    static let shared = UpdateChecker()

    private let repo = "mm7894215/tokentracker"
    private var isChecking = false

    // MARK: - Public

    /// Check for updates. If `silent`, suppress "already up to date" alert.
    func check(silent: Bool = false) {
        guard !isChecking else { return }
        isChecking = true

        Task.detached { [self] in
            let result: Result<GitHubRelease, Error>
            do {
                result = .success(try self.fetchLatestRelease())
            } catch {
                result = .failure(error)
            }

            await MainActor.run {
                self.isChecking = false
                self.handleResult(result, silent: silent)
            }
        }
    }

    // MARK: - GitHub API via curl

    private struct GitHubRelease: Decodable {
        let tag_name: String
        let name: String?
        let body: String?
        let html_url: String
        let assets: [Asset]

        struct Asset: Decodable {
            let name: String
            let browser_download_url: String
            let size: Int
        }

        var tagVersion: String {
            tag_name.hasPrefix("v") ? String(tag_name.dropFirst()) : tag_name
        }

        var dmgAsset: Asset? {
            assets.first { $0.name.hasSuffix(".dmg") }
        }
    }

    /// Use curl subprocess — inherits system proxy, bypasses URLSession issues.
    nonisolated private func fetchLatestRelease() throws -> GitHubRelease {
        let urlString = "https://api.github.com/repos/\(repo)/releases/latest"

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        process.arguments = [
            "-s", "--max-time", "15",
            "-H", "Accept: application/vnd.github+json",
            urlString
        ]

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = Pipe()

        try process.run()
        process.waitUntilExit()

        guard process.terminationStatus == 0 else {
            throw UpdateError.curlFailed(Int(process.terminationStatus))
        }

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard !data.isEmpty else {
            throw UpdateError.emptyResponse
        }

        return try JSONDecoder().decode(GitHubRelease.self, from: data)
    }

    /// Download file via curl to ~/Downloads, returns local file URL.
    nonisolated private func downloadViaCurl(from urlString: String, fileName: String) throws -> URL {
        let downloadsDir = FileManager.default.urls(for: .downloadsDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let destURL = downloadsDir.appendingPathComponent(fileName)

        // Remove existing file
        if FileManager.default.fileExists(atPath: destURL.path) {
            try FileManager.default.removeItem(at: destURL)
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        process.arguments = [
            "-L", "-s", "--max-time", "300",
            "-o", destURL.path,
            urlString
        ]
        process.standardOutput = Pipe()
        process.standardError = Pipe()

        try process.run()
        process.waitUntilExit()

        guard process.terminationStatus == 0,
              FileManager.default.fileExists(atPath: destURL.path) else {
            throw UpdateError.downloadFailed
        }

        return destURL
    }

    // MARK: - Result Handling

    private func handleResult(_ result: Result<GitHubRelease, Error>, silent: Bool) {
        switch result {
        case .success(let release):
            let current = currentVersion()
            if compareVersions(current, release.tagVersion) == .orderedAscending {
                promptUpdate(release: release, currentVersion: current)
            } else if !silent {
                showAlert(
                    title: "已是最新版本",
                    message: "当前版本 \(current) 已经是最新。",
                    style: .informational
                )
            }
        case .failure(let error):
            if !silent {
                showAlert(
                    title: "检查更新失败",
                    message: error.localizedDescription,
                    style: .warning
                )
            }
        }
    }

    // MARK: - Version Comparison

    private func currentVersion() -> String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0.0.0"
    }

    private func compareVersions(_ a: String, _ b: String) -> ComparisonResult {
        let partsA = a.split(separator: ".").compactMap { Int($0) }
        let partsB = b.split(separator: ".").compactMap { Int($0) }
        let count = max(partsA.count, partsB.count)

        for i in 0..<count {
            let va = i < partsA.count ? partsA[i] : 0
            let vb = i < partsB.count ? partsB[i] : 0
            if va < vb { return .orderedAscending }
            if va > vb { return .orderedDescending }
        }
        return .orderedSame
    }

    // MARK: - UI

    private func promptUpdate(release: GitHubRelease, currentVersion: String) {
        let alert = NSAlert()
        alert.messageText = "发现新版本 \(release.tagVersion)"
        alert.informativeText = buildUpdateMessage(release: release, currentVersion: currentVersion)
        alert.alertStyle = .informational

        if release.dmgAsset != nil {
            alert.addButton(withTitle: "下载并安装")
            alert.addButton(withTitle: "稍后再说")
        } else {
            alert.addButton(withTitle: "前往下载")
            alert.addButton(withTitle: "稍后再说")
        }

        NSApp.activate(ignoringOtherApps: true)
        let response = alert.runModal()

        if response == .alertFirstButtonReturn {
            if let dmg = release.dmgAsset {
                startDownload(dmg)
            } else if let url = URL(string: release.html_url) {
                NSWorkspace.shared.open(url)
            }
        }
    }

    private func buildUpdateMessage(release: GitHubRelease, currentVersion: String) -> String {
        var lines = ["当前版本: \(currentVersion) → \(release.tagVersion)"]
        if let body = release.body, !body.isEmpty {
            let summary = body.prefix(300)
            lines.append("\n更新内容:\n\(summary)")
            if body.count > 300 { lines.append("…") }
        }
        if let dmg = release.dmgAsset {
            let sizeMB = String(format: "%.1f", Double(dmg.size) / 1_048_576)
            lines.append("\n文件大小: \(sizeMB) MB")
        }
        return lines.joined()
    }

    private func startDownload(_ asset: GitHubRelease.Asset) {
        Task.detached { [self] in
            let result: Result<URL, Error>
            do {
                result = .success(try self.downloadViaCurl(from: asset.browser_download_url, fileName: asset.name))
            } catch {
                result = .failure(error)
            }

            await MainActor.run {
                switch result {
                case .success(let savedURL):
                    NSWorkspace.shared.open(savedURL)
                    self.showAlert(
                        title: "下载完成",
                        message: "DMG 已下载到 \(savedURL.path)\n\n请将 TokenTrackerBar 拖入 Applications 文件夹完成安装，然后重启应用。",
                        style: .informational
                    )
                case .failure(let error):
                    self.showAlert(
                        title: "下载失败",
                        message: error.localizedDescription,
                        style: .warning
                    )
                }
            }
        }
    }

    private func showAlert(title: String, message: String, style: NSAlert.Style) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = message
        alert.alertStyle = style
        alert.addButton(withTitle: "好")
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    // MARK: - Errors

    private enum UpdateError: LocalizedError {
        case curlFailed(Int)
        case emptyResponse
        case downloadFailed
        case noRelease

        var errorDescription: String? {
            switch self {
            case .curlFailed(let code): return "网络请求失败 (curl exit \(code))，请检查网络连接。"
            case .emptyResponse: return "服务器返回空响应。"
            case .downloadFailed: return "文件下载失败，请重试。"
            case .noRelease: return "暂无发布版本。"
            }
        }
    }
}
