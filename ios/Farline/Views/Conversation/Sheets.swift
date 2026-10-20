// Sheets opened from the conversation.
import SwiftUI

// What a tool call was given and what it returned.
struct StepDetailView: View {
  let step: Step
  let api: APIClient

  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          switch step {
          case .thinking(let t):
            Text(t.text)
              .textSelection(.enabled)
              .foregroundStyle(.secondary)
          case .tool(let tool):
            section("Input") {
              CodeBlockView(language: inputLanguage(tool), code: inputText(tool))
            }
            if let images = tool.images, !images.isEmpty {
              section("Images") {
                ForEach(images, id: \.url) { image in
                  RemoteImage(url: api.url(image.url))
                    .scaledToFit()
                    .clipShape(.rect(cornerRadius: 14))
                }
              }
            }
            if let result = tool.result, !result.isEmpty {
              section(tool.failed ? "Error" : "Result") {
                CodeBlockView(language: "", code: result + (tool.truncated == true ? "\n…" : ""))
              }
            } else if tool.running {
              ProgressView().frame(maxWidth: .infinity)
            }
          }
        }
        .padding()
      }
      .navigationTitle(title)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(role: .close) { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
    .presentationDragIndicator(.visible)
  }

  private var title: String {
    switch step {
    case .thinking: String(localized: "Thinking")
    case .tool(let t): StepText.toolName(t.name)
    }
  }

  private func section<Content: View>(_ title: LocalizedStringKey, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title)
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
        .textCase(.uppercase)
      content()
    }
  }

  private func inputLanguage(_ tool: ToolItem) -> String {
    tool.name == "Bash" ? "sh" : "json"
  }

  private func inputText(_ tool: ToolItem) -> String {
    if tool.name == "Bash", let cmd = tool.arg("command") { return cmd }
    return JSONValue.object(tool.input).pretty
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
        .font(.body)
        .padding(.horizontal, 12)
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom) {
          if let error {
            Text(error).font(.footnote).foregroundStyle(.red).padding()
          }
        }
        .navigationTitle("Edit reply")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button(role: .cancel) { dismiss() }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button(role: .confirm) {
              save()
            }
            .disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
    }
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
            .foregroundStyle(.secondary)
        } footer: {
          Text("Everything after this message is undone.")
        }

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
            Text("^[\(changedFiles) file](inflect: true) changed, +\(p.insertions ?? 0) −\(p.deletions ?? 0)")
          } else {
            Text("No code changes to undo.")
          }
        }

        if let error {
          Section { Text(error).foregroundStyle(.red) }
        }
      }
      .disabled(busy)
      .navigationTitle("Rewind")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(role: .cancel) { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
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
