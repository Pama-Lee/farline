// One session, laid out like the web's: the thread on the page background,
// a pending permission pinned above the composer card.
import SwiftUI
import UIKit

struct ConversationView: View {
  let onOpenSession: (String) -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase
  @State private var model: SessionModel
  @State private var scroll = ScrollPosition(edge: .bottom)
  @State private var atBottom = true
  // Follow the end of the thread until the user scrolls away from it. Only a
  // drag changes this, so the keyboard, the composer growing or rows measuring
  // themselves can't push the thread up on their own.
  @State private var stick = true
  @State private var dragging = false
  @State private var openSteps: SheetID? = ProcessInfo.processInfo.environment["FARLINE_SHEET"] == "steps" ? SheetID(id: "") : nil
  @State private var editing: TextItem?
  @State private var rewinding: UserItem?
  @State private var renaming = false
  @State private var newTitle = ""
  @State private var toast: String?

  struct SheetID: Identifiable {
    let id: String
  }

  init(id: String, api: APIClient, onOpenSession: @escaping (String) -> Void) {
    _model = State(initialValue: SessionModel(id: id, api: api))
    self.onOpenSession = onOpenSession
  }

  var body: some View {
    ScrollView {
      LazyVStack(alignment: .leading, spacing: 0) {
        if model.hasEarlier {
          Button {
            model.loadAll()
          } label: {
            Text("Load earlier messages")
              .font(.ui(14.5))
              .foregroundStyle(Color.text2)
          }
          .buttonStyle(PressStyle())
          .frame(maxWidth: .infinity)
          .padding(.top, 4)
          .padding(.bottom, 12)
        }
        ForEach(model.blocks) { block in
          blockView(block)
        }
        if model.running && !model.streamingText {
          ThinkingIndicator(since: model.runningSince)
            .padding(.top, 18)
            .padding(.bottom, 8)
        }
      }
      .padding(.horizontal, 18)
      .padding(.top, 8)
      .padding(.bottom, 16)
      .frame(maxWidth: 760)
      .frame(maxWidth: .infinity)
    }
    .background(Color.bg)
    .scrollPosition($scroll)
    // A short thread sits at the top like the web's; a long one opens at the end.
    .defaultScrollAnchor(.top, for: .alignment)
    .defaultScrollAnchor(.bottom, for: .initialOffset)
    .defaultScrollAnchor(.bottom, for: .sizeChanges)
    .scrollDismissesKeyboard(.interactively)
    .onScrollGeometryChange(for: Bool.self) { geo in
      geo.visibleRect.maxY >= geo.contentSize.height - 80
    } action: { _, bottom in
      atBottom = bottom
      if dragging { stick = bottom }
    }
    .onScrollPhaseChange { _, phase in
      dragging = phase == .interacting || phase == .decelerating
      if phase == .idle { stick = atBottom }
    }
    // The content or the space for it changed size: stay at the end if we were there.
    .onScrollGeometryChange(for: [CGFloat].self) { geo in
      [geo.contentSize.height, geo.containerSize.height, geo.contentInsets.bottom]
    } action: { _, _ in
      if stick && !dragging { scroll.scrollTo(edge: .bottom) }
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
          stick = true
          withAnimation(.smooth) { scroll.scrollTo(edge: .bottom) }
        } label: {
          Image(systemName: "arrow.down")
            .font(.ui(16, .medium))
            .foregroundStyle(Color.text1)
            .frame(width: 40, height: 40)
        }
        .glassEffect(.regular.interactive(), in: .circle)
        .padding(.bottom, 8)
        .transition(.scale.combined(with: .opacity))
      }
    }
    .animation(.smooth, value: atBottom)
    .safeAreaBar(edge: .bottom) {
      bottomBar
    }
    .overlay(alignment: .top) {
      if let toast {
        ToastView(text: toast)
          .task {
            try? await Task.sleep(for: .seconds(2.2))
            withAnimation { self.toast = nil }
          }
      }
    }
    .navigationTitle(model.state?.title ?? "")
    .navigationSubtitle(app.device?.name ?? "")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar { toolbar }
    .sheet(item: $openSteps) { sheet in
      StepsSheet(steps: steps(for: sheet.id), live: model.running, api: model.api)
    }
    .sheet(item: $editing) { item in
      EditReplyView(item: item, model: model)
    }
    .sheet(item: $rewinding) { item in
      RewindView(item: item, model: model, onOpenSession: onOpenSession)
    }
    .alert("Rename", isPresented: $renaming) {
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

  // The steps of a group, or of the first group when opened for a screenshot.
  private func steps(for id: String) -> [Step] {
    if let steps = model.steps(id) { return steps }
    for block in model.blocks {
      if case .steps(_, let steps) = block { return steps }
    }
    return []
  }

  @ViewBuilder
  private var bottomBar: some View {
    VStack(spacing: 10) {
      if let tool = model.pendingPermission {
        PermissionCard(tool: tool, model: model)
          .id(tool.id)
          .padding(.horizontal, 15)
          .transition(.move(edge: .bottom).combined(with: .opacity))
      }
      if model.busyElsewhere {
        HStack(spacing: 8) {
          Ring(size: 16, width: 2)
          Text("Running elsewhere")
        }
        .font(.ui(14))
        .foregroundStyle(Color.text2)
        .frame(maxWidth: .infinity, minHeight: 50)
        .background(Color.surface, in: .capsule)
        .shadow(color: .black.opacity(0.08), radius: 7, y: 3)
        .padding(.horizontal, 15)
      } else if let state = model.state {
        Composer(
          placeholder: "Reply",
          api: model.api,
          running: model.busy,
          modelLabel: app.catalog.current(provider: state.provider, model: state.model)?.label ?? state.model,
          effortLabel: effortLabel(state),
          mode: Binding(get: { state.permissionMode }, set: { m in perform { try await model.update(.init(permissionMode: m)) } }),
          draft: Binding(get: { model.draft }, set: { model.draft = $0 }),
          onSend: { text, uploads in
            stick = true
            scroll.scrollTo(edge: .bottom)
            try await model.send(text, uploads: uploads)
          },
          onStop: { await model.interrupt() }
        ) {
          ModelSheet(
            catalog: app.catalog,
            provider: state.provider,
            model: state.model,
            effort: state.effort,
            classifierModel: state.classifierModel,
            lockAgent: true,
            onModel: { m in
              perform {
                if m.provider == state.provider {
                  try await model.update(.init(model: m.value))
                } else {
                  try await model.update(.init(provider: m.provider, model: m.value))
                  withAnimation { toast = String(localized: "Switched to \(m.label)") }
                }
              }
            },
            onEffort: { e in perform { try await model.update(.init(effort: e)) } },
            onClassifier: { c in perform { try await model.update(.init(classifierModel: c)) } }
          )
        }
      }
    }
    .padding(.bottom, 6)
    .animation(.smooth, value: model.pendingPermission?.id)
  }

  private func effortLabel(_ state: SessionState) -> LocalizedStringKey? {
    guard let effort = state.effort, app.catalog.current(provider: state.provider, model: state.model)?.efforts?.isEmpty == false else { return nil }
    return effort.title
  }

  @ViewBuilder
  private func blockView(_ block: Block) -> some View {
    switch block {
    case .user(let item):
      UserMessage(item: item, api: model.api)
        .contextMenu {
          Button("Copy", systemImage: "doc.on.doc") { copy(item.text) }
          if !model.running {
            Button("Rewind to here", systemImage: "arrow.uturn.backward") { rewinding = item }
          }
          Menu {
            ReactionButtons { emoji in react(item.id, emoji) }
          } label: {
            Label("React", systemImage: "face.smiling")
          }
        }
        .padding(.vertical, 12)
    case .text(let item, let last):
      VStack(alignment: .leading, spacing: 8) {
        MarkdownView(text: item.text)
        if item.edited == true {
          Text("Edited").font(.ui(12.5)).foregroundStyle(Color.text3)
        }
        ReactionPills(reactions: item.reactions)
        if last && item.streaming != true && !model.running {
          MsgActions(item: item, canEdit: true) {
            copy(item.text)
          } onReact: { emoji in
            react(item.id, emoji)
          } onEdit: {
            editing = item
          }
        }
      }
      .padding(.vertical, 7)
    case .steps(let id, let steps):
      StepsRow(steps: steps, live: model.running) { openSteps = SheetID(id: id) }
        .padding(.vertical, 6)
    case .ask(let item):
      AskCard(item: item, model: model)
        .padding(.vertical, 7)
    case .notice(let item):
      NoticeView(item: item)
        .padding(.vertical, 7)
    case .task(let item):
      TaskRow(item: item)
        .padding(.vertical, 6)
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    if model.busy {
      ToolbarItem(placement: .topBarTrailing) {
        Ring()
          .frame(width: 36, height: 36)
          .accessibilityLabel(Text("Working"))
      }
    }
    if model.state != nil {
      ToolbarSpacer(.fixed, placement: .topBarTrailing)
      ToolbarItem(placement: .topBarTrailing) {
        Menu {
          Button("Rename", systemImage: "pencil") {
            newTitle = model.state?.title ?? ""
            renaming = true
          }
          Button("Copy session ID", systemImage: "doc.on.doc") { copy(model.id) }
          if let url = URL(string: "/s/\(model.id)", relativeTo: model.api.base) {
            ShareLink(item: url.absoluteURL) {
              Label("Share link", systemImage: "square.and.arrow.up")
            }
          }
          Button("Hide from list", systemImage: "eye.slash", role: .destructive) {
            perform {
              try await model.update(.init(hidden: true))
              toast = String(localized: "Hidden from the list")
            }
          }
        } label: {
          Label("More", systemImage: "ellipsis")
        }
      }
    }
  }

  private func copy(_ text: String) {
    UIPasteboard.general.string = text
    withAnimation { toast = String(localized: "Copied") }
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

// The web's toast: a black capsule near the top.
struct ToastView: View {
  let text: String

  var body: some View {
    Text(text)
      .font(.ui(15))
      .foregroundStyle(Color.onInk)
      .padding(.horizontal, 18)
      .padding(.vertical, 10)
      .background(Color.ink, in: .capsule)
      .padding(.top, 8)
      .transition(.move(edge: .top).combined(with: .opacity))
  }
}
