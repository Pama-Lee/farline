// Wire types, mirroring shared/types.ts on the server.
import Foundation

enum JSONValue: Codable, Hashable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: JSONValue])
  case array([JSONValue])
  case null

  init(from decoder: Decoder) throws {
    let c = try decoder.singleValueContainer()
    if c.decodeNil() { self = .null }
    else if let b = try? c.decode(Bool.self) { self = .bool(b) }
    else if let n = try? c.decode(Double.self) { self = .number(n) }
    else if let s = try? c.decode(String.self) { self = .string(s) }
    else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
    else { self = .object(try c.decode([String: JSONValue].self)) }
  }

  func encode(to encoder: Encoder) throws {
    var c = encoder.singleValueContainer()
    switch self {
    case .string(let s): try c.encode(s)
    case .number(let n): try c.encode(n)
    case .bool(let b): try c.encode(b)
    case .object(let o): try c.encode(o)
    case .array(let a): try c.encode(a)
    case .null: try c.encodeNil()
    }
  }

  var string: String? {
    if case .string(let s) = self { return s }
    return nil
  }

  // Readable JSON for showing a tool's input.
  var pretty: String {
    let enc = JSONEncoder()
    enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
    guard let data = try? enc.encode(self) else { return "" }
    return String(decoding: data, as: UTF8.self)
  }
}

enum SessionStatus: String, Codable, Sendable {
  case idle
  case running
  case requiresAction = "requires_action"
  case busyElsewhere = "busy_elsewhere"

  init(from decoder: Decoder) throws {
    let raw = try decoder.singleValueContainer().decode(String.self)
    self = SessionStatus(rawValue: raw) ?? .idle
  }
}

enum PermissionMode: String, Codable, Sendable, CaseIterable, Identifiable {
  case `default`
  case auto
  case acceptEdits
  case plan
  case bypassPermissions

  var id: String { rawValue }
}

enum EffortLevel: String, Codable, Sendable, CaseIterable, Identifiable {
  case low, medium, high, xhigh, max
  var id: String { rawValue }
}

struct ImageRef: Codable, Hashable, Sendable {
  let url: String
}

struct Reaction: Codable, Hashable, Sendable {
  let emoji: String
  let by: String
}

struct QuestionOption: Codable, Hashable, Sendable {
  let label: String
  let description: String?
}

struct Question: Codable, Hashable, Sendable {
  let question: String
  let header: String?
  let multiSelect: Bool?
  let options: [QuestionOption]
}

struct PermissionAsk: Codable, Hashable, Sendable {
  let reqId: String
  let title: String?
  let description: String?
  let canAlways: Bool
  let status: String

  var pending: Bool { status == "pending" }
}

struct UserItem: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let text: String
  let images: [ImageRef]?
  let files: [String]?
  let ts: Double?
  let reactions: [Reaction]?
}

struct TextItem: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let text: String
  let streaming: Bool?
  let ts: Double?
  let edited: Bool?
  let reactions: [Reaction]?
}

struct ThinkingItem: Codable, Hashable, Sendable {
  let id: String
  let text: String
  let streaming: Bool?
}

struct ToolItem: Codable, Hashable, Sendable {
  let id: String
  let name: String
  let input: [String: JSONValue]
  let status: String
  let result: String?
  let truncated: Bool?
  let images: [ImageRef]?
  let permission: PermissionAsk?
  let taskId: String?

  var running: Bool { status == "running" }
  var failed: Bool { status == "error" }
  func arg(_ key: String) -> String? { input[key]?.string }
}

struct AskItem: Codable, Hashable, Sendable {
  let id: String
  let reqId: String?
  let questions: [Question]
  let status: String
  let answer: String?

  var pending: Bool { status == "pending" && reqId != nil }
}

struct NoticeItem: Codable, Hashable, Sendable {
  let id: String
  let level: String
  let text: String
  let code: String?
}

struct TaskItem: Codable, Hashable, Sendable {
  let id: String
  let taskId: String
  let toolUseId: String?
  let status: String?
  let summary: String
  let result: String?
  let ts: Double?
}

enum Item: Decodable, Hashable, Sendable, Identifiable {
  case user(UserItem)
  case text(TextItem)
  case thinking(ThinkingItem)
  case tool(ToolItem)
  case ask(AskItem)
  case notice(NoticeItem)
  case task(TaskItem)
  // A kind this app does not know yet; skipped when drawing.
  case unknown(id: String)

  private enum Keys: String, CodingKey { case kind, id }

  init(from decoder: Decoder) throws {
    let c = try decoder.container(keyedBy: Keys.self)
    let kind = try c.decode(String.self, forKey: .kind)
    switch kind {
    case "user": self = .user(try UserItem(from: decoder))
    case "text": self = .text(try TextItem(from: decoder))
    case "thinking": self = .thinking(try ThinkingItem(from: decoder))
    case "tool": self = .tool(try ToolItem(from: decoder))
    case "ask": self = .ask(try AskItem(from: decoder))
    case "notice": self = .notice(try NoticeItem(from: decoder))
    case "task": self = .task(try TaskItem(from: decoder))
    default: self = .unknown(id: (try? c.decode(String.self, forKey: .id)) ?? UUID().uuidString)
    }
  }

  var id: String {
    switch self {
    case .user(let i): i.id
    case .text(let i): i.id
    case .thinking(let i): i.id
    case .tool(let i): i.id
    case .ask(let i): i.id
    case .notice(let i): i.id
    case .task(let i): i.id
    case .unknown(let id): id
    }
  }
}

struct BackgroundTask: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let type: String
  let description: String
  let status: String
  let summary: String?
}

struct SessionSummary: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let title: String
  let cwd: String
  let updatedAt: Double
  let status: SessionStatus
  let provider: String
  let providerLabel: String?
  let tasks: Int?

  var updated: Date { Date(timeIntervalSince1970: updatedAt / 1000) }
}

struct SessionState: Codable, Hashable, Sendable {
  let id: String
  let title: String
  let cwd: String
  let status: SessionStatus
  let provider: String
  let model: String
  let permissionMode: PermissionMode
  let effort: EffortLevel?
  let classifierModel: String?
  let live: Bool
  let tasks: [BackgroundTask]
}

struct SessionSnapshot: Decodable, Sendable {
  let state: SessionState
  let items: [Item]
  let seq: Int
  let hasEarlier: Bool
}

struct Patch: Decodable, Sendable {
  let seq: Int
  let upserts: [Item]?
  let removes: [String]?
  let state: SessionState?
}

struct ModelOption: Codable, Hashable, Sendable, Identifiable {
  let provider: String
  let value: String
  let label: String
  let desc: String?
  let more: Bool?
  let efforts: [EffortLevel]?
  // The full id an alias like "opus" stands for.
  let resolved: String?

  var id: String { "\(provider)/\(value)" }

  func isCurrent(provider: String, model: String) -> Bool {
    self.provider == provider && (value == model || (resolved != nil && resolved == model))
  }
}

struct ProviderInfo: Codable, Hashable, Sendable, Identifiable {
  let id: String
  let label: String
  let classifierModels: [String]?
  let defaultPermissionMode: PermissionMode?
}

struct Catalog: Codable, Sendable {
  let providers: [ProviderInfo]
  let models: [ModelOption]

  static let empty = Catalog(providers: [], models: [])

  func models(for provider: String) -> [ModelOption] {
    models.filter { $0.provider == provider }
  }

  func current(provider: String, model: String) -> ModelOption? {
    models.first { $0.isCurrent(provider: provider, model: model) }
  }

  // Providers that have models, as the web's picker offers them.
  var pickable: [ProviderInfo] {
    providers.filter { p in models.contains { $0.provider == p.id } }
  }

  func label(for provider: String) -> String {
    providers.first { $0.id == provider }?.label ?? provider
  }
}

struct DirListing: Codable, Sendable {
  struct Dir: Codable, Hashable, Sendable, Identifiable {
    let name: String
    let path: String
    let hidden: Bool?
    var id: String { path }
  }

  let path: String
  let parent: String?
  let dirs: [Dir]
}

struct Upload: Codable, Hashable, Sendable {
  let id: String
  let name: String
  let path: String
  let mime: String
  let size: Int
  let isImage: Bool
}

struct PluginInfo: Codable, Sendable, Identifiable {
  let id: String
  let name: String
  let version: String
  let enabled: Bool
  let state: String
  let error: String?
  let skin: Bool?

  var active: Bool { state == "active" }
}

struct AgentStatus: Codable, Sendable, Identifiable {
  let id: String
  let name: String
  let homepage: String?
  let installed: Bool
  let version: String?
  let installing: Bool?
}

struct DeviceInfo: Codable, Sendable {
  struct Prefs: Codable, Sendable {
    let lastCwd: String?
    let provider: String?
    let model: String?
    let permissionMode: PermissionMode?
    let effort: EffortLevel?
    let classifierModel: String?
  }

  let name: String
  let defaultCwd: String
  let prefs: Prefs
}

struct Me: Codable, Sendable {
  let authed: Bool
  let needsSetup: Bool
}

struct RewindPreview: Codable, Sendable {
  let canRewind: Bool
  let error: String?
  let filesChanged: [String]?
  let insertions: Int?
  let deletions: Int?
}

struct RewindResult: Codable, Sendable {
  let restart: Bool?
  // pi rewinds into a new session.
  let sessionId: String?
}
