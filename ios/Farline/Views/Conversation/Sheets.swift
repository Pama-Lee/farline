// Sheets opened from the conversation.
import SwiftUI

// A run of steps as a timeline; each opens to what it was given and returned.
struct StepsSheet: View {
  let steps: [Step]
  let live: Bool
  let api: APIClient

  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Group {
        if steps.count == 1, let only = steps.first {
          StepDetail(step: only, api: api)
        } else {
          ScrollView {
            VStack(alignment: .leading, spacing: 0) {
              ForEach(Array(steps.enumerated()), id: \.element.id) { i, step in
                NavigationLink {
                  StepDetail(step: step, api: api)
                } label: {
                  TimelineRow(step: step, live: live, last: i == steps.count - 1)
                }
                .buttonStyle(PressStyle())
              }
            }
            .padding(.horizontal, 20)
            .padding(.top, 14)
            .padding(.bottom, 20)
          }
          .background(Color.bg)
          .navigationTitle(StepText.summary(steps))
          .navigationBarTitleDisplayMode(.inline)
        }
      }
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(role: .close) { dismiss() }
        }
      }
    }
    .presentationDetents([.fraction(0.51), .large])
    .farlineSheet()
  }
}

private struct TimelineRow: View {
  let step: Step
  let live: Bool
  let last: Bool

  var body: some View {
    let l = StepText.label(step)
    HStack(alignment: .top, spacing: 14) {
      Group {
        if running {
          Ring(size: 17, width: 2)
        } else {
          Image(systemName: step.tool.map { $0.name.hasPrefix("mcp__") } == true ? "powerplug" : step.category.symbol)
            .font(.ui(17, .light))
        }
      }
      .foregroundStyle(Color.text2)
      .frame(width: 28, height: 28)
      VStack(alignment: .leading, spacing: 0) {
        Text(verbatim: l.title)
          .font(.ui(15.5))
          .foregroundStyle(step.tool?.failed == true ? Color.fRed : Color.text1)
        if !l.detail.isEmpty {
          Text(verbatim: l.detail)
            .font(.ui(14.5))
            .foregroundStyle(Color(light: 0x8A8985, dark: 0x8A8985))
            .lineLimit(1)
        }
      }
      .padding(.top, 3)
      Spacer(minLength: 0)
    }
    .padding(.bottom, last ? 0 : 30)
    .background(alignment: .topLeading) {
      if !last {
        Rectangle()
          .fill(Color.line)
          .frame(width: 1.5)
          .padding(.top, 33)
          .padding(.bottom, 9)
          .padding(.leading, 13.25)
      }
    }
    .contentShape(.rect)
  }

  private var running: Bool {
    guard live else { return false }
    switch step {
    case .tool(let t): return t.running
    case .thinking(let t): return t.streaming == true
    }
  }
}

// What a tool call was given and what it returned, in labeled boxes.
struct StepDetail: View {
  let step: Step
  let api: APIClient

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 0) {
        switch step {
        case .thinking(let t):
          Text(t.text)
            .font(.ui(14.5))
            .lineSpacing(5)
            .foregroundStyle(Color.text2)
            .textSelection(.enabled)
            .padding(.top, 4)
        case .tool(let tool):
          ForEach(Array(fields(tool).enumerated()), id: \.offset) { _, f in
            FieldLabel(f.label)
            FieldBox(text: f.text, plain: f.plain, diff: f.diff)
          }
          if let images = tool.images, !images.isEmpty {
            FieldLabel("Images")
            ForEach(images, id: \.url) { image in
              RemoteImage(url: api.url(image.url))
                .scaledToFit()
                .clipShape(.rect(cornerRadius: 14))
            }
          }
          if let result = tool.result, !result.isEmpty {
            FieldLabel(tool.failed ? "Error" : "Output")
            FieldBox(text: result + (tool.truncated == true ? String(localized: "\n… (truncated)") : ""), error: tool.failed)
          } else if tool.running {
            ProgressView().frame(maxWidth: .infinity).padding(.top, 20)
          } else if !tool.failed {
            FieldLabel("Output")
            FieldBox(text: String(localized: "(no output)"))
          }
        }
      }
      .padding(.horizontal, 16)
      .padding(.bottom, 20)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .background(Color.bg)
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
  }

  private var title: String {
    switch step {
    case .thinking: String(localized: "Thinking")
    case .tool(let t): StepText.toolName(t.name)
    }
  }

  private struct Field {
    let label: LocalizedStringKey
    let text: String
    var plain = false
    var diff: (old: String, new: String)?
  }

  private func fields(_ t: ToolItem) -> [Field] {
    func s(_ key: String) -> String? { t.arg(key).flatMap { $0.isEmpty ? nil : $0 } }
    switch t.name {
    case "Bash":
      return [s("description").map { Field(label: "Description", text: $0, plain: true) }, Field(label: "Command", text: "$ " + (s("command") ?? ""))].compactMap { $0 }
    case "Read":
      return [Field(label: "File", text: s("file_path") ?? "")]
    case "Write":
      return [Field(label: "File", text: s("file_path") ?? ""), Field(label: "Content", text: s("content") ?? "")]
    case "Edit":
      return [Field(label: "File", text: s("file_path") ?? ""), Field(label: "Change", text: "", diff: (s("old_string") ?? "", s("new_string") ?? ""))]
    case "Grep", "Glob":
      return [Field(label: "Pattern", text: s("pattern") ?? ""), s("path").map { Field(label: "Path", text: $0) }].compactMap { $0 }
    case "WebSearch":
      return [Field(label: "Query", text: s("query") ?? "", plain: true)]
    case "WebFetch":
      return [Field(label: "URL", text: s("url") ?? ""), s("prompt").map { Field(label: "Prompt", text: $0, plain: true) }].compactMap { $0 }
    case "Agent", "Task":
      return [s("description").map { Field(label: "Description", text: $0, plain: true) }, s("prompt").map { Field(label: "Prompt", text: $0, plain: true) }].compactMap { $0 }
    default:
      return [Field(label: "Input", text: JSONValue.object(t.input).pretty)]
    }
  }
}

private struct FieldBox: View {
  let text: String
  var plain = false
  var diff: (old: String, new: String)?
  var error = false

  var body: some View {
    Group {
      if let diff {
        VStack(alignment: .leading, spacing: 0) {
          ForEach(Array(diff.old.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
            Text(verbatim: "- " + line)
              .foregroundStyle(Color.fRed)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(Color.fRed.opacity(0.08))
          }
          ForEach(Array(diff.new.components(separatedBy: "\n").enumerated()), id: \.offset) { _, line in
            Text(verbatim: "+ " + line)
              .foregroundStyle(Color.fGreen)
              .frame(maxWidth: .infinity, alignment: .leading)
              .background(Color.fGreen.opacity(0.1))
          }
        }
      } else {
        Text(verbatim: text)
          .foregroundStyle(error ? Color.fRed : Color.text1)
          .frame(maxWidth: .infinity, alignment: .leading)
      }
    }
    .font(plain ? .ui(13.5) : .mono(12.5))
    .lineSpacing(3)
    .textSelection(.enabled)
    .padding(.horizontal, 12)
    .padding(.vertical, 9)
    .background(Color.surface, in: .rect(cornerRadius: 12))
    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.line))
  }
}

// Rewrite a reply; the next turn reads the edited text.
struct EditReplyView: View {
  let item: TextItem
  let model: SessionModel

  @Environment(\.dismiss) private var dismiss
  @State private var text = ""
  @State private var saving = false
  @State private var error: String?

  var body: some View {
    NavigationStack {
      TextEditor(text: $text)
        .font(.ui(16.5))
        .foregroundStyle(Color.text1)
        .padding(.horizontal, 14)
        .scrollContentBackground(.hidden)
        .background(Color.bg)
        .safeAreaInset(edge: .bottom) {
          if let error {
            Text(error).font(.ui(14)).foregroundStyle(Color.fRed).padding()
          }
        }
        .navigationTitle("Edit reply")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .topBarLeading) {
            Button(role: .close) { dismiss() }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(role: .confirm) {
              save()
            }
            .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
    }
    .farlineSheet()
    .onAppear { text = item.text }
  }

  private func save() {
    saving = true
    Task {
      defer { saving = false }
      do {
        try await model.editText(itemId: item.id, text: text)
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

// Go back to before a message: the conversation, the code, or both.
struct RewindView: View {
  let item: UserItem
  let model: SessionModel
  let onOpenSession: (String) -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var preview: RewindPreview?
  @State private var busy = false
  @State private var error: String?

  private var changedFiles: Int { preview?.canRewind == true ? preview?.filesChanged?.count ?? 0 : 0 }

  var body: some View {
    NavigationStack {
      List {
        Section {
          Text(item.text)
            .lineLimit(4)
            .foregroundStyle(Color.text2)
        } footer: {
          Text("Everything after this message is undone.")
        }
        .listRowBackground(Color.surface)

        Section {
          option("Conversation and code", systemImage: "arrow.uturn.backward.circle", enabled: changedFiles > 0) {
            run(files: true, conversation: true)
          }
          option("Conversation only", systemImage: "bubble.left.and.bubble.right", enabled: true) {
            run(files: false, conversation: true)
          }
          option("Code only", systemImage: "chevron.left.forwardslash.chevron.right", enabled: changedFiles > 0) {
            run(files: true, conversation: false)
          }
        } footer: {
          if preview == nil {
            ProgressView()
          } else if changedFiles > 0, let p = preview {
            Text("\(changedFiles) files changed, +\(p.insertions ?? 0) −\(p.deletions ?? 0)")
          } else {
            Text("No code changes to undo.")
          }
        }
        .listRowBackground(Color.surface)

        if let error {
          Section { Text(error).foregroundStyle(Color.fRed) }
            .listRowBackground(Color.surface)
        }
      }
      .font(.ui(15.5))
      .foregroundStyle(Color.text1)
      .farlineList()
      .disabled(busy)
      .navigationTitle("Rewind")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(role: .close) { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
    .farlineSheet()
    .task {
      preview = (try? await model.api.rewindPreview(model.id, messageId: item.id)) ?? RewindPreview(canRewind: false, error: nil, filesChanged: nil, insertions: nil, deletions: nil)
    }
  }

  private func option(_ title: LocalizedStringKey, systemImage: String, enabled: Bool, action: @escaping () -> Void) -> some View {
    Button(action: action) {
      Label(title, systemImage: systemImage)
    }
    .disabled(!enabled)
  }

  private func run(files: Bool, conversation: Bool) {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        let result = try await model.api.rewind(model.id, messageId: item.id, files: files, conversation: conversation)
        if conversation {
          if let newId = result.sessionId {
            onOpenSession(newId)
          } else {
            model.draft = item.text
            model.connect()
          }
        }
        dismiss()
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
