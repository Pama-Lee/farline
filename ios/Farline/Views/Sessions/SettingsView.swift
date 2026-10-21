// Settings as the web lays them out: one white pill per row, with Agent and
// Plugins pages pushed inside the sheet.
import SwiftUI
import UIKit

struct SettingsView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var plugins: [PluginInfo]?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          if let api = app.api {
            NavigationLink {
              AgentsView(api: api)
            } label: {
              SettingsRow(title: "Agent", systemImage: "apple.terminal", chevron: true)
            }
            .buttonStyle(PressStyle())
          }
          Button {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
          } label: {
            SettingsRow(title: "Language", systemImage: "translate", value: String(localized: "Auto"))
          }
          .buttonStyle(PressStyle())
          if let api = app.api {
            NavigationLink {
              PluginsView(api: api, plugins: $plugins)
            } label: {
              SettingsRow(title: "Plugins", systemImage: "puzzlepiece", value: plugins.map { "\($0.filter(\.active).count)" })
            }
            .buttonStyle(PressStyle())
          }
          Button {
            Task {
              await app.signOut()
              dismiss()
            }
          } label: {
            SettingsRow(title: "Sign out", systemImage: "rectangle.portrait.and.arrow.right")
          }
          .buttonStyle(PressStyle())

          if let url = app.serverURL {
            Button {
              openURL(url)
            } label: {
              SettingsRow(title: "Server", systemImage: "server.rack", value: url.host() ?? url.absoluteString)
            }
            .buttonStyle(PressStyle())
            .padding(.top, 8)
          }
          Button {
            app.forgetServer()
            dismiss()
          } label: {
            SettingsRow(title: "Use a different server", systemImage: "arrow.left.arrow.right", tint: .fRed)
          }
          .buttonStyle(PressStyle())
          Text(verbatim: "Farline \(Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")")
            .font(.ui(13))
            .foregroundStyle(Color.text3)
            .padding(.top, 4)
        }
        .padding(.horizontal, 16)
        .padding(.top, 8)
        .padding(.bottom, 20)
      }
      .background(Color.bg)
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(role: .close) { dismiss() }
        }
      }
    }
    .presentationDetents([.fraction(0.7), .large])
    .farlineSheet()
    .task {
      if plugins == nil { plugins = try? await app.api?.plugins() }
    }
  }
}

struct SettingsRow<Trailing: View>: View {
  let title: LocalizedStringKey
  let systemImage: String
  var value: String?
  var chevron = false
  var tint: Color = .text1
  @ViewBuilder var trailing: Trailing

  var body: some View {
    HStack(spacing: 12) {
      Image(systemName: systemImage)
        .font(.ui(17, .light))
        .frame(width: 26)
      Text(title)
        .lineLimit(1)
      Spacer(minLength: 8)
      if let value {
        Text(verbatim: value)
          .foregroundStyle(Color.text2)
          .lineLimit(1)
      }
      trailing
      if chevron {
        Image(systemName: "chevron.right")
          .font(.ui(15, .medium))
          .foregroundStyle(Color.text3)
      }
    }
    .font(.ui(15.5))
    .foregroundStyle(tint)
    .padding(.horizontal, 17)
    .frame(minHeight: 50)
    .background(Color.surface, in: .capsule)
    .contentShape(.capsule)
  }
}

extension SettingsRow where Trailing == EmptyView {
  init(title: LocalizedStringKey, systemImage: String, value: String? = nil, chevron: Bool = false, tint: Color = .text1) {
    self.init(title: title, systemImage: systemImage, value: value, chevron: chevron, tint: tint) { EmptyView() }
  }
}

// The coding agents on the server and whether they're installed.
private struct AgentsView: View {
  let api: APIClient

  @Environment(\.openURL) private var openURL
  @State private var agents: [AgentStatus]?
  @State private var error: String?

  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        if let agents {
          ForEach(agents) { a in
            Button {
              if let s = a.homepage, let url = URL(string: s) { openURL(url) }
            } label: {
              SettingsRow(title: LocalizedStringKey(a.name), systemImage: "apple.terminal", value: status(a))
            }
            .buttonStyle(PressStyle())
          }
        } else if let error {
          Text(error).font(.ui(14)).foregroundStyle(Color.fRed)
        } else {
          ProgressView().padding(.top, 20)
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
    }
    .background(Color.bg)
    .navigationTitle("Agent")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      do { agents = try await api.agents() } catch { self.error = error.localizedDescription }
    }
  }

  private func status(_ a: AgentStatus) -> String {
    if a.installing == true { return String(localized: "Installing…") }
    guard a.installed else { return String(localized: "Not installed") }
    return a.version.map { v in String(localized: "Installed \(v)") } ?? String(localized: "Installed")
  }
}

// Plugins, each with a switch, as the web's list.
private struct PluginsView: View {
  let api: APIClient
  @Binding var plugins: [PluginInfo]?

  @State private var error: String?

  var body: some View {
    ScrollView {
      VStack(spacing: 16) {
        if let plugins {
          if plugins.isEmpty {
            Text("No plugins").font(.ui(14.5)).foregroundStyle(Color.text3).padding(.top, 20)
          }
          ForEach(plugins) { p in
            SettingsRow(title: LocalizedStringKey(p.name), systemImage: p.skin == true ? "paintpalette" : "puzzlepiece") {
              Toggle(isOn: Binding(get: { p.enabled }, set: { on in toggle(p, on) })) { EmptyView() }
                .labelsHidden()
                .tint(Color(red: 0.204, green: 0.78, blue: 0.349))
            }
          }
        } else if let error {
          Text(error).font(.ui(14)).foregroundStyle(Color.fRed)
        } else {
          ProgressView().padding(.top, 20)
        }
        if let error, plugins != nil {
          Text(error).font(.ui(13.5)).foregroundStyle(Color.fRed)
        }
      }
      .padding(.horizontal, 16)
      .padding(.top, 8)
    }
    .background(Color.bg)
    .navigationTitle("Plugins")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      do { plugins = try await api.plugins() } catch { self.error = error.localizedDescription }
    }
  }

  private func toggle(_ p: PluginInfo, _ on: Bool) {
    Task {
      do {
        let updated = try await api.setPluginEnabled(p.id, on)
        plugins = plugins?.map { $0.id == updated.id ? updated : $0 }
        error = nil
      } catch {
        self.error = error.localizedDescription
      }
    }
  }
}
