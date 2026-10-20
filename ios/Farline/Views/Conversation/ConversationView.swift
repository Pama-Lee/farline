// One session's conversation with the composer floating over it.
import SwiftUI
import UIKit

struct ConversationView: View {
  let onOpenSession: (String) -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @State private var model: SessionModel
  @State private var scroll = ScrollPosition(edge: .bottom)
  @State private var atBottom = true
  @State private var detail: Step?
  @State private var editing: TextItem?
  @State private var rewinding: UserItem?
  @State private var renaming = false
  @State private var newTitle = ""
  @State private var toast: String?

  init(id: String, api: APIClient, onOpenSession: @escaping (String) -> Void) {
    _model = State(initialValue: SessionModel(id: id, api: api))
    self.onOpenSession = onOpenSession
  }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 18) {
        if model.hasEarlier {
          Button("Show earlier messages") { model.loadAll() }
            .buttonStyle(.glass)
            .frame(maxWidth: .infinity)
        }
        ForEach(model.blocks) { block in
          blockView(block)
            .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
        if model.running {
          WorkingIndicator(since: model.runningSince)
        }
      }
      .padding(.horizontal, 18)
      .padding(.top, 12)
      .padding(.bottom, 8)
      .frame(maxWidth: 760)
      .frame(maxWidth: .infinity)
      .animation(.smooth(duration: 0.25), value: model.blocks.count)
    }
    .scrollPosition($scroll)
    .defaultScrollAnchor(.bottom)
    .defaultScrollAnchor(.bottom, for: .sizeChanges)
    .scrollDismissesKeyboard(.interactively)
    .onScrollGeometryChange(for: Bool.self) { geo in
      geo.contentOffset.y + geo.containerSize.height >= geo.contentSize.height - 80
    } action: { _, bottom in
      atBottom = bottom
    }
    .overlay {
      if model.state == nil {
        if let error = model.error {
          ContentUnavailableView("Couldn't open this session", systemImage: "exclamationmark.triangle", description: Text(error))
        } else {
          ProgressView()
        }
      }
    }
    .overlay(alignment: .bottom) {
      if !atBottom {
        Button {
          withAnimation(.smooth) { scroll.scrollTo(edge: .bottom) }
        } label: {
          Image(systemName: "arrow.down")
            .font(.body.weight(.semibold))
            .frame(width: 40, height: 40)
        }
        .buttonStyle(.glass)
        .buttonBorderShape(.circle)
        .padding(.bottom, 8)
        .transition(.scale.combined(with: .opacity))
      }
    }
    .animation(.smooth, value: atBottom)
    .safeAreaBar(edge: .bottom) {
      Composer(model: model)
    }
    .overlay(alignment: .top) {
      if let toast {
        Text(toast)
          .font(.callout)
          .padding(.horizontal, 16)
          .padding(.vertical, 10)
          .glassEffect(.regular, in: .capsule)
          .padding(.top, 8)
          .transition(.move(edge: .top).combined(with: .opacity))
          .task {
            try? await Task.sleep(for: .seconds(2.5))
            withAnimation { self.toast = nil }
          }
      }
    }
    .navigationTitle(model.state?.title ?? "")
    .navigationSubtitle(model.state.map { folderName($0.cwd) } ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { toolbar }
    .sheet(item: $detail) { step in
      StepDetailView(step: step, api: model.api)
    }
    .sheet(item: $editing) { item in
      EditReplyView(item: item, model: model)
    }
    .sheet(item: $rewinding) { item in
      RewindView(item: item, model: model, onOpenSession: onOpenSession)
    }
    .alert("Rename session", isPresented: $renaming) {
      TextField("Title", text: $newTitle)
      Button("Cancel", role: .cancel) {}
      Button("Save") {
        let title = newTitle
        perform { try await model.update(.init(title: title)) }
      }
    }
    .sensoryFeedback(.success, trigger: model.finishedTurns)
    .sensoryFeedback(.warning, trigger: model.state?.status == .requiresAction) { _, new in new }
    .task { model.connect() }
    .onDisappear { model.disconnect() }
    .onChange(of: scenePhase) { _, phase in
      if phase == .active { model.connect() }
    }
  }

  @ViewBuilder
  private func blockView(_ block: Block) -> some View {
    switch block {
    case .user(let item):
      UserBubble(item: item, api: model.api)
        .contextMenu {
          Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = item.text }
          if !model.running {
            Button("Rewind to here", systemImage: "arrow.uturn.backward") { rewinding = item }
          }
          ReactionMenu { emoji in react(item.id, emoji) }
        }
    case .text(let item, let last):
      ReplyView(item: item)
        .contextMenu {
          Button("Copy", systemImage: "doc.on.doc") { UIPasteboard.general.string = item.text }
          if last && !model.running && item.streaming != true {
            Button("Edit reply", systemImage: "pencil") { editing = item }
          }
          ReactionMenu { emoji in react(item.id, emoji) }
        }
    case .steps(_, let steps):
      StepsView(steps: steps, live: model.running, model: model) { detail = $0 }
    case .ask(let item):
      AskCard(item: item, model: model)
    case .notice(let item):
      NoticeView(item: item)
    case .task(let item):
      TaskRow(item: item)
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    if let state = model.state {
      ToolbarItem(placement: .topBarTrailing) {
        ModelMenu(state: state, catalog: app.catalog) { change in
          perform { try await model.update(change) }
        }
      }
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Picker(selection: Binding(
            get: { state.permissionMode },
            set: { mode in perform { try await model.update(.init(permissionMode: mode)) } }
          )) {
            ForEach(PermissionMode.allCases) { m in
              Label(m.title, systemImage: m.symbol).tag(m)
            }
          } label: {
            Label("Permissions", systemImage: state.permissionMode.symbol)
          }
          .pickerStyle(.menu)
          Divider()
          Button("Rename", systemImage: "pencil") {
            newTitle = state.title
            renaming = true
          }
          if let url = URL(string: "/s/\(model.id)", relativeTo: model.api.base) {
            ShareLink(item: url.absoluteURL) {
              Label("Share link", systemImage: "square.and.arrow.up")
            }
          }
        } label: {
          Label("More", systemImage: "ellipsis")
        }
      }
    }
  }

  private func react(_ itemId: String, _ emoji: String) {
    perform { try await model.react(itemId: itemId, emoji: emoji) }
  }

  private func perform(_ work: @escaping @MainActor () async throws -> Void) {
    Task {
      do {
        try await work()
      } catch {
        app.handle(error)
        withAnimation { toast = error.localizedDescription }
      }
    }
  }
}

// Model and effort, from the current provider only: a started session keeps
// its agent.
struct ModelMenu: View {
  let state: SessionState
  let catalog: Catalog
  let onChange: (APIClient.SessionChange) -> Void

  var body: some View {
    let models = catalog.models(for: state.provider)
    let current = models.first { $0.value == state.model }
    Menu {
      Section(catalog.label(for: state.provider)) {
        Picker("Model", selection: Binding(get: { state.model }, set: { onChange(.init(model: $0)) })) {
          ForEach(models.filter { $0.more != true }) { m in
            Text(m.label).tag(m.value)
          }
        }
        .pickerStyle(.inline)
        let more = models.filter { $0.more == true }
        if !more.isEmpty {
          Menu("More models") {
            Picker("More models", selection: Binding(get: { state.model }, set: { onChange(.init(model: $0)) })) {
              ForEach(more) { m in
                Text(m.label).tag(m.value)
              }
            }
            .pickerStyle(.inline)
          }
        }
      }
      if let efforts = current?.efforts, !efforts.isEmpty {
        Section("Effort") {
          Picker("Effort", selection: Binding(get: { state.effort ?? .xhigh }, set: { onChange(.init(effort: $0)) })) {
            ForEach(efforts) { e in
              Text(e.title).tag(e)
            }
          }
          .pickerStyle(.inline)
        }
      }
    } label: {
      Text(current?.label ?? state.model)
        .font(.subheadline.weight(.medium))
        .lineLimit(1)
    }
  }
}

struct ReactionMenu: View {
  let onPick: (String) -> Void
  private static let emoji = ["👍", "❤️", "😂", "🎉", "👀", "🙏"]

  var body: some View {
    Menu {
      ForEach(Self.emoji, id: \.self) { e in
        Button(e) { onPick(e) }
      }
    } label: {
      Label("React", systemImage: "face.smiling")
    }
  }
}
