import SwiftUI

struct SettingsView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      Form {
        Section("Server") {
          LabeledContent("Address", value: app.serverURL?.absoluteString ?? "")
          if let device = app.device {
            LabeledContent("Device", value: device.name)
          }
          LabeledContent("Models", value: "\(app.catalog.models.count)")
        }

        Section {
          if let url = app.serverURL {
            Link(destination: url) {
              Label("Open the web app", systemImage: "safari")
            }
          }
        } footer: {
          Text("Plugins, skins and agent setup are managed in the web app.")
        }

        Section {
          Button("Sign out") {
            Task {
              await app.signOut()
              dismiss()
            }
          }
          Button("Use a different server", role: .destructive) {
            app.forgetServer()
            dismiss()
          }
        }

        Section {
          LabeledContent("Version", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "")
        }
      }
      .navigationTitle("Settings")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .confirmationAction) {
          Button(role: .close) { dismiss() }
        }
      }
    }
  }
}
