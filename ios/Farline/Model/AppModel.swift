// Which server we talk to and whether we're signed in.
import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
  enum Phase: Equatable {
    case starting
    // No server yet, or the saved one can't be reached.
    case connect
    case setup
    case login
    case ready
  }

  private static let serverKey = "farline.server"

  private(set) var phase: Phase = .starting
  private(set) var api: APIClient?
  private(set) var device: DeviceInfo?
  private(set) var catalog: Catalog = .empty
  var connectError: String?

  var serverURL: URL? { api?.base }

  init() {
    if let saved = UserDefaults.standard.string(forKey: Self.serverKey), let url = URL(string: saved) {
      api = APIClient(base: url)
    }
  }

  func start() async {
    guard api != nil else {
      phase = .connect
      return
    }
    await refreshPhase()
  }

  // Accepts "host:port", "192.168.1.2:3077" or a full URL.
  nonisolated static func normalize(_ input: String) -> URL? {
    var s = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !s.isEmpty else { return nil }
    if !s.contains("://") { s = "http://" + s }
    while s.hasSuffix("/") { s.removeLast() }
    guard let url = URL(string: s), url.host() != nil else { return nil }
    return url
  }

  func connect(to input: String) async {
    connectError = nil
    guard let url = Self.normalize(input) else {
      connectError = String(localized: "That doesn't look like a server address.")
      return
    }
    let client = APIClient(base: url)
    do {
      _ = try await client.me()
    } catch {
      connectError = String(localized: "Couldn't reach Farline at \(url.absoluteString). \(error.localizedDescription)")
      return
    }
    api = client
    UserDefaults.standard.set(url.absoluteString, forKey: Self.serverKey)
    await refreshPhase()
  }

  func refreshPhase() async {
    guard let api else {
      phase = .connect
      return
    }
    do {
      let me = try await api.me()
      if me.needsSetup { phase = .setup }
      else if !me.authed { phase = .login }
      else {
        await loadBasics()
        phase = .ready
      }
    } catch {
      connectError = error.localizedDescription
      phase = .connect
    }
  }

  func loadBasics() async {
    guard let api else { return }
    async let d = try? api.device()
    async let c = try? api.catalog()
    device = await d
    catalog = await c ?? .empty
  }

  func login(password: String) async throws {
    guard let api else { return }
    try await api.login(password: password)
    await refreshPhase()
  }

  func setup(code: String, password: String) async throws {
    guard let api else { return }
    try await api.setup(code: code, password: password)
    await refreshPhase()
  }

  func signOut() async {
    try? await api?.logout()
    phase = .login
  }

  func forgetServer() {
    api = nil
    device = nil
    catalog = .empty
    UserDefaults.standard.removeObject(forKey: Self.serverKey)
    phase = .connect
  }

  // A 401 anywhere means the cookie expired.
  func handle(_ error: Error) {
    if let e = error as? APIError, e.unauthorized { phase = .login }
  }
}
