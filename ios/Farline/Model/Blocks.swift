// Turns the flat item list into what the conversation draws: tool calls and
// thinking in a row fold into one "steps" block. Mirrors web/src/lib/steps.ts.
import Foundation

enum Step: Hashable, Sendable, Identifiable {
  case tool(ToolItem)
  case thinking(ThinkingItem)

  var id: String {
    switch self {
    case .tool(let t): t.id
    case .thinking(let t): t.id
    }
  }

  var category: StepCategory {
    switch self {
    case .thinking: .think
    case .tool(let t): StepCategory(tool: t.name)
    }
  }

  var tool: ToolItem? {
    if case .tool(let t) = self { return t }
    return nil
  }
}

enum StepCategory: Hashable, Sendable, CaseIterable {
  case bash, read, edit, search, web, agent, todo, think, other

  init(tool name: String) {
    switch name {
    case "WebSearch", "WebFetch": self = .web
    case "Bash", "BashOutput", "KillShell", "KillBash": self = .bash
    case "Read", "NotebookRead": self = .read
    case "Edit", "Write", "MultiEdit", "NotebookEdit": self = .edit
    case "Grep", "Glob", "LS": self = .search
    case "Agent", "Task": self = .agent
    case "TodoWrite": self = .todo
    default: self = .other
    }
  }

  var symbol: String {
    switch self {
    case .bash: "apple.terminal"
    case .read: "doc.text"
    case .edit: "square.and.pencil"
    case .search: "magnifyingglass"
    case .web: "globe"
    case .agent: "cpu"
    case .todo: "checklist"
    case .think: "clock"
    case .other: "wrench.adjustable"
    }
  }
}

enum Block: Hashable, Sendable, Identifiable {
  case user(UserItem)
  case text(TextItem, last: Bool)
  case steps(id: String, [Step])
  case ask(AskItem)
  case notice(NoticeItem)
  case task(TaskItem)

  var id: String {
    switch self {
    case .user(let i): i.id
    case .text(let i, _): i.id
    case .steps(let id, _): "steps-\(id)"
    case .ask(let i): i.id
    case .notice(let i): i.id
    case .task(let i): i.id
    }
  }

  static func build(_ items: [Item]) -> [Block] {
    var blocks: [Block] = []
    var steps: [Step] = []
    func flush() {
      if let first = steps.first { blocks.append(.steps(id: first.id, steps)) }
      steps = []
    }
    for item in items {
      switch item {
      case .tool(let t): steps.append(.tool(t))
      case .thinking(let t):
        if !t.text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { steps.append(.thinking(t)) }
      case .user(let u): flush(); blocks.append(.user(u))
      case .text(let t): flush(); blocks.append(.text(t, last: false))
      case .ask(let a): flush(); blocks.append(.ask(a))
      case .notice(let n): flush(); blocks.append(.notice(n))
      case .task(let t): flush(); blocks.append(.task(t))
      case .unknown: continue
      }
    }
    flush()
    // The last reply before each user turn (or the end) is the one that
    // can be edited.
    for i in blocks.indices {
      guard case .text(let t, _) = blocks[i] else { continue }
      let next = blocks[(i + 1)...].first {
        if case .notice = $0 { return false }
        if case .task = $0 { return false }
        return true
      }
      if next == nil { blocks[i] = .text(t, last: true) }
      else if case .user = next { blocks[i] = .text(t, last: true) }
    }
    return blocks
  }
}

extension [Item] {
  // Removes, then inserts or replaces in place, as the server's patches do.
  mutating func apply(_ patch: Patch) {
    if let removes = patch.removes, !removes.isEmpty {
      let gone = Set(removes)
      removeAll { gone.contains($0.id) }
    }
    guard let upserts = patch.upserts, !upserts.isEmpty else { return }
    var index: [String: Int] = [:]
    for (i, item) in enumerated() { index[item.id] = i }
    for item in upserts {
      if let i = index[item.id] {
        self[i] = item
      } else {
        index[item.id] = count
        append(item)
      }
    }
  }
}

enum StepText {
  // What a step did ("Read") and to what ("auth.ts"), as web/src/lib/steps.ts
  // words it.
  static func label(_ step: Step) -> (title: String, detail: String) {
    switch step {
    case .thinking(let t):
      let flat = t.text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
      return (t.streaming == true ? String(localized: "Thinking") : String(localized: "Thought"), String(flat.prefix(80)))
    case .tool(let t):
      let done = !t.running
      if t.taskId != nil {
        return (t.name == "Monitor" ? String(localized: "Started monitor") : String(localized: "Moved to background"), t.arg("description") ?? t.arg("command") ?? t.arg("prompt") ?? "")
      }
      switch t.name {
      case "Bash":
        return (done ? String(localized: "Ran") : String(localized: "Running"), nonEmpty(t.arg("description")) ?? t.arg("command") ?? "")
      case "WebSearch":
        return (done ? String(localized: "Searched the web") : String(localized: "Searching the web"), t.arg("query") ?? "")
      case "WebFetch":
        return (done ? String(localized: "Fetched") : String(localized: "Fetching"), t.arg("url") ?? "")
      case "Read":
        return (done ? String(localized: "Read") : String(localized: "Reading"), fileName(t.arg("file_path")))
      case "Edit", "MultiEdit":
        return (done ? String(localized: "Edited") : String(localized: "Editing"), fileName(t.arg("file_path")))
      case "Write":
        return (done ? String(localized: "Wrote") : String(localized: "Writing"), fileName(t.arg("file_path")))
      case "NotebookEdit":
        return (done ? String(localized: "Edited") : String(localized: "Editing"), fileName(t.arg("notebook_path")))
      case "Grep":
        return (done ? String(localized: "Searched code") : String(localized: "Searching code"), t.arg("pattern") ?? "")
      case "Glob":
        return (done ? String(localized: "Found files") : String(localized: "Finding files"), t.arg("pattern") ?? "")
      case "Agent", "Task":
        return (done ? String(localized: "Subtask done") : String(localized: "Subtask running"), t.arg("description") ?? "")
      case "TodoWrite":
        var n: Int?
        if case .array(let a)? = t.input["todos"] { n = a.count }
        return (String(localized: "Updated todos"), n.map { String(localized: "\($0) items") } ?? "")
      case "Skill":
        return (String(localized: "Used skill"), nonEmpty(t.arg("skill")) ?? t.arg("command") ?? "")
      case "ToolSearch":
        return (String(localized: "Loaded tools"), t.arg("query") ?? "")
      default:
        if let (server, tool) = mcp(t.name) {
          return (done ? String(localized: "Called \(server)") : String(localized: "Calling \(server)"), tool)
        }
        return (done ? String(localized: "Called \(t.name)") : String(localized: "Calling \(t.name)"), "")
      }
    }
  }

  // The short line for one step.
  static func detail(_ step: Step) -> String { label(step).detail }

  // "Read 2 files, searched code": what a run of steps did.
  static func summary(_ steps: [Step]) -> String {
    var counts: [(StepCategory, Int)] = []
    func bump(_ c: StepCategory, _ by: Int) {
      if let i = counts.firstIndex(where: { $0.0 == c }) { counts[i].1 += by } else { counts.append((c, by)) }
    }
    for s in steps { bump(s.category, s.category == .edit ? 0 : 1) }
    let edited = Set(steps.compactMap { s -> String? in
      guard let t = s.tool, s.category == .edit else { return nil }
      return t.arg("file_path") ?? ""
    })
    if let i = counts.firstIndex(where: { $0.0 == .edit }) { counts[i].1 = max(edited.count, 1) }
    // Thinking only shows up when nothing else happened.
    if counts.count > 1 { counts.removeAll { $0.0 == .think } }
    return counts.map { c, n in phrase(c, n) }.joined(separator: String(localized: ", ", comment: "Joins step summaries"))
  }

  private static func phrase(_ c: StepCategory, _ n: Int) -> String {
    switch c {
    case .web: String(localized: "Browsed the web")
    case .bash: String(localized: "Ran \(n) commands")
    case .read: String(localized: "Read \(n) files")
    case .edit: String(localized: "Edited \(n) files")
    case .search: String(localized: "Searched the code")
    case .agent: String(localized: "Finished \(n) subtasks")
    case .think: String(localized: "Thought")
    case .todo: String(localized: "Updated the todos")
    case .other: String(localized: "Called \(n) tools")
    }
  }

  private static func mcp(_ name: String) -> (String, String)? {
    guard name.hasPrefix("mcp__") else { return nil }
    let parts = name.dropFirst(5).components(separatedBy: "__")
    guard parts.count >= 2 else { return nil }
    var server = parts[0]
    if server.hasPrefix("claude_ai_") { server.removeFirst(10) }
    return (server, parts[1...].joined(separator: "__"))
  }

  // Tool name as shown: MCP tools as "server · tool".
  static func toolName(_ name: String) -> String {
    guard name.hasPrefix("mcp__") else { return name }
    let parts = name.dropFirst(5).components(separatedBy: "__")
    return parts.count >= 2 ? "\(parts[0]) · \(parts[1...].joined(separator: "__"))" : name
  }

  static func fileName(_ path: String?) -> String {
    guard let path, !path.isEmpty else { return "" }
    return (path as NSString).lastPathComponent
  }

  private static func nonEmpty(_ s: String?) -> String? {
    guard let s, !s.isEmpty else { return nil }
    return s
  }
}

enum Answers {
  // Live answers are "question\nanswer" blocks; transcripts carry Claude
  // Code's `"question"="answer"` sentence.
  static func parse(_ text: String?) -> [String: String] {
    guard let text, !text.isEmpty else { return [:] }
    var out: [String: String] = [:]
    let pattern = /"([^"]+)"="([^"]*)"/
    for m in text.matches(of: pattern) { out[String(m.1)] = String(m.2) }
    if !out.isEmpty { return out }
    for block in text.components(separatedBy: "\n\n") {
      let lines = block.components(separatedBy: "\n")
      if lines.count > 1 { out[lines[0]] = lines.dropFirst().joined(separator: "\n") }
    }
    return out
  }
}
