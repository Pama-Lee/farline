// One open session: a snapshot, then the server's patches. Any gap (server
// restart, the app being suspended) is healed by fetching the snapshot again.
import Foundation
import Observation

@MainActor
@Observable
final class SessionModel {
  let id: String
  let api: APIClient

  private(set) var state: SessionState?
  private(set) var items: [Item] = [] {
    didSet { blocks = Block.build(items) }
  }
  private(set) var blocks: [Block] = []
  private(set) var hasEarlier = false
  private(set) var error: String?
  // Bumped when a turn finishes, for haptics.
  private(set) var finishedTurns = 0
  // When the current turn started, for the elapsed time.
  private(set) var runningSince: Date?
  // Text put back in the composer after a rewind.
  var draft: String?

  private var seq = 0
  private var all = false
  private var task: Task<Void, Never>?

  init(id: String, api: APIClient) {
    self.id = id
    self.api = api
  }

  var running: Bool { state?.status == .running }
  var busyElsewhere: Bool { state?.status == .busyElsewhere }
  // Working, or waiting on the user.
  var busy: Bool { state?.status == .running || state?.status == .requiresAction }

  // The tool call waiting for a yes or no, shown above the composer.
  var pendingPermission: ToolItem? {
    for item in items {
      if case .tool(let t) = item, t.permission?.pending == true { return t }
    }
    return nil
  }

  // A reply is arriving, so the thinking dots step aside.
  var streamingText: Bool {
    if case .text(let t)? = items.last { return t.streaming == true }
    return false
  }

  func steps(_ id: String) -> [Step]? {
    for block in blocks {
      if case .steps(let sid, let steps) = block, sid == id { return steps }
    }
    return nil
  }

  func connect() {
    task?.cancel()
    task = Task { [weak self] in await self?.run() }
  }

  func disconnect() {
    task?.cancel()
    task = nil
  }

  func loadAll() {
    all = true
    connect()
  }

  private func run() async {
    outer: while !Task.isCancelled {
      do {
        let snap = try await api.snapshot(id, all: all)
        if Task.isCancelled { return }
        setState(snap.state)
        items = snap.items
        hasEarlier = snap.hasEarlier
        seq = snap.seq
        error = nil
        for try await event in api.events(id, since: snap.seq) {
          if Task.isCancelled { return }
          switch event.event {
          case "patch":
            guard let patch = try? JSONDecoder().decode(Patch.self, from: Data(event.data.utf8)) else { continue outer }
            // A missed patch: start over from a fresh snapshot.
            guard patch.seq == seq + 1 else { continue outer }
            seq = patch.seq
            if let s = patch.state { setState(s) }
            if patch.upserts != nil || patch.removes != nil { items.apply(patch) }
          case "reset":
            continue outer
          default:
            break
          }
        }
      } catch {
        if Task.isCancelled { return }
        // Only a failed snapshot is worth showing; a dropped stream just reconnects.
        if state == nil { self.error = error.localizedDescription }
      }
      try? await Task.sleep(for: .seconds(1.5))
    }
  }

  private func setState(_ s: SessionState) {
    let was = state?.status
    state = s
    if s.status == .running, was != .running { runningSince = Date() }
    if was == .running, s.status == .idle { finishedTurns += 1 }
    if s.status != .running { runningSince = nil }
  }

  // MARK: - Actions

  func send(_ text: String, uploads: [String]) async throws {
    try await api.sendMessage(id, text: text, uploads: uploads)
  }

  func interrupt() async {
    try? await api.interrupt(id)
  }

  func decide(_ reqId: String, _ decision: APIClient.Decision) async throws {
    try await api.decide(id, reqId: reqId, decision: decision)
  }

  func answer(_ reqId: String, _ answers: [String: String]?) async throws {
    try await api.answer(id, reqId: reqId, answers: answers)
  }

  func update(_ change: APIClient.SessionChange) async throws {
    let s = try await api.update(id, change)
    setState(s)
  }

  func editText(itemId: String, text: String) async throws {
    try await api.editText(id, itemId: itemId, text: text)
  }

  func react(itemId: String, emoji: String) async throws {
    try await api.react(id, itemId: itemId, emoji: emoji)
  }
}
