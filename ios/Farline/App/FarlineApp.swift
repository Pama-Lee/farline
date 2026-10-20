import SwiftUI

@main
struct FarlineApp: App {
  @State private var app = AppModel()

  var body: some Scene {
    WindowGroup {
      RootView()
        .environment(app)
    }
  }
}

struct RootView: View {
  @Environment(AppModel.self) private var app

  var body: some View {
    Group {
      switch app.phase {
      case .starting:
        ProgressView()
          .controlSize(.large)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      case .connect, .setup, .login:
        ConnectView()
      case .ready:
        if let api = app.api {
          SessionsView(api: api)
        }
      }
    }
    .animation(.smooth, value: app.phase)
    .task { await app.start() }
  }
}
