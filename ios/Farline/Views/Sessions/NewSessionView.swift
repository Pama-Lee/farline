// Start a session: where, with which model, and the first message.
import SwiftUI

struct NewSessionView: View {
  let api: APIClient
  let onCreated: (String) -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss

  @State private var cwd = ""
  @State private var provider = "claude"
  @State private var model = ""
  @State private var mode: PermissionMode = .auto
  @State private var effort: EffortLevel = .xhigh
  @State private var text = ""
  @State private var busy = false
  @State private var error: String?
  @FocusState private var focused: Bool

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("What should the agent do?", text: $text, axis: .vertical)
            .lineLimit(4...12)
            .focused($focused)
        }

        Section {
          NavigationLink {
            FolderPicker(api: api, path: $cwd)
          } label: {
            LabeledContent {
              Text(cwd.isEmpty ? "~" : folderName(cwd))
            } label: {
              Label("Folder", systemImage: "folder")
            }
          }

          if app.catalog.providers.count > 1 {
            Picker(selection: $provider) {
              ForEach(app.catalog.providers) { p in
                Text(p.label).tag(p.id)
              }
            } label: {
              Label("Provider", systemImage: "server.rack")
            }
          }

          Picker(selection: $model) {
            ForEach(models) { m in
              Text(m.label).tag(m.value)
            }
          } label: {
            Label("Model", systemImage: "cpu")
          }

          if let efforts = currentModel?.efforts, !efforts.isEmpty {
            Picker(selection: $effort) {
              ForEach(efforts) { e in
                Text(e.title).tag(e)
              }
            } label: {
              Label("Effort", systemImage: "gauge.with.dots.needle.67percent")
            }
          }

          Picker(selection: $mode) {
            ForEach(PermissionMode.allCases) { m in
              Text(m.title).tag(m)
            }
          } label: {
            Label("Permissions", systemImage: "hand.raised")
          }
        }

        if let error {
          Section {
            Text(error).foregroundStyle(.red)
          }
        }
      }
      .navigationTitle("New session")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(role: .cancel) { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(role: .confirm, action: start) {
            if busy { ProgressView() } else { Label("Start", systemImage: "arrow.up") }
          }
          .disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || model.isEmpty)
        }
      }
      .onChange(of: provider) { _, p in
        model = app.catalog.models(for: p).first { $0.more != true }?.value ?? app.catalog.models(for: p).first?.value ?? ""
        if let preferred = app.catalog.providers.first(where: { $0.id == p })?.defaultPermissionMode { mode = preferred }
      }
    }
    .onAppear(perform: fillDefaults)
  }

  private var models: [ModelOption] {
    let all = app.catalog.models(for: provider)
    return all.filter { $0.more != true } + all.filter { $0.more == true }
  }

  private var currentModel: ModelOption? { models.first { $0.value == model } }

  private func fillDefaults() {
    guard cwd.isEmpty else { return }
    let prefs = app.device?.prefs
    cwd = prefs?.lastCwd ?? app.device?.defaultCwd ?? ""
    if let p = prefs?.provider, app.catalog.providers.contains(where: { $0.id == p }) { provider = p }
    else { provider = app.catalog.providers.first?.id ?? "claude" }
    let list = app.catalog.models(for: provider)
    model = list.first { $0.value == prefs?.model }?.value ?? list.first { $0.more != true }?.value ?? list.first?.value ?? ""
    mode = prefs?.permissionMode ?? app.catalog.providers.first { $0.id == provider }?.defaultPermissionMode ?? .auto
    if mode == .bypassPermissions { mode = .auto }
    effort = prefs?.effort ?? .xhigh
    focused = true
  }

  private func start() {
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        let id = try await api.createSession(.init(
          text: text,
          uploads: nil,
          cwd: cwd,
          provider: provider,
          model: model,
          permissionMode: mode,
          effort: currentModel?.efforts?.isEmpty == false ? effort : nil
        ))
        onCreated(id)
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

// Browse the server's folders.
struct FolderPicker: View {
  let api: APIClient
  @Binding var path: String

  @Environment(\.dismiss) private var dismiss
  @State private var listing: DirListing?
  @State private var error: String?
  @State private var current: String?

  var body: some View {
    List {
      if let listing {
        Section {
          if let parent = listing.parent {
            Button {
              current = parent
            } label: {
              Label("..", systemImage: "arrow.turn.left.up")
            }
          }
          ForEach(listing.dirs) { dir in
            Button {
              current = dir.path
            } label: {
              Label(dir.name, systemImage: "folder")
                .foregroundStyle(dir.hidden == true ? .secondary : .primary)
            }
          }
        } header: {
          Text(verbatim: listing.path)
            .textCase(nil)
            .lineLimit(2)
            .truncationMode(.head)
        }
      } else if let error {
        Text(error).foregroundStyle(.red)
      } else {
        ProgressView()
      }
    }
    .navigationTitle(listing.map { folderName($0.path) } ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .confirmationAction) {
        Button("Use") {
          if let p = listing?.path { path = p }
          dismiss()
        }
        .disabled(listing == nil)
      }
    }
    .task(id: current ?? path) {
      do {
        listing = try await api.dirs(current ?? (path.isEmpty ? nil : path))
        error = nil
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

extension PermissionMode {
  var title: LocalizedStringKey {
    switch self {
    case .default: "Ask before acting"
    case .auto: "Auto"
    case .acceptEdits: "Accept edits"
    case .plan: "Plan first"
    case .bypassPermissions: "Bypass permissions"
    }
  }

  var symbol: String {
    switch self {
    case .default: "hand.raised"
    case .auto: "sparkles"
    case .acceptEdits: "pencil.and.list.clipboard"
    case .plan: "map"
    case .bypassPermissions: "exclamationmark.shield"
    }
  }
}

extension EffortLevel {
  var title: LocalizedStringKey {
    switch self {
    case .low: "Low"
    case .medium: "Medium"
    case .high: "High"
    case .xhigh: "Extra high"
    case .max: "Max"
    }
  }
}
