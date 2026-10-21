// Server-sent events, fed one line at a time.
import Foundation

struct ServerEvent: Equatable, Sendable {
  var event: String
  var data: String
  var id: String?
}

struct EventStreamParser {
  private var event = ""
  private var data: [String] = []
  private var id: String?

  // Returns an event when a blank line completes one.
  mutating func feed(_ rawLine: String) -> ServerEvent? {
    let line = rawLine.hasSuffix("\r") ? String(rawLine.dropLast()) : rawLine
    if line.isEmpty {
      defer { event = ""; data = []; id = nil }
      guard !data.isEmpty || !event.isEmpty else { return nil }
      return ServerEvent(event: event.isEmpty ? "message" : event, data: data.joined(separator: "\n"), id: id)
    }
    if line.hasPrefix(":") { return nil }
    let field: Substring
    var value: Substring
    if let colon = line.firstIndex(of: ":") {
      field = line[..<colon]
      value = line[line.index(after: colon)...]
      if value.hasPrefix(" ") { value = value.dropFirst() }
    } else {
      field = Substring(line)
      value = ""
    }
    switch field {
    case "event": event = String(value)
    case "data": data.append(String(value))
    case "id": id = String(value)
    default: break
    }
    return nil
  }
}
