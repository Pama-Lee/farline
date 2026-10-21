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
  @State private var classifier = ""
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
          mode: $mode,
          draft: $draft,
          onSend: create,
          onStop: {}
        ) {
          ModelSheet(
            catalog: app.catalog,
            provider: provider,
            model: model,
            effort: current?.efforts?.isEmpty == false ? effort : nil,
            classifierModel: classifierModel,
            onModel: { m in
              if m.provider != provider { mode = defaultMode(for: m.provider, previous: mode) }
              provider = m.provider
              model = m.value
            },
            onEffort: { effort = $0 },
            onClassifier: { classifier = $0 }
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
    app.catalog.current(provider: provider, model: model)
  }

  // A provider may bring its own default (DeepSeek opens every permission);
  // others never inherit that from a previous choice.
  private func defaultMode(for provider: String, previous: PermissionMode?) -> PermissionMode {
    if let preferred = app.catalog.providers.first(where: { $0.id == provider })?.defaultPermissionMode { return preferred }
    if let previous, previous != .bypassPermissions { return previous }
    return .auto
  }

  // The auto-mode check the provider offers, keeping the last one chosen.
  private var classifierModel: String? {
    guard let list = app.catalog.providers.first(where: { $0.id == provider })?.classifierModels, !list.isEmpty else { return nil }
    return list.contains(classifier) ? classifier : list[0]
  }

  private func defaultModel(for provider: String) -> String {
    let list = app.catalog.models(for: provider)
    return list.first { $0.more != true }?.value ?? list.first?.value ?? ""
  }

  // The last choices made on this device, as the web keeps them.
  private func fillDefaults() {
    guard provider.isEmpty else { return }
    let prefs = app.device?.prefs
    let pickable = app.catalog.pickable
    if let p = prefs?.provider, pickable.contains(where: { $0.id == p }) { provider = p }
    else { provider = pickable.first?.id ?? "claude" }
    let list = app.catalog.models(for: provider)
    model = list.first { $0.isCurrent(provider: provider, model: prefs?.model ?? "") }?.value ?? defaultModel(for: provider)
    mode = defaultMode(for: provider, previous: prefs?.permissionMode)
    effort = prefs?.effort ?? .xhigh
    classifier = prefs?.classifierModel ?? ""
  }

  private func create(_ text: String, _ uploads: [String]) async throws {
    let id = try await api.createSession(.init(
      text: text,
      uploads: uploads.isEmpty ? nil : uploads,
      cwd: cwd,
      provider: provider,
      model: model,
      permissionMode: mode,
      effort: current?.efforts?.isEmpty == false ? effort : nil,
      classifierModel: classifierModel
    ))
    onCreated(id)
  }
}
