// Block-level Markdown for replies. Inline styling (bold, code, links) is left
// to AttributedString; this only finds the blocks SwiftUI Text can't lay out.
import Foundation

enum MarkdownBlock: Hashable, Sendable {
  case heading(level: Int, text: String)
  case paragraph(String)
  case code(language: String, text: String)
  case list(ordered: Bool, start: Int, items: [ListItem])
  case quote(String)
  case table(header: [String], rows: [[String]])
  case rule

  struct ListItem: Hashable, Sendable {
    var indent: Int
    var text: String
    // nil when the item isn't a task; else whether it's ticked.
    var checked: Bool?
  }
}

enum Markdown {
  static func blocks(_ source: String) -> [MarkdownBlock] {
    let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
    var out: [MarkdownBlock] = []
    var para: [String] = []
    var i = 0

    func flushPara() {
      if !para.isEmpty { out.append(.paragraph(para.joined(separator: "\n"))) }
      para = []
    }

    while i < lines.count {
      let line = lines[i]
      let trimmed = line.trimmingCharacters(in: .whitespaces)

      // Fenced code: runs to the closing fence, or the end while streaming.
      if let fence = fenceOf(trimmed) {
        flushPara()
        let lang = String(trimmed.dropFirst(fence.count)).trimmingCharacters(in: .whitespaces)
        var code: [String] = []
        i += 1
        while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
          code.append(lines[i])
          i += 1
        }
        i += 1
        out.append(.code(language: lang, text: code.joined(separator: "\n")))
        continue
      }

      if trimmed.isEmpty {
        flushPara()
        i += 1
        continue
      }

      if let h = heading(trimmed) {
        flushPara()
        out.append(.heading(level: h.0, text: h.1))
        i += 1
        continue
      }

      if isRule(trimmed) {
        flushPara()
        out.append(.rule)
        i += 1
        continue
      }

      if trimmed.hasPrefix(">") {
        flushPara()
        var quote: [String] = []
        while i < lines.count {
          let t = lines[i].trimmingCharacters(in: .whitespaces)
          guard t.hasPrefix(">") else { break }
          var rest = t.dropFirst()
          if rest.hasPrefix(" ") { rest = rest.dropFirst() }
          quote.append(String(rest))
          i += 1
        }
        out.append(.quote(quote.joined(separator: "\n")))
        continue
      }

      if trimmed.hasPrefix("|"), i + 1 < lines.count, isTableSeparator(lines[i + 1]) {
        flushPara()
        let header = cells(trimmed)
        var rows: [[String]] = []
        i += 2
        while i < lines.count {
          let t = lines[i].trimmingCharacters(in: .whitespaces)
          guard t.hasPrefix("|") else { break }
          rows.append(cells(t))
          i += 1
        }
        out.append(.table(header: header, rows: rows))
        continue
      }

      if let first = listItem(line) {
        flushPara()
        var items: [MarkdownBlock.ListItem] = []
        let ordered = first.ordered
        let start = first.number ?? 1
        while i < lines.count {
          if let item = listItem(lines[i]) {
            // A top-level item of the other kind starts a new list.
            if item.indent == 0, item.ordered != ordered { break }
            items.append(MarkdownBlock.ListItem(indent: item.indent, text: item.text, checked: item.checked))
            i += 1
          } else if !lines[i].trimmingCharacters(in: .whitespaces).isEmpty, lines[i].hasPrefix("  "), !items.isEmpty {
            // A wrapped line belongs to the item above.
            items[items.count - 1].text += "\n" + lines[i].trimmingCharacters(in: .whitespaces)
            i += 1
          } else {
            break
          }
        }
        out.append(.list(ordered: ordered, start: start, items: items))
        continue
      }

      para.append(line)
      i += 1
    }
    flushPara()
    return out
  }

  static func inline(_ text: String) -> AttributedString {
    let options = AttributedString.MarkdownParsingOptions(interpretedSyntax: .inlineOnlyPreservingWhitespace, failurePolicy: .returnPartiallyParsedIfPossible)
    return (try? AttributedString(markdown: text, options: options)) ?? AttributedString(text)
  }

  private static func fenceOf(_ trimmed: String) -> String? {
    if trimmed.hasPrefix("```") { return "```" }
    if trimmed.hasPrefix("~~~") { return "~~~" }
    return nil
  }

  private static func heading(_ trimmed: String) -> (Int, String)? {
    let hashes = trimmed.prefix { $0 == "#" }.count
    guard (1...6).contains(hashes) else { return nil }
    let rest = trimmed.dropFirst(hashes)
    guard rest.first == " " else { return nil }
    return (hashes, rest.trimmingCharacters(in: .whitespaces))
  }

  private static func isRule(_ trimmed: String) -> Bool {
    let compact = trimmed.replacingOccurrences(of: " ", with: "")
    guard compact.count >= 3, let c = compact.first, "-*_".contains(c) else { return false }
    return compact.allSatisfy { $0 == c }
  }

  private static func isTableSeparator(_ line: String) -> Bool {
    let t = line.trimmingCharacters(in: .whitespaces)
    guard t.hasPrefix("|"), t.contains("-") else { return false }
    return t.allSatisfy { "|-: ".contains($0) }
  }

  private static func cells(_ row: String) -> [String] {
    var t = Substring(row)
    if t.hasPrefix("|") { t = t.dropFirst() }
    if t.hasSuffix("|") { t = t.dropLast() }
    return t.components(separatedBy: "|").map { $0.trimmingCharacters(in: .whitespaces) }
  }

  private static func listItem(_ line: String) -> (indent: Int, ordered: Bool, number: Int?, text: String, checked: Bool?)? {
    let indent = line.prefix { $0 == " " }.count
    let rest = line.dropFirst(indent)
    var ordered = false
    var number: Int?
    var body: Substring
    if let c = rest.first, "-*+".contains(c), rest.dropFirst().first == " " {
      body = rest.dropFirst(2)
    } else {
      let digits = rest.prefix { $0.isNumber }
      guard !digits.isEmpty, digits.count < 10 else { return nil }
      let after = rest.dropFirst(digits.count)
      guard let mark = after.first, mark == "." || mark == ")", after.dropFirst().first == " " else { return nil }
      ordered = true
      number = Int(digits)
      body = after.dropFirst(2)
    }
    var checked: Bool?
    if body.hasPrefix("[ ] ") { checked = false; body = body.dropFirst(4) }
    else if body.hasPrefix("[x] ") || body.hasPrefix("[X] ") { checked = true; body = body.dropFirst(4) }
    return (indent / 2, ordered, number, String(body), checked)
  }
}
