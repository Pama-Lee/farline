// The web app's palette and the few shapes it's built from (web/src/styles.css),
// with dark variants in the same spirit.
import SwiftUI
import UIKit

extension Color {
  static let bg = Color(light: 0xF9F9F7, dark: 0x262624)
  static let surface = Color(light: 0xFFFFFF, dark: 0x30302E)
  static let fillGray = Color(light: 0xEFEFEF, dark: 0x3A3A37)
  static let tile = Color(light: 0xF0EFEC, dark: 0x3A3A37)
  static let rowFill = Color(light: 0xF3F3F0, dark: 0x30302E)
  static let composer = Color(light: 0xFBFBFA, dark: 0x30302E)
  static let inlineCode = Color(light: 0xEEEEEC, dark: 0x3A3A37)
  static let text1 = Color(light: 0x141413, dark: 0xFAF9F5)
  static let text2 = Color(light: 0x646462, dark: 0xA6A39B)
  static let text3 = Color(light: 0x9E9D99, dark: 0x75736C)
  static let line = Color(light: 0xE6E6E4, dark: 0x3E3E3A)
  static let fOrange = Color(light: 0xC6613F, dark: 0xD0704E)
  static let claude = Color(hex: 0xD97757)
  static let fBlue = Color(light: 0x2A6AC1, dark: 0x6EA2EE)
  static let fRed = Color(light: 0xB4473A, dark: 0xE5735F)
  static let fGreen = Color(light: 0x3A9B4F, dark: 0x5CB36E)
  // Primary buttons: black on light, light on dark.
  static let ink = Color(light: 0x141413, dark: 0xFAF9F5)
  static let onInk = Color(light: 0xFFFFFF, dark: 0x141413)
  static let pill = Color(light: 0x2B2B2A, dark: 0xFAF9F5)
  static let sendOff = Color(light: 0xE4E3E0, dark: 0x45443F)
  static let idleRing = Color(light: 0x4A4A48, dark: 0xA6A39B)

  init(hex: UInt32) {
    self.init(.sRGB, red: Double(hex >> 16 & 0xFF) / 255, green: Double(hex >> 8 & 0xFF) / 255, blue: Double(hex & 0xFF) / 255)
  }

  init(light: UInt32, dark: UInt32) {
    self.init(uiColor: UIColor { traits in
      let hex = traits.userInterfaceStyle == .dark ? dark : light
      return UIColor(red: CGFloat(hex >> 16 & 0xFF) / 255, green: CGFloat(hex >> 8 & 0xFF) / 255, blue: CGFloat(hex & 0xFF) / 255, alpha: 1)
    })
  }
}

extension Font {
  static func ui(_ size: CGFloat, _ weight: Font.Weight = .regular) -> Font {
    .system(size: size, weight: weight)
  }

  static func mono(_ size: CGFloat) -> Font {
    .system(size: size, design: .monospaced)
  }
}

// The web's spinner: a light ring with a blue arc.
struct Ring: View {
  var size: CGFloat = 22
  var width: CGFloat = 2.4

  var body: some View {
    TimelineView(.animation) { context in
      let turn = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 0.9) / 0.9
      ZStack {
        Circle().stroke(Color.line, lineWidth: width)
        Circle()
          .trim(from: 0, to: 0.25)
          .stroke(Color.fBlue, style: StrokeStyle(lineWidth: width, lineCap: .round))
          .rotationEffect(.degrees(turn * 360 - 90))
      }
      .frame(width: size - width, height: size - width)
      .frame(width: size, height: size)
    }
  }
}

// Running, waiting on the user, or idle, as the home list shows it.
struct StatusGlyph: View {
  let status: SessionStatus

  var body: some View {
    switch status {
    case .running, .busyElsewhere:
      Ring(size: 15, width: 2)
    case .requiresAction:
      Circle().fill(Color.claude).frame(width: 10, height: 10)
    case .idle:
      Circle().strokeBorder(Color.idleRing, lineWidth: 1.6).frame(width: 11, height: 11)
    }
  }
}

// Black capsule buttons: "New session", "Allow", "Submit".
struct InkButtonStyle: ButtonStyle {
  var height: CGFloat = 44
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.ui(15.5, .medium))
      .foregroundStyle(Color.onInk)
      .frame(maxWidth: .infinity, minHeight: height)
      .background(Color.ink, in: .capsule)
      .opacity(enabled ? 1 : 0.35)
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.smooth(duration: 0.15), value: configuration.isPressed)
  }
}

// White capsule with a hairline: "Deny", "Skip".
struct OutlineButtonStyle: ButtonStyle {
  var height: CGFloat = 44
  @Environment(\.isEnabled) private var enabled

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.ui(15.5, .medium))
      .foregroundStyle(Color.text1)
      .frame(maxWidth: .infinity, minHeight: height)
      .background(Color.surface, in: .capsule)
      .overlay(Capsule().strokeBorder(Color.line))
      .opacity(enabled ? 1 : 0.35)
      .scaleEffect(configuration.isPressed ? 0.97 : 1)
      .animation(.smooth(duration: 0.15), value: configuration.isPressed)
  }
}

// Shrinks a little when pressed, like the web's :active.
struct PressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .scaleEffect(configuration.isPressed ? 0.94 : 1)
      .animation(.smooth(duration: 0.15), value: configuration.isPressed)
  }
}

// Sheets share the page background, like the web's.
extension View {
  func farlineSheet() -> some View {
    self
      .presentationBackground(Color.bg)
      .presentationDragIndicator(.visible)
  }

  // Grouped lists on the page background; rows set their own white.
  func farlineList() -> some View {
    self
      .scrollContentBackground(.hidden)
      .background(Color.bg)
  }
}

// The web's laptop icon (lucide): an outlined screen on a flared base.
struct LaptopIcon: View {
  var size: CGFloat = 20
  var lineWidth: CGFloat = 1.6

  var body: some View {
    LaptopShape()
      .stroke(style: StrokeStyle(lineWidth: lineWidth * 24 / size, lineCap: .round, lineJoin: .round))
      .frame(width: 24, height: 24)
      .scaleEffect(size / 24)
      .frame(width: size, height: size)
  }
}

private struct LaptopShape: Shape {
  func path(in rect: CGRect) -> Path {
    let s = rect.width / 24
    func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: rect.minX + x * s, y: rect.minY + y * s) }
    var path = Path()
    path.move(to: p(6, 5))
    path.addLine(to: p(18, 5))
    path.addQuadCurve(to: p(20, 7), control: p(20, 5))
    path.addLine(to: p(20, 15.5))
    path.addLine(to: p(21.28, 18.55))
    path.addQuadCurve(to: p(20.38, 20), control: p(21.6, 20))
    path.addLine(to: p(3.62, 20))
    path.addQuadCurve(to: p(2.72, 18.55), control: p(2.4, 20))
    path.addLine(to: p(4, 15.5))
    path.addLine(to: p(4, 7))
    path.addQuadCurve(to: p(6, 5), control: p(4, 5))
    path.closeSubpath()
    path.move(to: p(20, 16))
    path.addLine(to: p(4, 16))
    return path
  }
}
