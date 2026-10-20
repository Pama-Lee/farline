// The Farline server's HTTP API. Auth is the server's own cookie, kept in
// the shared cookie store so images and the event stream carry it too.
import Foundation

struct APIError: LocalizedError, Sendable {
  let status: Int
  let message: String

  var errorDescription: String? { message }
  var unauthorized: Bool { status == 401 }
}

final class APIClient: Sendable {
  let base: URL
  private let session: URLSession

  init(base: URL) {
    self.base = base
    let config = URLSessionConfiguration.default
    config.httpCookieStorage = .shared
    config.httpShouldSetCookies = true
    config.httpCookieAcceptPolicy = .always
    config.timeoutIntervalForRequest = 60
    session = URLSession(configuration: config)
  }

  // Server text (errors, titles) follows the app's language.
  static var language: String {
    let preferred = Bundle.main.preferredLocalizations.first ?? Locale.preferredLanguages.first ?? "en"
    return preferred.hasPrefix("zh") ? "zh-CN" : "en"
  }

  func url(_ path: String) -> URL {
    URL(string: path, relativeTo: base)?.absoluteURL ?? base
  }

  private func makeRequest(_ method: String, _ path: String) -> URLRequest {
    var req = URLRequest(url: url("/api" + path))
    req.httpMethod = method
    // The server only accepts writes that carry this header (CSRF guard).
    req.setValue("1", forHTTPHeaderField: "x-farline")
    req.setValue(Self.language, forHTTPHeaderField: "x-farline-lang")
    return req
  }

  private func send<T: Decodable>(_ req: URLRequest) async throws -> T {
    let (data, response) = try await session.data(for: req)
    let status = (response as? HTTPURLResponse)?.statusCode ?? 0
    guard (200..<300).contains(status) else {
      let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
      throw APIError(status: status, message: message ?? String(localized: "Request failed (\(status))"))
    }
    return try JSONDecoder().decode(T.self, from: data)
  }

  func get<T: Decodable>(_ path: String) async throws -> T {
    try await send(makeRequest("GET", path))
  }

  func call<T: Decodable>(_ method: String, _ path: String, _ body: (any Encodable & Sendable)? = nil) async throws -> T {
    var req = makeRequest(method, path)
    if let body {
      req.httpBody = try JSONEncoder().encode(body)
      req.setValue("application/json", forHTTPHeaderField: "content-type")
    }
    return try await send(req)
  }

  // Requests whose reply we don't read.
  func run(_ method: String, _ path: String, _ body: (any Encodable & Sendable)? = nil) async throws {
    let _: OK = try await call(method, path, body)
  }

  private struct OK: Decodable {}

  // MARK: - Auth

  func me() async throws -> Me { try await get("/me") }

  func login(password: String) async throws {
    try await run("POST", "/login", ["password": password])
  }

  func setup(code: String, password: String) async throws {
    try await run("POST", "/setup", ["code": code, "password": password])
  }

  func logout() async throws {
    try await run("POST", "/logout")
  }

  // MARK: - Device and models

  func device() async throws -> DeviceInfo { try await get("/device") }
  func catalog() async throws -> Catalog { try await get("/models") }

  func dirs(_ path: String?, hidden: Bool = false) async throws -> DirListing {
    var c = URLComponents()
    c.queryItems = []
    if let path { c.queryItems?.append(URLQueryItem(name: "path", value: path)) }
    if hidden { c.queryItems?.append(URLQueryItem(name: "hidden", value: "1")) }
    return try await get("/fs?\(c.percentEncodedQuery ?? "")")
  }

  // MARK: - Sessions

  struct SessionPage: Decodable {
    let sessions: [SessionSummary]
    let nextOffset: Int?
  }

  func sessions(offset: Int = 0, limit: Int = 60) async throws -> SessionPage {
    try await get("/sessions?limit=\(limit)&offset=\(offset)")
  }

  struct CreateBody: Encodable {
    let text: String
    let uploads: [String]?
    let cwd: String
    let provider: String
    let model: String
    let permissionMode: PermissionMode
    let effort: EffortLevel?
  }

  func createSession(_ body: CreateBody) async throws -> String {
    struct Created: Decodable { let id: String }
    let created: Created = try await call("POST", "/sessions", body)
    return created.id
  }

  func snapshot(_ id: String, all: Bool) async throws -> SessionSnapshot {
    try await get("/sessions/\(id)\(all ? "?all=1" : "")")
  }

  struct SendBody: Encodable {
    let text: String
    let uploads: [String]?
  }

  func sendMessage(_ id: String, text: String, uploads: [String]) async throws {
    try await run("POST", "/sessions/\(id)/messages", SendBody(text: text, uploads: uploads.isEmpty ? nil : uploads))
  }

  func interrupt(_ id: String) async throws {
    try await run("POST", "/sessions/\(id)/interrupt")
  }

  enum Decision: String, Encodable { case allow, always, deny }

  func decide(_ id: String, reqId: String, decision: Decision) async throws {
    struct Body: Encodable { let reqId: String; let decision: Decision }
    try await run("POST", "/sessions/\(id)/permission", Body(reqId: reqId, decision: decision))
  }

  func answer(_ id: String, reqId: String, answers: [String: String]?) async throws {
    struct Body: Encodable { let reqId: String; let answers: [String: String]? }
    try await run("POST", "/sessions/\(id)/answer", Body(reqId: reqId, answers: answers))
  }

  struct SessionChange: Encodable {
    var permissionMode: PermissionMode?
    var model: String?
    var effort: EffortLevel?
    var title: String?
    var hidden: Bool?
  }

  func update(_ id: String, _ change: SessionChange) async throws -> SessionState {
    try await call("PATCH", "/sessions/\(id)", change)
  }

  func editText(_ id: String, itemId: String, text: String) async throws {
    try await run("PUT", "/sessions/\(id)/items/\(itemId.urlPath)/text", ["text": text])
  }

  func react(_ id: String, itemId: String, emoji: String) async throws {
    try await run("PUT", "/sessions/\(id)/items/\(itemId.urlPath)/reactions", ["emoji": emoji])
  }

  func rewindPreview(_ id: String, messageId: String) async throws -> RewindPreview {
    try await get("/sessions/\(id)/rewind/\(messageId.urlPath)")
  }

  func rewind(_ id: String, messageId: String, files: Bool, conversation: Bool) async throws -> RewindResult {
    struct Body: Encodable { let messageId: String; let files: Bool; let conversation: Bool }
    return try await call("POST", "/sessions/\(id)/rewind", Body(messageId: messageId, files: files, conversation: conversation))
  }

  // MARK: - Uploads

  func upload(_ data: Data, filename: String, mime: String) async throws -> Upload {
    var req = makeRequest("POST", "/uploads")
    let boundary = "farline-\(UUID().uuidString)"
    req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "content-type")
    let name = filename.replacingOccurrences(of: "\"", with: "")
    var body = Data()
    body.append(Data("--\(boundary)\r\n".utf8))
    body.append(Data("Content-Disposition: form-data; name=\"file\"; filename=\"\(name)\"\r\n".utf8))
    body.append(Data("Content-Type: \(mime)\r\n\r\n".utf8))
    body.append(data)
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    req.httpBody = body
    return try await send(req)
  }

  // MARK: - Events

  // The session's patch stream. Ends when the server closes it.
  func events(_ id: String, since: Int) -> AsyncThrowingStream<ServerEvent, Error> {
    var req = makeRequest("GET", "/sessions/\(id)/events?since=\(since)")
    req.setValue("text/event-stream", forHTTPHeaderField: "accept")
    req.timeoutInterval = 60
    let request = req
    let session = self.session
    return AsyncThrowingStream { continuation in
      let task = Task {
        do {
          let (bytes, response) = try await session.bytes(for: request)
          let status = (response as? HTTPURLResponse)?.statusCode ?? 0
          guard status == 200 else { throw APIError(status: status, message: "event stream \(status)") }
          var parser = EventStreamParser()
          var line: [UInt8] = []
          for try await byte in bytes {
            if byte == 0x0A {
              if let event = parser.feed(String(decoding: line, as: UTF8.self)) { continuation.yield(event) }
              line.removeAll(keepingCapacity: true)
            } else {
              line.append(byte)
            }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}

private extension String {
  var urlPath: String { addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? self }
}
