// "Add context", the sheet behind the composer's plus button, laid out like the
// Claude app's: camera and the latest photos in one row, then files, then permissions.
import Photos
import SwiftUI
import UIKit

struct ContextSheet: View {
  enum Action { case camera, photos, files }

  // Library photos already attached, by asset id; tapping one again detaches it.
  let attached: Set<String>
  @Binding var mode: PermissionMode
  let onToggle: (PHAsset) -> Void
  let onAction: (Action) -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var recent = RecentPhotos()

  var body: some View {
    VStack(spacing: 16) {
      ZStack {
        Text("Add context")
          .font(.ui(17, .semibold))
          .foregroundStyle(Color.text1)
        HStack {
          Button(role: .close) {
            dismiss()
          } label: {
            Image(systemName: "xmark")
              .font(.ui(17, .medium))
              .foregroundStyle(Color.text1)
              .frame(width: 30, height: 30)
          }
          .buttonStyle(.glass)
          .buttonBorderShape(.circle)
          .controlSize(.large)
          .accessibilityLabel(Text("Close"))
          Spacer()
          Button("Photos") { onAction(.photos) }
            .font(.ui(17))
            .foregroundStyle(Color.text1)
        }
      }
      .padding(.horizontal, 20)

      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 10) {
          Button { onAction(.camera) } label: {
            VStack(spacing: 8) {
              Image(systemName: "camera").font(.ui(22))
              Text("Camera").font(.ui(15))
            }
            .foregroundStyle(Color.text1)
            .frame(width: 104, height: 104)
            .background(Color.fillGray, in: .rect(cornerRadius: 22))
          }
          .buttonStyle(PressStyle())
          .disabled(!UIImagePickerController.isSourceTypeAvailable(.camera))

          ForEach(recent.assets, id: \.localIdentifier) { asset in
            PhotoTile(asset: asset, selected: attached.contains(asset.localIdentifier)) {
              onToggle(asset)
            }
          }
        }
        .padding(.horizontal, 20)
      }
      .scrollClipDisabled()

      VStack(spacing: 10) {
        Button { onAction(.files) } label: {
          row("Add files", systemImage: "doc.badge.arrow.up")
        }
        .buttonStyle(PressStyle())

        Menu {
          Picker(selection: $mode) {
            ForEach(PermissionMode.allCases) { m in
              Label(m.title, systemImage: m.symbol).tag(m)
            }
          } label: {
            EmptyView()
          }
          .pickerStyle(.inline)
        } label: {
          HStack {
            row("Permissions", systemImage: mode.symbol)
            Text(mode.title)
              .font(.ui(15))
              .foregroundStyle(Color.text2)
              .padding(.trailing, 18)
          }
          .background(Color.fillGray, in: .capsule)
        }
      }
      .padding(.horizontal, 20)

      Spacer(minLength: 0)
    }
    .padding(.top, 18)
    .presentationDetents([.fraction(0.5), .large])
    .presentationDragIndicator(.visible)
    .task { await recent.load() }
  }

  private func row(_ title: LocalizedStringKey, systemImage: String) -> some View {
    HStack(spacing: 12) {
      Image(systemName: systemImage).font(.ui(18)).frame(width: 24)
      Text(title).font(.ui(16))
      Spacer(minLength: 0)
    }
    .foregroundStyle(Color.text1)
    .padding(.horizontal, 18)
    .frame(height: 56)
    .background(Color.fillGray, in: .capsule)
  }
}

private struct PhotoTile: View {
  let asset: PHAsset
  let selected: Bool
  let onTap: () -> Void
  @State private var image: UIImage?

  var body: some View {
    Button(action: onTap) {
      ZStack(alignment: .topTrailing) {
        Color.fillGray
          .overlay {
            if let image { Image(uiImage: image).resizable().scaledToFill() }
          }
          .frame(width: 104, height: 104)
          .clipShape(.rect(cornerRadius: 22))
          .overlay {
            RoundedRectangle(cornerRadius: 22)
              .strokeBorder(selected ? Color.fBlue : .clear, lineWidth: 3)
          }
        if selected {
          Image(systemName: "checkmark.circle.fill")
            .font(.ui(22))
            .symbolRenderingMode(.palette)
            .foregroundStyle(.white, Color.fBlue)
            .padding(7)
            .transition(.scale.combined(with: .opacity))
        }
      }
    }
    .buttonStyle(PressStyle())
    .animation(.smooth(duration: 0.18), value: selected)
    .sensoryFeedback(.selection, trigger: selected)
    .task(id: asset.localIdentifier) {
      image = await PhotoLibrary.image(for: asset, side: 208)
    }
  }
}

@MainActor @Observable
final class RecentPhotos {
  var assets: [PHAsset] = []

  func load() async {
    // Screenshots can't answer the system prompt (simctl's grant doesn't cover it).
    if ProcessInfo.processInfo.environment["FARLINE_SHEET"] != nil, PHPhotoLibrary.authorizationStatus(for: .readWrite) == .notDetermined { return }
    let status = await PHPhotoLibrary.requestAuthorization(for: .readWrite)
    guard status == .authorized || status == .limited else { return }
    let options = PHFetchOptions()
    options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: false)]
    options.fetchLimit = 30
    let result = PHAsset.fetchAssets(with: .image, options: options)
    var list: [PHAsset] = []
    result.enumerateObjects { asset, _, _ in list.append(asset) }
    assets = list
  }
}

@MainActor
enum PhotoLibrary {
  static func image(for asset: PHAsset, side: CGFloat) async -> UIImage? {
    let options = PHImageRequestOptions()
    options.deliveryMode = .highQualityFormat
    options.resizeMode = .fast
    options.isNetworkAccessAllowed = true
    let size = CGSize(width: side * 2, height: side * 2)
    return await withCheckedContinuation { done in
      PHImageManager.default().requestImage(for: asset, targetSize: size, contentMode: .aspectFill, options: options) { image, _ in
        done.resume(returning: image)
      }
    }
  }

  // The full photo, from iCloud if need be.
  static func data(for asset: PHAsset) async -> Data? {
    let options = PHImageRequestOptions()
    options.deliveryMode = .highQualityFormat
    options.isNetworkAccessAllowed = true
    return await withCheckedContinuation { done in
      PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, _, _, _ in
        done.resume(returning: data)
      }
    }
  }
}

// The system camera, full screen.
struct CameraPicker: UIViewControllerRepresentable {
  let onImage: (UIImage) -> Void
  @Environment(\.dismiss) private var dismiss

  func makeUIViewController(context: Context) -> UIImagePickerController {
    let picker = UIImagePickerController()
    picker.sourceType = .camera
    picker.delegate = context.coordinator
    return picker
  }

  func updateUIViewController(_ picker: UIImagePickerController, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(self) }

  final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
    let parent: CameraPicker
    init(_ parent: CameraPicker) { self.parent = parent }

    func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
      if let image = info[.originalImage] as? UIImage { parent.onImage(image) }
      parent.dismiss()
    }

    func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
      parent.dismiss()
    }
  }
}
