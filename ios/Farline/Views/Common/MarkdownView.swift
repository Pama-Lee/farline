// Replies as native text: paragraphs, headings, lists, quotes, tables and
// code blocks, with inline styling from AttributedString.
import SwiftUI
import UIKit

struct MarkdownView: View {
  let text: String

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      ForEach(Array(Markdown.blocks(text).enumerated()), id: \.offset) { _, block in
        blockView(block)
      }
    }
    .textSelection(.enabled)
    .frame(maxWidth: .infinity, alignment: .leading)
  }

  @ViewBuilder
  private func blockView(_ block: MarkdownBlock) -> some View {
    switch block {
    case .heading(let level, let text):
      Text(Markdown.inline(text))
        .font(level <= 1 ? .title2.bold() : level == 2 ? .title3.bold() : .headline)
        .padding(.top, 4)
    case .paragraph(let text):
      Text(Markdown.inline(text))
        .lineSpacing(3)
        .fixedSize(horizontal: false, vertical: true)
    case .code(let language, let code):
      CodeBlockView(language: language, code: code)
    case .list(let ordered, let start, let items):
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(items.enumerated()), id: \.offset) { i, item in
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Group {
              if let checked = item.checked {
                Image(systemName: checked ? "checkmark.square.fill" : "square")
                  .foregroundStyle(checked ? AnyShapeStyle(.tint) : AnyShapeStyle(.secondary))
              } else if ordered {
                Text(verbatim: "\(start + i).").monospacedDigit()
              } else {
                Text(verbatim: item.indent > 0 ? "◦" : "•")
              }
            }
            .foregroundStyle(.secondary)
            .frame(minWidth: 14, alignment: .trailing)
            Text(Markdown.inline(item.text))
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(.leading, CGFloat(item.indent) * 18)
        }
      }
    case .quote(let text):
      HStack(spacing: 10) {
        Capsule().fill(.tertiary).frame(width: 3)
        Text(Markdown.inline(text))
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }
    case .table(let header, let rows):
      ScrollView(.horizontal, showsIndicators: false) {
        Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 8) {
          GridRow {
            ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
              Text(Markdown.inline(cell)).fontWeight(.semibold)
            }
          }
          Divider()
          ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
            GridRow {
              ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                Text(Markdown.inline(cell))
              }
            }
          }
        }
        .font(.subheadline)
        .padding(12)
      }
      .background(.fill.quinary, in: .rect(cornerRadius: 14))
    case .rule:
      Divider()
    }
  }
}

struct CodeBlockView: View {
  let language: String
  let code: String

  @State private var copied = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Text(verbatim: language.isEmpty ? "code" : language)
          .font(.caption.weight(.medium))
          .foregroundStyle(.secondary)
        Spacer()
        Button {
          UIPasteboard.general.string = code
          copied = true
          Task {
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
          }
        } label: {
          Image(systemName: copied ? "checkmark" : "doc.on.doc")
            .contentTransition(.symbolEffect(.replace))
            .font(.caption)
        }
        .buttonStyle(.borderless)
        .sensoryFeedback(.success, trigger: copied) { _, new in new }
      }
      .padding(.horizontal, 12)
      .padding(.top, 8)
      ScrollView(.horizontal, showsIndicators: false) {
        Text(verbatim: code)
          .font(.system(.footnote, design: .monospaced))
          .fixedSize(horizontal: true, vertical: true)
          .padding(12)
      }
    }
    .background(.fill.quinary, in: .rect(cornerRadius: 14))
  }
}
