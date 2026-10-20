// First screen, as the web's sign-in looks: the icon, the name, then the
// server address, the password, or (on a fresh server) the setup code and a
// new password.
import SwiftUI

struct ConnectView: View {
  @Environment(AppModel.self) private var app

  @State private var server = ""
  @State private var password = ""
  @State private var code = ""
  @State private var busy = false
  @State private var error: String?
  @FocusState private var focus: Field?

  private enum Field { case server, code, password }

  var body: some View {
    ScrollView {
      VStack(spacing: 18) {
        Image("Logo")
          .resizable()
          .frame(width: 72, height: 72)
          .clipShape(.rect(cornerRadius: 17, style: .continuous))
        Text(verbatim: "Farline")
          .font(.ui(22, .semibold))
          .foregroundStyle(Color.text1)
          .padding(.top, -8)
        Text(subtitle)
          .font(.ui(15))
          .foregroundStyle(Color.text2)
          .multilineTextAlignment(.center)
          .padding(.top, -10)
        form
      }
      .padding(24)
      .frame(maxWidth: 408)
      .frame(maxWidth: .infinity)
      .containerRelativeFrame(.vertical, alignment: .center) { h, _ in h * 0.9 }
    }
    .scrollBounceBehavior(.basedOnSize)
    .background(Color.bg)
    .onAppear {
      if server.isEmpty { server = app.serverURL?.absoluteString ?? "" }
      focus = app.phase == .connect ? .server : app.phase == .setup ? .code : .password
    }
    .onChange(of: app.phase) { _, phase in
      error = nil
      focus = phase == .setup ? .code : phase == .login ? .password : .server
    }
  }

  private var subtitle: LocalizedStringKey {
    switch app.phase {
    case .setup: "Set a password and you're ready to go."
    case .login: "Sign in to \(app.serverURL?.host() ?? "your server")."
    default: "Connect to your Farline server."
    }
  }

  @ViewBuilder
  private var form: some View {
    VStack(spacing: 12) {
      switch app.phase {
      case .setup:
        field("Setup code", text: $code, field: .code)
          .textInputAutocapitalization(.characters)
          .multilineTextAlignment(.center)
        secure("New password")
      case .login:
        secure("Password")
      default:
        field("Server address", text: $server, field: .server)
          .keyboardType(.URL)
          .textContentType(.URL)
          .textInputAutocapitalization(.never)
      }

      Button(action: submit) {
        Group {
          if busy { ProgressView().tint(Color.onInk) } else { Text(buttonTitle) }
        }
      }
      .buttonStyle(InkButtonStyle(height: 52))
      .disabled(busy || !canSubmit)

      Text(error ?? app.connectError ?? hint)
        .font(.ui(error ?? app.connectError == nil ? 13 : 15))
        .foregroundStyle(error ?? app.connectError == nil ? Color.text3 : Color.fRed)
        .multilineTextAlignment(.center)
        .frame(minHeight: 22)

      if app.phase != .connect {
        Button("Use a different server") { app.forgetServer() }
          .font(.ui(14))
          .foregroundStyle(Color.text2)
      }
    }
    .animation(.smooth, value: app.phase)
  }

  private var hint: String {
    app.phase == .setup ? String(localized: "The setup code is printed in the terminal or log where Farline started, and saved as the setup-code file in its data folder.") : ""
  }

  private func field(_ title: LocalizedStringKey, text: Binding<String>, field: Field) -> some View {
    TextField(title, text: text)
      .autocorrectionDisabled()
      .focused($focus, equals: field)
      .submitLabel(.go)
      .onSubmit(submit)
      .inputStyle()
  }

  private func secure(_ title: LocalizedStringKey) -> some View {
    SecureField(title, text: $password)
      .textContentType(app.phase == .setup ? .newPassword : .password)
      .focused($focus, equals: .password)
      .submitLabel(.go)
      .onSubmit(submit)
      .inputStyle()
  }

  private var buttonTitle: LocalizedStringKey {
    switch app.phase {
    case .setup: "Set password"
    case .login: "Sign in"
    default: "Connect"
    }
  }

  private var canSubmit: Bool {
    switch app.phase {
    case .setup: !code.isEmpty && password.count >= 8
    case .login: !password.isEmpty
    default: !server.trimmingCharacters(in: .whitespaces).isEmpty
    }
  }

  private func submit() {
    guard canSubmit, !busy else { return }
    busy = true
    error = nil
    Task {
      defer { busy = false }
      do {
        switch app.phase {
        case .setup: try await app.setup(code: code, password: password)
        case .login: try await app.login(password: password)
        default: await app.connect(to: server)
        }
        password = ""
      } catch {
        withAnimation { self.error = error.localizedDescription }
      }
    }
  }
}

private extension View {
  func inputStyle() -> some View {
    self
      .font(.ui(17))
      .foregroundStyle(Color.text1)
      .padding(.horizontal, 22)
      .frame(height: 52)
      .background(Color.surface, in: .capsule)
      .overlay(Capsule().strokeBorder(Color.line))
  }
}
