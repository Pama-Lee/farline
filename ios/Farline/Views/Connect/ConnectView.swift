// First screen: which server, then the password (or, on a fresh server, the
// one-time setup code and a new password).
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
    ZStack {
      HorizonBackground()
        .ignoresSafeArea()

      ScrollView {
        VStack(spacing: 28) {
          Spacer(minLength: 60)
          header
          form
          Spacer(minLength: 20)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: 460)
        .frame(maxWidth: .infinity)
      }
      .scrollBounceBehavior(.basedOnSize)
    }
    .onAppear {
      if server.isEmpty { server = app.serverURL?.absoluteString ?? "" }
      focus = app.phase == .connect ? .server : app.phase == .setup ? .code : .password
    }
    .onChange(of: app.phase) { _, phase in
      error = nil
      focus = phase == .setup ? .code : phase == .login ? .password : .server
    }
  }

  private var header: some View {
    VStack(spacing: 10) {
      Image(systemName: "point.forward.to.point.capsulepath")
        .font(.system(size: 44, weight: .light))
        .foregroundStyle(.white)
        .frame(width: 84, height: 84)
        .glassEffect(.regular.tint(.indigo.opacity(0.35)), in: .rect(cornerRadius: 24))
      Text("Farline")
        .font(.largeTitle.bold())
      Text(subtitle)
        .font(.subheadline)
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.center)
    }
  }

  private var subtitle: LocalizedStringKey {
    switch app.phase {
    case .setup: "Enter the setup code shown where Farline was started, then choose a password."
    case .login: "Sign in to \(app.serverURL?.host() ?? "your server")."
    default: "Connect to your Farline server."
    }
  }

  @ViewBuilder
  private var form: some View {
    VStack(spacing: 14) {
      switch app.phase {
      case .setup:
        field("Setup code", text: $code, field: .code)
          .textInputAutocapitalization(.characters)
        secure("New password (8+ characters)")
      case .login:
        secure("Password")
      default:
        field("Server address", text: $server, field: .server, prompt: "farline.example.com")
          .keyboardType(.URL)
          .textContentType(.URL)
          .textInputAutocapitalization(.never)
      }

      if let message = error ?? app.connectError {
        Text(message)
          .font(.footnote)
          .foregroundStyle(.red)
          .frame(maxWidth: .infinity, alignment: .leading)
          .transition(.opacity)
      }

      Button(action: submit) {
        Group {
          if busy { ProgressView().tint(.white) } else { Text(buttonTitle).fontWeight(.semibold) }
        }
        .frame(maxWidth: .infinity, minHeight: 30)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
      .disabled(busy || !canSubmit)

      if app.phase != .connect {
        Button("Use a different server") { app.forgetServer() }
          .font(.footnote)
          .buttonStyle(.borderless)
      }
    }
    .padding(20)
    .glassEffect(.regular, in: .rect(cornerRadius: 28))
    .animation(.smooth, value: app.phase)
  }

  private func field(_ title: LocalizedStringKey, text: Binding<String>, field: Field, prompt: String? = nil) -> some View {
    TextField(title, text: text, prompt: prompt.map { Text(verbatim: $0) })
      .autocorrectionDisabled()
      .focused($focus, equals: field)
      .submitLabel(.go)
      .onSubmit(submit)
      .padding(.horizontal, 16)
      .frame(minHeight: 50)
      .background(.background.opacity(0.55), in: .capsule)
  }

  private func secure(_ title: LocalizedStringKey) -> some View {
    SecureField(title, text: $password)
      .textContentType(app.phase == .setup ? .newPassword : .password)
      .focused($focus, equals: .password)
      .submitLabel(.go)
      .onSubmit(submit)
      .padding(.horizontal, 16)
      .frame(minHeight: 50)
      .background(.background.opacity(0.55), in: .capsule)
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

// A slow, soft gradient for the glass to sit on.
struct HorizonBackground: View {
  var body: some View {
    TimelineView(.animation(minimumInterval: 1 / 20)) { context in
      let t = Float(context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 40) / 40 * 2 * .pi)
      MeshGradient(
        width: 3,
        height: 3,
        points: [
          [0, 0], [0.5, 0], [1, 0],
          [0, 0.5], [0.5 + 0.15 * sin(t), 0.45 + 0.1 * cos(t)], [1, 0.5],
          [0, 1], [0.5, 1], [1, 1],
        ],
        colors: [
          .indigo, .purple, .blue,
          .blue, .teal, .indigo,
          .black, .indigo, .purple,
        ]
      )
      .opacity(0.85)
    }
  }
}
