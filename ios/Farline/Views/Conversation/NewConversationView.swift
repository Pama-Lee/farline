// A session that doesn't exist yet: an empty page and the composer. The
// first message creates it, like the web's /new.
import SwiftUI

struct NewConversationView: View {
  let api: APIClient
  let cwd: String
  let onCreated: (String) -> Void

  @Environment(AppModel.self) private var app
  @State private var provider = ""
  @State private var model = ""
  @State private var effort: EffortLevel = .xhigh
  @State private var mode: PermissionMode = .auto
  @State private var draft: String?

  var body: some View {
    Color.bg
      .ignoresSafeArea()
      .safeAreaBar(edge: .bottom) {
        Composer(
          placeholder: "What should we do?",
          api: api,
          running: false,
          modelLabel: current?.label ?? model,
          effortLabel: current?.efforts?.isEmpty == false ? effort.title : nil,
          draft: $draft,
          onSend: create,
          onStop: {}
        ) {
          ModelMenuContent(
            catalog: app.catalog,
            canChangeProvider: true,
            provider: Binding(get: { provider }, set: { p in
              provider = p
              model = defaultModel(for: p)
              if let preferred = app.catalog.providers.first(where: { $0.id == p })?.defaultPermissionMode { mode = preferred }
            }),
            model: $model,
            effort: $effort,
            mode: $mode
          )
        }
        .padding(.bottom, 6)
      }
      .navigationTitle("New conversation")
      .navigationSubtitle(app.device?.name ?? "")
      .navigationBarTitleDisplayMode(.inline)
      .onAppear(perform: fillDefaults)
  }

  private var current: ModelOption? {
    app.catalog.models(for: provider).first { $0.value == model }
  }

  private func defaultModel(for provider: String) -> String {
    let list = app.catalog.models(for: provider)
    return list.first { $0.more != true }?.value ?? list.first?.value ?? ""
  }

  // The last choices made on this device, as the web keeps them.
  private func fillDefaults() {
    guard provider.isEmpty else { return }
    let prefs = app.device?.prefs
    if let p = prefs?.provider, app.catalog.providers.contains(where: { $0.id == p }) { provider = p }
    else { provider = app.catalog.providers.first?.id ?? "claude" }
    let list = app.catalog.models(for: provider)
    model = list.first { $0.value == prefs?.model }?.value ?? defaultModel(for: provider)
    mode = prefs?.permissionMode ?? app.catalog.providers.first { $0.id == provider }?.defaultPermissionMode ?? .auto
    if mode == .bypassPermissions { mode = .auto }
    effort = prefs?.effort ?? .xhigh
  }

  private func create(_ text: String, _ uploads: [String]) async throws {
    let id = try await api.createSession(.init(
      text: text,
      uploads: uploads.isEmpty ? nil : uploads,
      cwd: cwd,
      provider: provider,
      model: model,
      permissionMode: mode,
      effort: current?.efforts?.isEmpty == false ? effort : nil
    ))
    onCreated(id)
  }
}
