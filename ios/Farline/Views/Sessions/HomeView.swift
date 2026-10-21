// The home screen, laid out like the web app's: the device, then sessions,
// with search and "New session" at the bottom.
import SwiftUI
import UIKit

enum Route: Hashable {
  case session(String)
  case new(cwd: String)
}

struct HomeView: View {
  let api: APIClient

  @Environment(AppModel.self) private var app
  @Environment(\.scenePhase) private var scenePhase

  @State private var sessions: [SessionSummary] = []
  @State private var loaded = false
  @State private var loadError: String?
  @State private var path: [Route] = ProcessInfo.processInfo.environment["FARLINE_OPEN_SESSION"].map { [.session($0)] } ?? []
  @State private var search = ""
  @State private var sheet: HomeSheet? = ProcessInfo.processInfo.environment["FARLINE_SHEET"].flatMap(HomeSheet.init(rawValue:))
  @AppStorage("farline.filter") private var filter = ""

  enum HomeSheet: String, Identifiable {
    case device, settings, history
    var id: String { rawValue }
  }

  var body: some View {
    NavigationStack(path: $path) {
      list
        .navigationTitle("Farline")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .searchable(text: $search, prompt: Text("Search sessions"))
        .searchToolbarBehavior(.minimize)
        .refreshable { await load() }
        .navigationDestination(for: Route.self) { route in
          switch route {
          case .session(let id):
            ConversationView(id: id, api: api) { newId in open(newId) }
              .id(id)
          case .new(let cwd):
            NewConversationView(api: api, cwd: cwd) { id in
              Task { await load() }
              if !path.isEmpty { path.removeLast() }
              path.append(.session(id))
            }
          }
        }
    }
    .tint(Color.text1)
    .sheet(item: $sheet) { which in
      switch which {
      case .device:
        DeviceSheet(api: api, start: filter.isEmpty ? nil : filter, sessions: sessions) { cwd in
          sheet = nil
          path.append(.new(cwd: cwd))
        } onOpen: { id in
          sheet = nil
          open(id)
        }
      case .settings:
        SettingsView()
      case .history:
        HistorySheet(sessions: sessions) { id in
          sheet = nil
          open(id)
        }
      }
    }
    .task(id: scenePhase) {
      guard scenePhase == .active else { return }
      while !Task.isCancelled {
        await load()
        try? await Task.sleep(for: .seconds(8))
      }
    }
  }

  private var shown: [SessionSummary] {
    let q = search.trimmingCharacters(in: .whitespaces)
    return sessions.filter { s in
      (filter.isEmpty || s.cwd == filter) && (q.isEmpty || s.title.localizedCaseInsensitiveContains(q))
    }
  }

  private var list: some View {
    List {
      if search.isEmpty {
        HStack {
          Text("Devices")
          Spacer()
          Button {
            sheet = .device
          } label: {
            Image(systemName: "plus")
              .font(.ui(20, .light))
              .foregroundStyle(Color.text1)
              .frame(width: 32, height: 32)
          }
          .buttonStyle(PressStyle())
          .accessibilityLabel(Text("New session"))
        }
        .sectionLabel()
        .padding(.top, 14)
        .homeRow()

        Button {
          sheet = .device
        } label: {
          DeviceChip(name: app.device?.name ?? "…")
        }
        .buttonStyle(PressStyle())
        .padding(.leading, 24)
        .padding(.top, 10)
        .homeRow()
      }

      HStack {
        Text(filter.isEmpty ? String(localized: "Sessions") : folderName(filter))
        Spacer()
        if !filter.isEmpty {
          Button {
            filter = ""
          } label: {
            Image(systemName: "xmark").font(.ui(15))
          }
          .buttonStyle(PressStyle())
          .accessibilityLabel(Text("Clear filter"))
        }
      }
      .sectionLabel()
      .padding(.top, search.isEmpty ? 28 : 4)
      .padding(.bottom, 6)
      .homeRow()

      if !loaded && sessions.isEmpty {
        ProgressView()
          .frame(maxWidth: .infinity)
          .padding(.top, 40)
          .homeRow()
      } else if shown.isEmpty {
        Text(loadError ?? String(localized: "No sessions"))
          .font(.ui(15))
          .foregroundStyle(Color.text3)
          .frame(maxWidth: .infinity)
          .padding(.top, 40)
          .homeRow()
      }

      ForEach(shown) { s in
        Button {
          open(s.id)
        } label: {
          SessionRow(session: s, device: app.device?.name)
        }
        .buttonStyle(RowStyle())
        .homeRow()
        .swipeActions(edge: .trailing) {
          Button(role: .destructive) {
            Task { await hide(s) }
          } label: {
            Label("Hide from list", systemImage: "eye.slash")
          }
        }
        .contextMenu {
          Button("Copy session ID", systemImage: "doc.on.doc") { UIPasteboard.general.string = s.id }
          Button("Hide from list", systemImage: "eye.slash", role: .destructive) {
            Task { await hide(s) }
          }
        }
      }
    }
    .listStyle(.plain)
    .environment(\.defaultMinListRowHeight, 0)
    .scrollContentBackground(.hidden)
    .background(Color.bg)
    .animation(.smooth, value: shown)
  }

  @ToolbarContentBuilder
  private var toolbar: some ToolbarContent {
    ToolbarItem(placement: .principal) {
      Text("Farline").font(.ui(18, .semibold))
    }
    ToolbarItem(placement: .topBarLeading) {
      Button {
        sheet = .settings
      } label: {
        Label("Settings", systemImage: "text.alignleft")
      }
    }
    ToolbarItemGroup(placement: .topBarTrailing) {
      Button {
        sheet = .history
      } label: {
        Label("History", systemImage: "clock")
      }
      Menu {
        Picker(selection: $filter) {
          Text("All").tag("")
          ForEach(Array(Set(sessions.map(\.cwd))).sorted(), id: \.self) { cwd in
            Text(verbatim: shortPath(cwd)).tag(cwd)
          }
        } label: {
          Text("Filter by folder")
        }
        .pickerStyle(.inline)
      } label: {
        Label("Filter", systemImage: "slider.vertical.3")
      }
    }
    DefaultToolbarItem(kind: .search, placement: .bottomBar)
    ToolbarSpacer(.flexible, placement: .bottomBar)
    ToolbarItem(placement: .bottomBar) {
      Button {
        sheet = .device
      } label: {
        HStack(spacing: 7) {
          Image(systemName: "plus")
          Text("New session")
        }
        .font(.ui(15, .medium))
        .padding(.horizontal, 6)
        .fixedSize()
      }
      .buttonStyle(.glassProminent)
      .tint(Color.pill)
    }
  }

  private func open(_ id: String) {
    path = [.session(id)]
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
    _ = try? await api.update(s.id, .init(hidden: true))
  }
}

struct DeviceChip: View {
  let name: String

  var body: some View {
    HStack(spacing: 9) {
      LaptopIcon(size: 20, lineWidth: 1.6)
        .overlay(alignment: .topTrailing) {
          Circle()
            .fill(Color.fGreen)
            .frame(width: 9, height: 9)
            .overlay(Circle().stroke(Color.bg, lineWidth: 2))
            .offset(x: 2, y: 1)
        }
      Text(verbatim: name)
        .font(.ui(15))
    }
    .foregroundStyle(Color.text1)
    .padding(.leading, 13)
    .padding(.trailing, 16)
    .frame(height: 40)
    .overlay(Capsule().strokeBorder(Color.line))
  }
}

struct SessionRow: View {
  let session: SessionSummary
  let device: String?

  var body: some View {
    HStack(alignment: .top, spacing: 20) {
      StatusGlyph(status: session.status)
        .frame(width: 16, height: 23)
      VStack(alignment: .leading, spacing: 1) {
        Text(session.title.isEmpty ? String(localized: "Untitled session") : session.title)
          .font(.ui(16))
          .foregroundStyle(Color.text1)
          .lineLimit(1)
        HStack(spacing: 5) {
          Text(verbatim: folderName(session.cwd).isEmpty ? device ?? "" : folderName(session.cwd))
            .lineLimit(1)
          LaptopIcon(size: 15, lineWidth: 1.7)
            .foregroundStyle(Color.fGreen.opacity(session.status == .idle ? 0.55 : 1))
          if let label = session.providerLabel {
            Tag(text: label)
          }
          if let n = session.tasks, n > 0 {
            Tag(text: String(localized: "\(n) in background"))
          }
        }
        .font(.ui(13.5))
        .foregroundStyle(Color.text3)
      }
      Spacer(minLength: 0)
    }
    .padding(.leading, 28)
    .padding(.trailing, 24)
    .padding(.vertical, 12)
    .contentShape(.rect)
  }
}

struct Tag: View {
  let text: String

  var body: some View {
    Text(verbatim: text)
      .font(.ui(12))
      .foregroundStyle(Color.text2)
      .padding(.horizontal, 7)
      .frame(height: 18)
      .background(Color.fillGray, in: .rect(cornerRadius: 6))
  }
}

// A row that dims a little while pressed.
struct RowStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(configuration.isPressed ? Color.text1.opacity(0.04) : Color.clear)
  }
}

private extension View {
  func homeRow() -> some View {
    self
      .listRowInsets(EdgeInsets())
      .listRowSeparator(.hidden)
      .listRowBackground(Color.bg)
  }

  func sectionLabel() -> some View {
    self
      .font(.ui(14))
      .foregroundStyle(Color.text2)
      .padding(.leading, 24)
      .padding(.trailing, 14)
  }
}

func folderName(_ path: String) -> String {
  let name = (path as NSString).lastPathComponent
  return name.isEmpty ? path : name
}

// "~/farline/web" for paths under a home folder.
func shortPath(_ path: String) -> String {
  let parts = path.split(separator: "/", omittingEmptySubsequences: true)
  if parts.count >= 2, parts[0] == "home" || parts[0] == "Users" {
    return (["~"] + parts.dropFirst(2)).joined(separator: "/")
  }
  if parts.first == "root" { return (["~"] + parts.dropFirst()).joined(separator: "/") }
  return path
}
