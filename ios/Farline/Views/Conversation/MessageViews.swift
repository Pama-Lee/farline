// The pieces of a conversation, drawn like the web's: the user's bubble,
// replies, the gray steps line, and the permission and question cards.
import AVFoundation
import SwiftUI
import UIKit

struct UserMessage: View {
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
          Label {
            Text(verbatim: StepText.fileName(f).replacing(/^[\w-]{12}-/, with: ""))
          } icon: {
            Image(systemName: "doc.text")
          }
          .font(.ui(15))
          .foregroundStyle(Color.text2)
          .lineLimit(1)
          .padding(.horizontal, 12)
          .padding(.vertical, 7)
          .background(Color.surface, in: .rect(cornerRadius: 14))
          .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(Color.line))
        }
      }
      if !item.text.isEmpty {
        Text(item.text)
          .font(.ui(16.5))
          .lineSpacing(4)
          .foregroundStyle(Color.text1)
          .padding(.horizontal, 15)
          .padding(.vertical, 10)
          .background(Color.tile, in: .rect(cornerRadius: 20))
      }
      ReactionPills(reactions: item.reactions)
    }
    .frame(maxWidth: .infinity, alignment: .trailing)
    .padding(.leading, 56)
  }
}

struct ReactionPills: View {
  let reactions: [Reaction]?

  var body: some View {
    if let reactions, !reactions.isEmpty {
      HStack(spacing: 6) {
        ForEach(groups, id: \.emoji) { g in
          HStack(spacing: 5) {
            Text(verbatim: g.emoji).font(.ui(16))
            Text(verbatim: "\(g.count)").font(.ui(13.5)).foregroundStyle(Color.text2)
          }
          .padding(.leading, 8)
          .padding(.trailing, 10)
          .frame(height: 30)
          .background(g.mine ? Color.fillGray : Color.surface, in: .capsule)
          .overlay(Capsule().strokeBorder(g.agent ? Color.text3 : Color.line))
        }
      }
    }
  }

  private var groups: [(emoji: String, count: Int, mine: Bool, agent: Bool)] {
    var out: [(emoji: String, count: Int, mine: Bool, agent: Bool)] = []
    for r in reactions ?? [] {
      if let i = out.firstIndex(where: { $0.emoji == r.emoji }) {
        out[i].count += 1
        out[i].mine = out[i].mine || r.by == "user"
        out[i].agent = out[i].agent || r.by != "user"
      } else {
        out.append((r.emoji, 1, r.by == "user", r.by != "user"))
      }
    }
    return out
  }
}

// Copy, read aloud, react and edit, under the last reply of a turn.
struct MsgActions: View {
  let item: TextItem
  let canEdit: Bool
  let onCopy: () -> Void
  let onReact: (String) -> Void
  let onEdit: () -> Void

  @State private var speaker = Speaker.shared

  var body: some View {
    HStack(spacing: 0) {
      button("Copy", "doc.on.doc", action: onCopy)
      button("Read aloud", speaker.speakingId == item.id ? "stop" : "play") {
        speaker.toggle(item.id, text: item.text)
      }
      Menu {
        ReactionButtons(onPick: onReact)
      } label: {
        icon("face.smiling")
      }
      .accessibilityLabel(Text("React"))
      if canEdit {
        button("Edit", "square.and.pencil", action: onEdit)
      }
    }
    .foregroundStyle(Color.text2)
    .padding(.leading, -6)
  }

  private func button(_ label: LocalizedStringKey, _ symbol: String, action: @escaping () -> Void) -> some View {
    Button(action: action) { icon(symbol) }
      .buttonStyle(PressStyle())
      .accessibilityLabel(Text(label))
  }

  private func icon(_ symbol: String) -> some View {
    Image(systemName: symbol)
      .font(.ui(16, .light))
      .contentTransition(.symbolEffect(.replace))
      .frame(width: 34, height: 34)
      .contentShape(.rect)
  }
}

struct ReactionButtons: View {
  let onPick: (String) -> Void
  static let emoji = ["👍", "❤️", "😂", "🎉", "👀", "🙏"]

  var body: some View {
    ControlGroup {
      ForEach(Self.emoji, id: \.self) { e in
        Button { onPick(e) } label: { Text(verbatim: e) }
      }
    }
    .controlGroupStyle(.compactMenu)
  }
}

// Reads a reply aloud with the system voice.
@MainActor
@Observable
final class Speaker {
  static let shared = Speaker()

  private let synth = AVSpeechSynthesizer()
  private(set) var speakingId: String?

  func toggle(_ id: String, text: String) {
    synth.stopSpeaking(at: .immediate)
    if speakingId == id {
      speakingId = nil
      return
    }
    let plain = text.replacing(/```[\s\S]*?```/, with: "").replacing(/[`*_#>|]/, with: " ")
    let utterance = AVSpeechUtterance(string: plain)
    utterance.voice = AVSpeechSynthesisVoice(language: plain.contains(/\p{Script=Han}/) ? "zh-CN" : "en-US")
    synth.speak(utterance)
    speakingId = id
    Task {
      try? await Task.sleep(for: .seconds(0.6))
      while synth.isSpeaking { try? await Task.sleep(for: .seconds(0.3)) }
      if speakingId == id { speakingId = nil }
    }
  }
}

// Tool calls and thinking in a row, folded into one gray line that opens a sheet.
struct StepsRow: View {
  let steps: [Step]
  let live: Bool
  let onOpen: () -> Void

  private var runningStep: Step? {
    guard live else { return nil }
    return steps.last { s in
      switch s {
      case .tool(let t): t.running
      case .thinking(let t): t.streaming == true
      }
    }
  }

  var body: some View {
    Button(action: onOpen) {
      HStack(spacing: 5) {
        if let run = runningStep {
          Ring(size: 16, width: 2)
          let l = StepText.label(run)
          Text(verbatim: "\(l.title) \(l.detail)")
        } else if steps.count == 1, let only = steps.first {
          let l = StepText.label(only)
          Text(verbatim: l.title).foregroundStyle(only.tool?.failed == true ? Color.fRed : Color.text2)
            + Text(verbatim: " \(l.detail)")
        } else {
          Text(verbatim: StepText.summary(steps))
        }
        Image(systemName: "chevron.right")
          .font(.ui(13, .medium))
      }
      .font(.ui(14.5))
      .foregroundStyle(Color.text2)
      .lineLimit(1)
      .contentShape(.rect)
    }
    .buttonStyle(PressStyle())
  }
}

// Asks before a tool runs; pinned above the composer.
struct PermissionCard: View {
  let tool: ToolItem
  let model: SessionModel

  @State private var sending = false
  @State private var decided = 0
  @State private var detailHeight: CGFloat = 0

  var body: some View {
    let ask = tool.permission!
    VStack(alignment: .leading, spacing: 0) {
      Text(ask.title ?? headline)
        .font(.ui(15.5, .semibold))
        .foregroundStyle(Color.text1)
      if let d = ask.description, !detail.hasSuffix(d) {
        Text(d)
          .font(.ui(13.5))
          .foregroundStyle(Color.text2)
          .padding(.top, 2)
      }
      if !detail.isEmpty {
        ScrollView {
          Text(verbatim: detail)
            .font(.mono(14))
            .foregroundStyle(Color.text1)
            .textSelection(.enabled)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { detailHeight = $0 }
        }
        .scrollBounceBehavior(.basedOnSize)
        .frame(height: min(132, max(detailHeight, 1)))
        .background(Color.bg, in: .rect(cornerRadius: 14))
        .padding(.top, 12)
      }
      HStack(spacing: 10) {
        Button("Deny") { decide(.deny) }
          .buttonStyle(OutlineButtonStyle())
        Button("Allow") { decide(.allow) }
          .buttonStyle(InkButtonStyle())
      }
      .padding(.top, 14)
      if ask.canAlways {
        Button("Always allow") { decide(.always) }
          .font(.ui(15))
          .foregroundStyle(Color.text2)
          .frame(maxWidth: .infinity)
          .padding(6)
          .padding(.top, 8)
      }
    }
    .disabled(sending)
    .padding(.horizontal, 18)
    .padding(.top, 18)
    .padding(.bottom, ask.canAlways ? 8 : 18)
    .background(Color.surface, in: .rect(cornerRadius: 28))
    .shadow(color: .black.opacity(0.08), radius: 12, y: 6)
    .sensoryFeedback(.impact(weight: .medium), trigger: decided)
  }

  private var headline: String {
    switch tool.name {
    case "Bash": String(localized: "Allow this command?")
    case "Write": String(localized: "Allow writing this file?")
    case "Edit", "MultiEdit": String(localized: "Allow editing this file?")
    case "WebFetch": String(localized: "Allow opening this page?")
    case "ExitPlanMode": String(localized: "Start on this plan?")
    default: String(localized: "Allow \(StepText.toolName(tool.name))?")
    }
  }

  private var detail: String {
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

// The agent's multiple-choice questions.
struct AskCard: View {
  let item: AskItem
  let model: SessionModel

  @State private var picked: [String: [String]] = [:]
  @State private var other: [String: String] = [:]
  @State private var sending = false

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      Text("Question")
        .font(.ui(13.5))
        .foregroundStyle(Color.text2)
        .padding(.bottom, 2)
      if item.pending { pendingBody } else { answeredBody }
    }
    .padding(.horizontal, 18)
    .padding(.top, 16)
    .padding(.bottom, 18)
    .frame(maxWidth: .infinity, alignment: .leading)
    .overlay(RoundedRectangle(cornerRadius: 22).strokeBorder(Color.line))
  }

  private var answeredBody: some View {
    let answers = Answers.parse(item.answer)
    return ForEach(item.questions, id: \.question) { q in
      Text(q.question)
        .font(.ui(15))
        .foregroundStyle(Color.text2)
        .padding(.top, 10)
      Text(answers[q.question] ?? (item.status == "cancelled" ? String(localized: "Skipped") : ""))
        .font(.ui(16.5))
        .foregroundStyle(Color.text1)
        .padding(.top, 2)
    }
  }

  private var pendingBody: some View {
    VStack(alignment: .leading, spacing: 0) {
      ForEach(item.questions, id: \.question) { q in
        Text(q.question)
          .font(.ui(15))
          .foregroundStyle(Color.text1)
          .padding(.top, 10)
        FlowLayout(spacing: 8) {
          ForEach(q.options, id: \.label) { o in
            let on = picked[q.question]?.contains(o.label) == true
            Button {
              toggle(q, o.label)
            } label: {
              VStack(alignment: .leading, spacing: 1) {
                Text(o.label).font(.ui(15))
                if let d = o.description {
                  Text(d).font(.ui(13)).opacity(0.7)
                }
              }
              .multilineTextAlignment(.leading)
              .foregroundStyle(on ? Color.onInk : Color.text1)
              .padding(.horizontal, 14)
              .padding(.vertical, 8)
              .background(on ? Color.ink : Color.surface, in: .rect(cornerRadius: 16))
              .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(on ? Color.ink : Color.line))
            }
            .buttonStyle(PressStyle())
            .sensoryFeedback(.selection, trigger: on)
          }
        }
        .padding(.top, 10)
        TextField("Other", text: Binding(get: { other[q.question] ?? "" }, set: { other[q.question] = $0 }))
          .font(.ui(16))
          .padding(.horizontal, 14)
          .padding(.vertical, 11)
          .background(Color.surface, in: .rect(cornerRadius: 16))
          .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(Color.line))
          .padding(.top, 10)
          .padding(.bottom, 6)
      }
      HStack(spacing: 10) {
        Button("Skip") { submit(skip: true) }
          .buttonStyle(OutlineButtonStyle())
        Button("Submit") { submit(skip: false) }
          .buttonStyle(InkButtonStyle())
          .disabled(!ready)
      }
      .disabled(sending)
      .padding(.top, 14)
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

// Lays children out in rows, wrapping like inline content.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? .infinity
    var x: CGFloat = 0, y: CGFloat = 0, rowHeight: CGFloat = 0, widest: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(ProposedViewSize(width: width, height: nil))
      if x > 0, x + s.width > width {
        y += rowHeight + spacing
        x = 0
        rowHeight = 0
      }
      x += s.width + spacing
      rowHeight = max(rowHeight, s.height)
      widest = max(widest, x - spacing)
    }
    return CGSize(width: min(widest, width), height: y + rowHeight)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var x = bounds.minX, y = bounds.minY, rowHeight: CGFloat = 0
    for v in subviews {
      let s = v.sizeThatFits(ProposedViewSize(width: bounds.width, height: nil))
      if x > bounds.minX, x + s.width > bounds.maxX {
        y += rowHeight + spacing
        x = bounds.minX
        rowHeight = 0
      }
      v.place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(s))
      x += s.width + spacing
      rowHeight = max(rowHeight, s.height)
    }
  }
}

struct NoticeView: View {
  let item: NoticeItem

  var body: some View {
    if item.level == "error" {
      Text(item.text)
        .font(.ui(14))
        .foregroundStyle(Color.fRed)
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.fRed.opacity(0.08), in: .rect(cornerRadius: 16))
    } else {
      Text(item.code == "interrupted" ? String(localized: "Interrupted") : item.text)
        .font(.ui(14))
        .foregroundStyle(Color.text3)
        .multilineTextAlignment(.center)
        .frame(maxWidth: .infinity)
    }
  }
}

struct TaskRow: View {
  let item: TaskItem

  var body: some View {
    let event = item.status == nil
    HStack(spacing: 6) {
      Image(systemName: event ? "waveform.path.ecg" : item.status == "completed" ? "checkmark.circle" : item.status == "failed" ? "xmark.circle" : "stop.circle")
        .font(.ui(15))
      Text(title).foregroundStyle(item.status == "failed" ? Color.fRed : Color.text2)
        + Text(verbatim: " " + (event ? item.summary.replacingOccurrences(of: "Monitor event: ", with: "") : item.summary))
    }
    .font(.ui(14.5))
    .foregroundStyle(Color.text2)
    .lineLimit(1)
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

// Three orange dots and the time the turn has run.
struct ThinkingIndicator: View {
  let since: Date?

  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 30)) { context in
      let t = context.date.timeIntervalSinceReferenceDate
      let secs = Int(max(0, context.date.timeIntervalSince(since ?? context.date)))
      HStack(spacing: 8) {
        HStack(spacing: 4) {
          ForEach(0..<3) { i in
            let phase = (t - Double(i) * 0.15).truncatingRemainder(dividingBy: 1.2) / 1.2
            let lift = max(0, sin(phase * 2 * .pi))
            Circle()
              .fill(Color.claude)
              .frame(width: 5.5, height: 5.5)
              .opacity(0.35 + 0.65 * lift)
              .scaleEffect(0.8 + 0.2 * lift)
          }
        }
        .frame(width: 26, alignment: .leading)
        Text(verbatim: "\(Self.duration(secs)) · ") + Text(secs < 20 ? LocalizedStringKey("Thinking…") : LocalizedStringKey("Still thinking…"))
      }
      .font(.ui(13.5))
      .foregroundStyle(Color.text2)
    }
  }

  static func duration(_ s: Int) -> String {
    if s < 60 { return String(localized: "\(s)s") }
    let m = s / 60
    return m < 60 ? String(localized: "\(m)m \(s % 60)s") : String(localized: "\(m / 60)h \(m % 60)m")
  }
}

struct RemoteImage: View {
  let url: URL

  var body: some View {
    AsyncImage(url: url) { phase in
      switch phase {
      case .success(let image): image.resizable().scaledToFill()
      case .failure: Image(systemName: "photo").foregroundStyle(Color.text3)
      default: Rectangle().fill(Color.fillGray)
      }
    }
  }
}

func isImagePath(_ path: String) -> Bool {
  ["png", "jpg", "jpeg", "gif", "webp", "heic"].contains((path as NSString).pathExtension.lowercased())
}
