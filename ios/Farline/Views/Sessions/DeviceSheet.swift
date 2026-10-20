// Sheets opened from home: the device (pick a folder, start a session) and
// the history of every session by day.
import SwiftUI

struct DeviceSheet: View {
  let api: APIClient
  let sessions: [SessionSummary]
  let onNew: (String) -> Void
  let onOpen: (String) -> Void

  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @State private var cwd: String

  init(api: APIClient, start: String?, sessions: [SessionSummary], onNew: @escaping (String) -> Void, onOpen: @escaping (String) -> Void) {
    self.api = api
    self.sessions = sessions
    self.onNew = onNew
    self.onOpen = onOpen
    _cwd = State(initialValue: start ?? "")
  }

  // Sessions in this folder that are busy or recent.
  private var active: [SessionSummary] {
    let week = Date().addingTimeInterval(-7 * 86400)
    return Array(sessions.filter { $0.cwd == cwd && ($0.status != .idle || $0.updated > week) }.prefix(12))
  }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          FieldLabel("Folders")
          NavigationLink {
            DirPicker(api: api, start: cwd) { cwd = $0 }
          } label: {
            HStack {
              Text(verbatim: cwd)
                .font(.ui(14.5))
                .lineLimit(1)
                .truncationMode(.head)
              Spacer()
              Image(systemName: "chevron.right")
                .font(.ui(15, .medium))
                .foregroundStyle(Color.text2)
            }
            .foregroundStyle(Color.text1)
            .padding(.horizontal, 17)
            .frame(height: 48)
            .background(Color.rowFill, in: .capsule)
          }
          .buttonStyle(PressStyle())

          if !active.isEmpty {
            FieldLabel("\(active.count) active sessions")
              .padding(.top, 10)
            VStack(spacing: 10) {
              ForEach(active) { s in
                Button {
                  onOpen(s.id)
                } label: {
                  ActiveCard(session: s)
                }
                .buttonStyle(PressStyle())
              }
            }
          }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 20)
      }
      .background(Color.bg)
      .safeAreaInset(edge: .bottom) {
        Button {
          onNew(cwd)
        } label: {
          Label("New session", systemImage: "plus")
        }
        .buttonStyle(InkButtonStyle())
        .disabled(cwd.isEmpty)
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
      }
      .navigationTitle(app.device?.name ?? "")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(role: .close) { dismiss() }
        }
      }
    }
    .presentationDetents([.fraction(0.76), .large])
    .farlineSheet()
    .onAppear {
      if cwd.isEmpty { cwd = app.device?.defaultCwd ?? "" }
    }
  }
}

private struct ActiveCard: View {
  let session: SessionSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 3) {
      HStack(spacing: 8) {
        if session.status == .idle {
          Circle().fill(Color.text3).frame(width: 7, height: 7).padding(.horizontal, 3)
        } else {
          StatusGlyph(status: session.status)
        }
        Text(session.title)
          .font(.ui(14.5))
          .foregroundStyle(Color.text1)
          .lineLimit(1)
        Spacer(minLength: 4)
        Group {
          if session.status == .idle {
            Text(session.updated, format: .relative(presentation: .named))
          } else {
            Text(session.status == .requiresAction ? LocalizedStringKey("Waiting") : LocalizedStringKey("Working")) + Text(verbatim: " · ") + Text(session.updated, format: .relative(presentation: .named))
          }
        }
        .font(.ui(12.5))
        .foregroundStyle(Color.text2)
      }
      HStack(spacing: 6) {
        LaptopIcon(size: 14, lineWidth: 1.7).foregroundStyle(Color.fGreen)
        Text(verbatim: shortPath(session.cwd))
      }
      .font(.ui(12.5))
      .foregroundStyle(Color.text2)
    }
    .padding(.horizontal, 15)
    .padding(.vertical, 12)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(Color.surface, in: .rect(cornerRadius: 20))
    .shadow(color: .black.opacity(0.06), radius: 7, y: 3)
  }
}

// Browse the server's folders and pick one.
struct DirPicker: View {
  let api: APIClient
  let onPick: (String) -> Void

  @Environment(\.dismiss) private var dismiss
  @AppStorage("farline.hiddenDirs") private var showHidden = false
  @State private var path: String
  @State private var typed: String
  @State private var listing: DirListing?
  @State private var error: String?

  init(api: APIClient, start: String, onPick: @escaping (String) -> Void) {
    self.api = api
    self.onPick = onPick
    _path = State(initialValue: start)
    _typed = State(initialValue: start)
  }

  var body: some View {
    List {
      Section {
        TextField(text: $typed) { Text(verbatim: "/") }
          .font(.ui(15))
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
          .submitLabel(.go)
          .onSubmit {
            let p = typed.trimmingCharacters(in: .whitespaces)
            if !p.isEmpty { path = p }
          }
          .listRowBackground(Color.surface)
      }
      Section {
        if let listing {
          if let parent = listing.parent {
            Button {
              path = parent
            } label: {
              Label("Up", systemImage: "arrow.turn.left.up")
            }
          }
          ForEach(listing.dirs) { d in
            Button {
              path = d.path
            } label: {
              HStack {
                Label(d.name, systemImage: "folder")
                  .foregroundStyle(d.hidden == true ? Color.text2 : Color.text1)
                Spacer()
                Image(systemName: "chevron.right")
                  .font(.ui(13, .medium))
                  .foregroundStyle(Color.text3)
              }
            }
          }
          if listing.dirs.isEmpty {
            Text("No subfolders").foregroundStyle(Color.text3)
          }
        } else if let error {
          Text(error).foregroundStyle(Color.fRed)
        } else {
          ProgressView().frame(maxWidth: .infinity)
        }
      }
      .listRowBackground(Color.surface)
    }
    .font(.ui(15.5))
    .tint(Color.text2)
    .foregroundStyle(Color.text1)
    .farlineList()
    .safeAreaInset(edge: .bottom) {
      Button("Use this folder") {
        if let p = listing?.path { onPick(p) }
        dismiss()
      }
      .buttonStyle(InkButtonStyle())
      .disabled(listing == nil)
      .padding(.horizontal, 16)
      .padding(.bottom, 10)
    }
    .navigationTitle("Choose a folder")
    .navigationBarTitleDisplayMode(.inline)
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button {
          showHidden.toggle()
        } label: {
          Label(showHidden ? LocalizedStringKey("Hide hidden folders") : LocalizedStringKey("Show hidden folders"), systemImage: showHidden ? "eye" : "eye.slash")
        }
      }
    }
    .task(id: "\(path)|\(showHidden)") {
      listing = nil
      do {
        let l = try await api.dirs(path.isEmpty ? nil : path, hidden: showHidden)
        listing = l
        typed = l.path
        error = nil
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}

struct HistorySheet: View {
  let sessions: [SessionSummary]
  let onOpen: (String) -> Void

  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      List {
        ForEach(groups, id: \.title) { group in
          Section {
            ForEach(group.sessions) { s in
              Button {
                onOpen(s.id)
              } label: {
                HStack(spacing: 12) {
                  Text(s.title.isEmpty ? String(localized: "Untitled session") : s.title)
                    .foregroundStyle(Color.text1)
                    .lineLimit(1)
                  Spacer(minLength: 8)
                  Text(s.updated, format: .relative(presentation: .named))
                    .font(.ui(13.5))
                    .foregroundStyle(Color.text2)
                }
                .font(.ui(15.5))
              }
            }
          } header: {
            Text(group.title)
              .font(.ui(12.5))
              .foregroundStyle(Color.text2)
              .textCase(nil)
          }
          .listRowBackground(Color.surface)
        }
      }
      .farlineList()
      .navigationTitle("History")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(role: .close) { dismiss() }
        }
      }
    }
    .presentationDetents([.fraction(0.76), .large])
    .farlineSheet()
  }

  // Today, yesterday, this week, this month, earlier.
  private var groups: [(title: String, sessions: [SessionSummary])] {
    // Counted back from midnight, as the web does.
    let today = Calendar.current.startOfDay(for: Date())
    func bucket(_ d: Date) -> Int {
      let days = today.timeIntervalSince(d) / 86400
      if days <= 0 { return 0 }
      if days <= 1 { return 1 }
      if days <= 6 { return 2 }
      if days <= 29 { return 3 }
      return 4
    }
    let titles = [String(localized: "Today"), String(localized: "Yesterday"), String(localized: "This week"), String(localized: "This month"), String(localized: "Earlier")]
    let byBucket = Dictionary(grouping: sessions) { bucket($0.updated) }
    return (0..<5).compactMap { i in byBucket[i].map { (title: titles[i], sessions: $0) } }
  }
}

struct FieldLabel: View {
  let title: Text

  init(_ key: LocalizedStringKey) { title = Text(key) }

  var body: some View {
    title
      .font(.ui(12.5))
      .foregroundStyle(Color.text2)
      .padding(.horizontal, 2)
      .padding(.top, 16)
      .padding(.bottom, 6)
  }
}
