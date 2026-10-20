// The session list beside (iPad) or under (iPhone) the open conversation.
import SwiftUI

struct SessionsView: View {
  let api: APIClient

  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase

  @State private var sessions: [SessionSummary] = []
  @State private var loaded = false
  @State private var loadError: String?
  @State private var selection: String? = ProcessInfo.processInfo.environment["FARLINE_OPEN_SESSION"]
  @State private var search = ""
  @State private var showNew = false
  @State private var showSettings = false

  var body: some View {
    NavigationSplitView {
      list
        .navigationTitle(app.device?.name ?? "Farline")
        .toolbar { toolbar }
        .searchable(text: $search, prompt: Text("Search sessions"))
        .refreshable { await load() }
    } detail: {
      if let selection {
        ConversationView(id: selection, api: api) { newId in self.selection = newId }
          .id(selection)
      } else {
        ContentUnavailableView {
          Label("No session open", systemImage: "bubble.left.and.text.bubble.right")
        } description: {
          Text("Pick a session, or start a new one.")
        } actions: {
          Button("New session") { showNew = true }
            .buttonStyle(.glassProminent)
        }
      }
    }
    .sheet(isPresented: $showNew) {
      NewSessionView(api: api) { id in
        showNew = false
        selection = id
        Task { await load() }
      }
    }
    .sheet(isPresented: $showSettings) {
      SettingsView()
    }
    .task(id: scenePhase) {
      guard scenePhase == .active else { return }
      while !Task.isCancelled {
        await load()
        try? await Task.sleep(for: .seconds(8))
      }
    }
  }

  private var filtered: [SessionSummary] {
    let q = search.trimmingCharacters(in: .whitespaces)
    guard !q.isEmpty else { return sessions }
    return sessions.filter { $0.title.localizedCaseInsensitiveContains(q) || $0.cwd.localizedCaseInsensitiveContains(q) }
  }

  @ViewBuilder
  private var list: some View {
    if !loaded && sessions.isEmpty {
      ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
    } else if sessions.isEmpty {
      ContentUnavailableView {
        Label("No sessions yet", systemImage: "sparkles")
      } description: {
        Text(loadError ?? String(localized: "Start one and it shows up here."))
      }
    } else {
      List(selection: $selection) {
        ForEach(filtered) { s in
          NavigationLink(value: s.id) {
            SessionRow(session: s)
          }
          .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
              Task { await hide(s) }
            } label: {
              Label("Hide", systemImage: "eye.slash")
            }
          }
          .contextMenu {
            Button(role: .destructive) {
              Task { await hide(s) }
            } label: {
              Label("Hide", systemImage: "eye.slash")
            }
          }
        }
      }
      .listStyle(.sidebar)
      .animation(.smooth, value: sessions)
    }
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .topBarTrailing) {
      Button {
        showSettings = true
      } label: {
        Label("Settings", systemImage: "gearshape")
      }
    }
    DefaultToolbarItem(kind: .search, placement: .bottomBar)
    ToolbarSpacer(.flexible, placement: .bottomBar)
    ToolbarItem(placement: .bottomBar) {
      Button {
        showNew = true
      } label: {
        Label("New session", systemImage: "square.and.pencil")
      }
    }
  }

  private func load() async {
    do {
      sessions = try await api.sessions().sessions
      loadError = nil
    } catch {
      app.handle(error)
      loadError = error.localizedDescription
    }
    loaded = true
  }

  private func hide(_ s: SessionSummary) async {
    withAnimation { sessions.removeAll { $0.id == s.id } }
    if selection == s.id { selection = nil }
    _ = try? await api.update(s.id, .init(hidden: true))
  }
}

struct SessionRow: View {
  let session: SessionSummary

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 10) {
      StatusDot(status: session.status)
      VStack(alignment: .leading, spacing: 3) {
        Text(session.title.isEmpty ? String(localized: "New session") : session.title)
          .font(.body)
          .lineLimit(1)
        HStack(spacing: 6) {
          Text(folderName(session.cwd))
          if let label = session.providerLabel {
            Text(label)
              .padding(.horizontal, 6)
              .padding(.vertical, 1)
              .background(.fill.tertiary, in: .capsule)
          }
          if let n = session.tasks, n > 0 {
            Label("\(n)", systemImage: "gearshape.2")
              .labelStyle(.titleAndIcon)
          }
          Spacer(minLength: 4)
          Text(session.updated, format: .relative(presentation: .named, unitsStyle: .abbreviated))
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .lineLimit(1)
      }
    }
    .padding(.vertical, 3)
  }
}

struct StatusDot: View {
  let status: SessionStatus

  var body: some View {
    Group {
      switch status {
      case .running:
        Image(systemName: "circle.dotted")
          .symbolEffect(.rotate, options: .repeat(.continuous))
          .foregroundStyle(.tint)
      case .requiresAction:
        Image(systemName: "exclamationmark.circle.fill")
          .foregroundStyle(.orange)
          .symbolEffect(.pulse)
      case .busyElsewhere:
        Image(systemName: "circle.dashed")
          .foregroundStyle(.secondary)
      case .idle:
        Image(systemName: "circle.fill")
          .foregroundStyle(.clear)
      }
    }
    .font(.caption)
    .frame(width: 14)
  }
}

func folderName(_ path: String) -> String {
  let name = (path as NSString).lastPathComponent
  return name.isEmpty ? path : name
}
