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
    case .bash: "terminal"
    case .read: "doc.text"
    case .edit: "pencil"
    case .search: "magnifyingglass"
    case .web: "globe"
    case .agent: "person.2"
    case .todo: "checklist"
    case .think: "sparkle"
    case .other: "wrench.and.screwdriver"
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
  // The short line for one step: what it did and to what.
  static func detail(_ step: Step) -> String {
    switch step {
    case .thinking(let t):
      return t.text.split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
    case .tool(let t):
      switch t.name {
      case "Bash": return firstLine(t.arg("description") ?? t.arg("command"))
      case "Read", "Write", "Edit", "MultiEdit", "NotebookEdit", "NotebookRead":
        return fileName(t.arg("file_path") ?? t.arg("notebook_path"))
      case "Grep", "Glob": return t.arg("pattern") ?? ""
      case "WebSearch": return t.arg("query") ?? ""
      case "WebFetch": return URL(string: t.arg("url") ?? "")?.host() ?? t.arg("url") ?? ""
      case "Agent", "Task": return t.arg("description") ?? ""
      default: return ""
      }
    }
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

  static func firstLine(_ s: String?) -> String {
    guard let s else { return "" }
    return s.split(whereSeparator: \.isNewline).first.map(String.init) ?? s
  }

  // Counts per category, in a stable order, for the folded summary.
  static func counts(_ steps: [Step]) -> [(StepCategory, Int)] {
    var counts: [StepCategory: Int] = [:]
    for s in steps { counts[s.category, default: 0] += 1 }
    return StepCategory.allCases.compactMap { c in counts[c].map { (c, $0) } }
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
