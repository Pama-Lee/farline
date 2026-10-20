// Settings as the web lays them out: one white pill per row.
import SwiftUI
import UIKit

struct SettingsView: View {
  @Environment(AppModel.self) private var app
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(spacing: 16) {
          if let url = app.serverURL {
            row("Server", systemImage: "server.rack", value: url.host() ?? url.absoluteString) {
              openURL(url)
            }
          }
          row("Language", systemImage: "character.bubble", value: String(localized: "Auto")) {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
          }
          row("Plugins, skins and agents", systemImage: "puzzlepiece.extension", chevron: true) {
            if let url = app.serverURL { openURL(url) }
          }
          row("Sign out", systemImage: "rectangle.portrait.and.arrow.right") {
            Task {
              await app.signOut()
              dismiss()
            }
          }
          row("Use a different server", systemImage: "arrow.left.arrow.right", tint: .fRed) {
            app.forgetServer()
            dismiss()
          }
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
  }

  private func row(_ title: LocalizedStringKey, systemImage: String, value: String? = nil, chevron: Bool = false, tint: Color = .text1, action: @escaping () -> Void) -> some View {
    Button(action: action) {
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
        if chevron {
          Image(systemName: "chevron.right")
            .font(.ui(15, .medium))
            .foregroundStyle(Color.text2)
        }
      }
      .font(.ui(15.5))
      .foregroundStyle(tint)
      .padding(.horizontal, 17)
      .frame(height: 50)
      .background(Color.surface, in: .capsule)
      .contentShape(.capsule)
    }
    .buttonStyle(PressStyle())
  }
}
