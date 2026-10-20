// Replies as native text, styled like the web's .md: 16.5pt body, gray list
// markers, tinted inline code and white code blocks with highlighting.
import SwiftUI
import UIKit

struct MarkdownView: View {
  let text: String
  var size: CGFloat = 16.5

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      ForEach(Array(Markdown.blocks(text).enumerated()), id: \.offset) { _, block in
        blockView(block)
      }
    }
    .font(.ui(size))
    .foregroundStyle(Color.text1)
    .textSelection(.enabled)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func blockView(_ block: MarkdownBlock) -> some View {
    switch block {
    case .heading(let level, let text):
      Text(Self.styled(text, size: level <= 1 ? 20 : level == 2 ? 18 : 17))
        .font(.ui(level <= 1 ? 20 : level == 2 ? 18 : 17, .semibold))
        .padding(.top, 6)
    case .paragraph(let text):
      Text(Self.styled(text, size: size))
        .lineSpacing(6)
        .fixedSize(horizontal: false, vertical: true)
    case .code(let language, let code):
      CodeBlockView(language: language, code: code)
    case .list(let ordered, let start, let items):
      VStack(alignment: .leading, spacing: 8) {
        ForEach(Array(items.enumerated()), id: \.offset) { i, item in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Group {
              if let checked = item.checked {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
              } else if ordered {
                Text(verbatim: "\(start + i).").monospacedDigit()
              } else {
                Text(verbatim: "•")
              }
            }
            .foregroundStyle(Color.text2)
            .frame(minWidth: 14, alignment: .trailing)
            Text(Self.styled(item.text, size: size))
              .lineSpacing(6)
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(.leading, CGFloat(item.indent) * 22)
        }
      }
    case .quote(let text):
      HStack(spacing: 11) {
        Rectangle().fill(Color.line).frame(width: 3)
        Text(Self.styled(text, size: size))
          .foregroundStyle(Color.text2)
          .lineSpacing(6)
          .fixedSize(horizontal: false, vertical: true)
      }
    case .table(let header, let rows):
      ScrollView(.horizontal, showsIndicators: false) {
        Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
          GridRow {
            ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
              tableCell(cell, header: true)
            }
          }
          ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
            GridRow {
              ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                tableCell(cell, header: false)
              }
            }
          }
        }
        .overlay(Rectangle().strokeBorder(Color.line))
      }
    case .rule:
      Rectangle().fill(Color.line).frame(height: 1).padding(.vertical, 4)
    }
  }

  private func tableCell(_ text: String, header: Bool) -> some View {
    Text(Self.styled(text, size: 14))
      .font(.ui(14, header ? .semibold : .regular))
      .lineLimit(1)
      .padding(.horizontal, 11)
      .padding(.vertical, 7)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(header ? Color.rowFill : Color.clear)
      .border(Color.line, width: 0.5)
  }

  // Inline markdown with the web's code and link looks.
  static func styled(_ text: String, size: CGFloat) -> AttributedString {
    var a = Markdown.inline(text)
    var codes: [Range<AttributedString.Index>] = []
    for run in a.runs {
      if run.inlinePresentationIntent?.contains(.code) == true { codes.append(run.range) }
      if run.link != nil {
        a[run.range].underlineStyle = Text.LineStyle.single
        a[run.range].foregroundColor = Color.text1
      }
      if run.inlinePresentationIntent?.contains(.stronglyEmphasized) == true {
        a[run.range].font = Font.ui(size, .semibold)
      }
    }
    for range in codes.reversed() {
      var code = AttributedString("\u{2009}" + String(a[range].characters) + "\u{2009}")
      code.font = Font.mono(size * 0.84)
      code.backgroundColor = Color.inlineCode
      a.replaceSubrange(range, with: code)
    }
    return a
  }
}

struct CodeBlockView: View {
  let language: String
  let code: String

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      Text(Highlight.code(code, language: language))
        .font(.mono(13))
        .lineSpacing(7)
        .fixedSize(horizontal: true, vertical: true)
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }
    .background(Color.surface, in: .rect(cornerRadius: 18))
    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(Color.line))
    .contextMenu {
      Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = code }
    }
  }
}

// A small highlighter with the web's colors: keywords, strings, numbers,
// calls and types, comments.
enum Highlight {
  static let keyword = Color(light: 0x8C3FA8, dark: 0xC58AF9)
  static let string = Color(light: 0x2F7A3C, dark: 0x7FC48A)
  static let number = Color(light: 0xB0661F, dark: 0xE0A060)
  static let title = Color(light: 0x2457A8, dark: 0x79A8FF)

  private static let keywords: Set<String> = [
    "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "def", "default", "defer", "do", "elif", "else", "enum",
    "export", "extends", "extension", "fi", "for", "from", "fn", "func", "function", "go", "guard", "if", "impl", "import", "in", "interface",
    "is", "let", "match", "mod", "mut", "new", "package", "private", "protocol", "pub", "public", "return", "static", "struct", "switch",
    "then", "throw", "throws", "trait", "try", "type", "typeof", "use", "var", "where", "while", "with", "yield", "lambda", "pass", "raise",
    "except", "finally", "not", "and", "or", "echo", "local", "readonly", "implements", "instanceof", "delete", "void", "of",
  ]
  private static let builtins: Set<String> = [
    "string", "number", "boolean", "any", "unknown", "never", "int", "str", "bool", "float", "true", "false", "null", "nil", "undefined",
    "None", "True", "False", "self", "this", "Self", "super",
  ]
  private static let hashLanguages: Set<String> = ["sh", "bash", "shell", "zsh", "console", "py", "python", "yaml", "yml", "toml", "rb", "ruby", "dockerfile", "makefile", "conf", "ini", "caddyfile"]

  nonisolated(unsafe) private static let slashPattern = try! NSRegularExpression(pattern: #"(//[^\n]*|/\*[\s\S]*?\*/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)"#)
  nonisolated(unsafe) private static let hashPattern = try! NSRegularExpression(pattern: #"(#[^\n]*)|("(?:\\.|[^"\\\n])*"|'[^'\n]*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$-]*)"#)

  static func code(_ code: String, language: String) -> AttributedString {
    let lang = language.lowercased()
    if ["", "text", "txt", "plain", "diff", "markdown", "md"].contains(lang) { return AttributedString(code) }
    let regex = hashLanguages.contains(lang) ? hashPattern : slashPattern
    let ns = code as NSString
    var out = AttributedString()
    var last = 0
    for m in regex.matches(in: code, range: NSRange(location: 0, length: ns.length)) {
      if m.range.location > last { out += AttributedString(ns.substring(with: NSRange(location: last, length: m.range.location - last))) }
      let token = ns.substring(with: m.range)
      var piece = AttributedString(token)
      if m.range(at: 1).location != NSNotFound {
        piece.foregroundColor = Color.text3
      } else if m.range(at: 2).location != NSNotFound {
        piece.foregroundColor = string
      } else if m.range(at: 3).location != NSNotFound {
        piece.foregroundColor = number
      } else if keywords.contains(token) {
        piece.foregroundColor = keyword
      } else if builtins.contains(token) {
        piece.foregroundColor = number
      } else {
        let end = m.range.location + m.range.length
        let next = end < ns.length ? ns.substring(with: NSRange(location: end, length: 1)) : ""
        if next == "(" || token.first?.isUppercase == true { piece.foregroundColor = title }
      }
      out += piece
      last = m.range.location + m.range.length
    }
    if last < ns.length { out += AttributedString(ns.substring(from: last)) }
    return out
  }
}
