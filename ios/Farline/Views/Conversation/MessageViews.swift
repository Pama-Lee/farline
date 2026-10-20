// The pieces of a conversation: the user's turns, replies, steps, and cards.
import SwiftUI
import UIKit

struct UserBubble: View {
  let item: UserItem
  let api: APIClient

  var body: some View {
    VStack(alignment: .trailing, spacing: 6) {
      if let images = item.images, !images.isEmpty {
        HStack(spacing: 6) {
          ForEach(images, id: \.url) { image in
            RemoteImage(url: api.url(image.url))
              .frame(width: 96, height: 96)
              .clipShape(.rect(cornerRadius: 14))
          }
        }
      }
      if let files = item.files?.filter({ !isImagePath($0) }), !files.isEmpty {
        ForEach(files, id: \.self) { f in
          Label(StepText.fileName(f), systemImage: "doc")
            .font(.footnote)
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.fill.tertiary, in: .capsule)
        }
      }
      if !item.text.isEmpty {
        Text(item.text)
          .textSelection(.enabled)
          .padding(.horizontal, 14)
          .padding(.vertical, 10)
          .background(.fill.secondary, in: .rect(cornerRadius: 20))
      }
      ReactionsRow(reactions: item.reactions)
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .padding(.leading, 48)
  }
}

struct ReplyView: View {
  let item: TextItem

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      MarkdownView(text: item.text)
      HStack(spacing: 8) {
        if item.edited == true {
          Text("Edited")
            .font(.caption2)
            .foregroundStyle(.tertiary)
        }
        ReactionsRow(reactions: item.reactions)
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

struct ReactionsRow: View {
  let reactions: [Reaction]?

  var body: some View {
    if let reactions, !reactions.isEmpty {
      HStack(spacing: 4) {
        ForEach(Array(reactions.enumerated()), id: \.offset) { _, r in
          Text(r.emoji)
            .font(.callout)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(r.by == "user" ? AnyShapeStyle(.tint.opacity(0.18)) : AnyShapeStyle(.fill.tertiary), in: .capsule)
        }
      }
    }
  }
}

// Tool calls and thinking in a row, folded into one line until opened.
struct StepsView: View {
  let steps: [Step]
  let live: Bool
  let model: SessionModel
  let onOpen: (Step) -> Void

  @State private var expanded = false

  private var runningStep: Step? {
    guard live else { return nil }
    if let tool = steps.last(where: { $0.tool?.running == true }) { return tool }
    if let last = steps.last, case .thinking(let t) = last, t.streaming == true { return last }
    return nil
  }

  private var pending: [ToolItem] {
    steps.compactMap { s in
      guard let t = s.tool, t.permission?.pending == true else { return nil }
      return t
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      Button {
        withAnimation(.smooth) { expanded.toggle() }
      } label: {
        HStack(spacing: 8) {
          if let run = runningStep {
            Image(systemName: run.category.symbol)
              .symbolEffect(.pulse, options: .repeat(.continuous))
            StepLabel(step: run)
          } else if steps.count == 1, let only = steps.first {
            Image(systemName: only.category.symbol)
            StepLabel(step: only)
          } else {
            Image(systemName: "list.bullet")
            summary
          }
          Spacer(minLength: 4)
          Image(systemName: "chevron.right")
            .font(.caption.weight(.semibold))
            .rotationEffect(.degrees(expanded ? 90 : 0))
        }
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .lineLimit(1)
        .contentShape(.rect)
      }
      .buttonStyle(.plain)

      if expanded {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(steps) { step in
            Button {
              onOpen(step)
            } label: {
              HStack(spacing: 10) {
                Image(systemName: step.category.symbol)
                  .frame(width: 18)
                  .foregroundStyle(step.tool?.failed == true ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
                StepLabel(step: step)
                  .lineLimit(1)
                Spacer(minLength: 4)
                if step.tool?.running == true && live {
                  ProgressView().controlSize(.mini)
                }
              }
              .font(.subheadline)
              .padding(.vertical, 8)
              .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if step.id != steps.last?.id { Divider().padding(.leading, 28) }
          }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(.fill.quinary, in: .rect(cornerRadius: 16))
        .transition(.opacity.combined(with: .scale(scale: 0.98, anchor: .top)))
      }

      ForEach(pending, id: \.id) { tool in
        PermissionCard(tool: tool, model: model)
      }
    }
  }

  private var summary: Text {
    let joined = StepText.counts(steps).map { category, n in categoryText(category, n) }.formatted(.list(type: .and, width: .narrow))
    return Text(verbatim: joined.prefix(1).uppercased() + joined.dropFirst())
  }

  private func categoryText(_ c: StepCategory, _ n: Int) -> String {
    let text: AttributedString = switch c {
    case .bash: AttributedString(localized: "ran ^[\(n) command](inflect: true)")
    case .read: AttributedString(localized: "read ^[\(n) file](inflect: true)")
    case .edit: AttributedString(localized: "edited ^[\(n) file](inflect: true)")
    case .search: AttributedString(localized: "searched ^[\(n) time](inflect: true)")
    case .web: AttributedString(localized: "browsed the web")
    case .agent: AttributedString(localized: "ran ^[\(n) agent](inflect: true)")
    case .todo: AttributedString(localized: "updated the plan")
    case .think: AttributedString(localized: "thought")
    case .other: AttributedString(localized: "used ^[\(n) tool](inflect: true)")
    }
    return String(text.characters)
  }
}

struct StepLabel: View {
  let step: Step

  var body: some View {
    let detail = StepText.detail(step)
    switch step {
    case .thinking:
      Text("Thought") + Text(verbatim: detail.isEmpty ? "" : "  " + detail).foregroundStyle(.tertiary)
    case .tool(let t):
      Text(StepText.toolName(t.name)).fontWeight(.medium) + Text(verbatim: detail.isEmpty ? "" : "  " + detail).foregroundStyle(.tertiary)
    }
  }
}

struct PermissionCard: View {
  let tool: ToolItem
  let model: SessionModel

  @State private var sending = false
  @State private var decided = 0

  var body: some View {
    let ask = tool.permission!
    VStack(alignment: .leading, spacing: 12) {
      Label {
        Text(ask.title ?? headline)
          .font(.headline)
      } icon: {
        Image(systemName: "hand.raised.fill")
          .foregroundStyle(.orange)
      }
      if let d = ask.description, !body_.hasSuffix(d) {
        Text(d).font(.subheadline).foregroundStyle(.secondary)
      }
      if !body_.isEmpty {
        ScrollView {
          Text(body_)
            .font(.system(.footnote, design: .monospaced))
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(10)
        }
        .frame(maxHeight: 180)
        .background(.fill.tertiary, in: .rect(cornerRadius: 12))
      }
      GlassEffectContainer(spacing: 10) {
        HStack(spacing: 10) {
          Button(role: .destructive) {
            decide(.deny)
          } label: {
            Text("Deny").frame(maxWidth: .infinity)
          }
          .buttonStyle(.glass)
          Button {
            decide(.allow)
          } label: {
            Text("Allow").fontWeight(.semibold).frame(maxWidth: .infinity)
          }
          .buttonStyle(.glassProminent)
        }
        .controlSize(.large)
      }
      if ask.canAlways {
        Button("Always allow this") { decide(.always) }
          .font(.footnote)
          .frame(maxWidth: .infinity)
      }
    }
    .disabled(sending)
    .padding(16)
    .background(.background.secondary, in: .rect(cornerRadius: 24))
    .overlay {
      RoundedRectangle(cornerRadius: 24).strokeBorder(.orange.opacity(0.35), lineWidth: 1)
    }
    .sensoryFeedback(.impact(weight: .medium), trigger: decided)
  }

  private var headline: String {
    switch tool.name {
    case "Bash": String(localized: "Run a command?")
    case "Write": String(localized: "Write a file?")
    case "Edit", "MultiEdit": String(localized: "Edit a file?")
    case "WebFetch": String(localized: "Open a web page?")
    case "ExitPlanMode": String(localized: "Start on this plan?")
    default: String(localized: "Use \(StepText.toolName(tool.name))?")
    }
  }

  private var body_: String {
    switch tool.name {
    case "Bash": tool.arg("command") ?? ""
    case "Write", "Edit", "MultiEdit": tool.arg("file_path") ?? ""
    case "WebFetch": tool.arg("url") ?? ""
    case "ExitPlanMode": tool.arg("plan") ?? ""
    default: JSONValue.object(tool.input).pretty
    }
  }

  private func decide(_ d: APIClient.Decision) {
    guard let ask = tool.permission else { return }
    sending = true
    decided += 1
    Task {
      defer { sending = false }
      try? await model.decide(ask.reqId, d)
    }
  }
}

struct AskCard: View {
  let item: AskItem
  let model: SessionModel

  @State private var picked: [String: [String]] = [:]
  @State private var other: [String: String] = [:]
  @State private var sending = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Label("Question", systemImage: "questionmark.bubble")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
      if item.pending { pendingBody } else { answeredBody }
    }
    .padding(16)
    .background(.background.secondary, in: .rect(cornerRadius: 24))
  }

  private var answeredBody: some View {
    let answers = Answers.parse(item.answer)
    return ForEach(item.questions, id: \.question) { q in
      VStack(alignment: .leading, spacing: 4) {
        Text(q.question).font(.subheadline).foregroundStyle(.secondary)
        Text(answers[q.question] ?? (item.status == "cancelled" ? String(localized: "Skipped") : ""))
      }
    }
  }

  private var pendingBody: some View {
    VStack(alignment: .leading, spacing: 18) {
      ForEach(item.questions, id: \.question) { q in
        VStack(alignment: .leading, spacing: 8) {
          Text(q.question).font(.headline)
          ForEach(q.options, id: \.label) { o in
            let on = picked[q.question]?.contains(o.label) == true
            Button {
              toggle(q, o.label)
            } label: {
              HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                  Text(o.label).fontWeight(.medium)
                  if let d = o.description {
                    Text(d).font(.footnote).foregroundStyle(.secondary)
                  }
                }
                Spacer(minLength: 8)
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                  .foregroundStyle(on ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                  .contentTransition(.symbolEffect(.replace))
              }
              .multilineTextAlignment(.leading)
              .padding(.horizontal, 14)
              .padding(.vertical, 10)
              .frame(maxWidth: .infinity, alignment: .leading)
              .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .glassEffect(on ? .regular.tint(.accentColor.opacity(0.25)).interactive() : .regular.interactive(), in: .rect(cornerRadius: 16))
            .sensoryFeedback(.selection, trigger: on)
          }
          TextField("Something else", text: Binding(get: { other[q.question] ?? "" }, set: { other[q.question] = $0 }), axis: .vertical)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(.fill.tertiary, in: .rect(cornerRadius: 16))
        }
      }
      GlassEffectContainer(spacing: 10) {
        HStack(spacing: 10) {
          Button { submit(skip: true) } label: { Text("Skip").frame(maxWidth: .infinity) }
            .buttonStyle(.glass)
          Button { submit(skip: false) } label: { Text("Send").fontWeight(.semibold).frame(maxWidth: .infinity) }
            .buttonStyle(.glassProminent)
            .disabled(!ready)
        }
        .controlSize(.large)
      }
      .disabled(sending)
    }
  }

  private func answer(_ q: String) -> String {
    let extra = other[q]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return ((picked[q] ?? []) + (extra.isEmpty ? [] : [extra])).joined(separator: ", ")
  }

  private var ready: Bool { item.questions.allSatisfy { !answer($0.question).isEmpty } }

  private func toggle(_ q: Question, _ label: String) {
    var cur = picked[q.question] ?? []
    if cur.contains(label) { cur.removeAll { $0 == label } }
    else if q.multiSelect == true { cur.append(label) }
    else { cur = [label] }
    picked[q.question] = cur
  }

  private func submit(skip: Bool) {
    guard let reqId = item.reqId else { return }
    sending = true
    let answers = skip ? nil : Dictionary(uniqueKeysWithValues: item.questions.map { ($0.question, answer($0.question)) })
    Task {
      defer { sending = false }
      try? await model.answer(reqId, answers)
    }
  }
}

struct NoticeView: View {
  let item: NoticeItem

  var body: some View {
    Label(text, systemImage: item.level == "error" ? "exclamationmark.triangle" : "info.circle")
      .font(.footnote)
      .foregroundStyle(item.level == "error" ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
      .frame(maxWidth: .infinity)
  }

  private var text: String {
    item.code == "interrupted" ? String(localized: "Interrupted") : item.text
  }
}

struct TaskRow: View {
  let item: TaskItem

  var body: some View {
    let event = item.status == nil
    HStack(spacing: 8) {
      Image(systemName: event ? "waveform.path.ecg" : item.status == "completed" ? "checkmark.circle" : item.status == "failed" ? "xmark.octagon" : "stop.circle")
        .foregroundStyle(item.status == "failed" ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
      Text(title).fontWeight(.medium)
      Text(event ? item.summary.replacingOccurrences(of: "Monitor event: ", with: "") : item.summary)
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
    .font(.subheadline)
  }

  private var title: LocalizedStringKey {
    switch item.status {
    case nil: "Monitor"
    case "completed": "Background task finished"
    case "failed": "Background task failed"
    default: "Background task stopped"
    }
  }
}

struct WorkingIndicator: View {
  let since: Date?

  var body: some View {
    TimelineView(.periodic(from: .now, by: 1)) { context in
      HStack(spacing: 8) {
        Image(systemName: "sparkle")
          .symbolEffect(.breathe, options: .repeat(.continuous))
          .foregroundStyle(.tint)
        Text("Working")
        if let since {
          Text(Duration.seconds(max(0, context.date.timeIntervalSince(since))), format: .units(allowed: [.minutes, .seconds], width: .narrow))
            .monospacedDigit()
        }
      }
      .font(.subheadline)
      .foregroundStyle(.secondary)
    }
  }
}

struct RemoteImage: View {
  let url: URL

  var body: some View {
    AsyncImage(url: url) { phase in
      switch phase {
      case .success(let image): image.resizable().scaledToFill()
      case .failure: Image(systemName: "photo").foregroundStyle(.secondary)
      default: Rectangle().fill(.fill.tertiary)
      }
    }
  }
}

func isImagePath(_ path: String) -> Bool {
  ["png", "jpg", "jpeg", "gif", "webp", "heic"].contains((path as NSString).pathExtension.lowercased())
}
