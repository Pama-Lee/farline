// The floating glass composer: attach, type, send or stop.
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct Composer: View {
  let model: SessionModel

  @State private var text = ""
  @State private var attachments: [Attachment] = []
  @State private var photoItems: [PhotosPickerItem] = []
  @State private var showPhotos = false
  @State private var showFiles = false
  @State private var sending = false
  @State private var sent = 0
  @State private var error: String?
  @FocusState private var focused: Bool

  struct Attachment: Identifiable {
    let id = UUID()
    var name: String
    var preview: UIImage?
    var upload: Upload?
    var failed = false
  }

  private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
  private var uploading: Bool { attachments.contains { $0.upload == nil && !$0.failed } }
  private var canSend: Bool { (!trimmed.isEmpty || attachments.contains { $0.upload != nil }) && !uploading && !sending && !model.busyElsewhere }

  var body: some View {
    VStack(spacing: 8) {
      if let error {
        Text(error)
          .font(.footnote)
          .foregroundStyle(.red)
          .padding(.horizontal, 14)
          .padding(.vertical, 8)
          .glassEffect(.regular, in: .capsule)
          .onTapGesture { self.error = nil }
      }
      if model.busyElsewhere {
        Label("Running in another app. Wait for it to finish.", systemImage: "desktopcomputer")
          .font(.footnote)
          .foregroundStyle(.secondary)
      }
      if !attachments.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(attachments) { a in
              attachmentChip(a)
            }
          }
          .padding(.horizontal, 4)
        }
      }
      GlassEffectContainer(spacing: 10) {
        HStack(alignment: .bottom, spacing: 10) {
          Menu {
            Button("Photos", systemImage: "photo.on.rectangle") { showPhotos = true }
            Button("Files", systemImage: "folder") { showFiles = true }
          } label: {
            Image(systemName: "plus")
              .font(.title3.weight(.medium))
              .frame(width: 46, height: 46)
              .contentShape(.circle)
          }
          .glassEffect(.regular.interactive(), in: .circle)

          TextField("Message", text: $text, axis: .vertical)
            .lineLimit(1...8)
            .focused($focused)
            .padding(.leading, 18)
            .padding(.trailing, 8)
            .padding(.vertical, 12)
            .frame(minHeight: 46)
            .glassEffect(.regular.interactive(), in: .rect(cornerRadius: 23))

          if model.running && trimmed.isEmpty {
            Button {
              Task { await model.interrupt() }
            } label: {
              Image(systemName: "stop.fill")
                .font(.body.weight(.semibold))
                .frame(width: 32, height: 32)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .tint(Color.primary)
            .transition(.scale.combined(with: .opacity))
          } else {
            Button(action: send) {
              Group {
                if sending { ProgressView().tint(.white) } else { Image(systemName: "arrow.up").font(.body.weight(.bold)) }
              }
              .frame(width: 32, height: 32)
            }
            .buttonStyle(.glassProminent)
            .buttonBorderShape(.circle)
            .disabled(!canSend)
            .transition(.scale.combined(with: .opacity))
          }
        }
      }
      .animation(.smooth(duration: 0.2), value: model.running && trimmed.isEmpty)
    }
    .padding(.horizontal, 12)
    .padding(.top, 6)
    .padding(.bottom, 6)
    .frame(maxWidth: 760)
    .sensoryFeedback(.impact(weight: .light), trigger: sent)
    .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 6, matching: .images)
    .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
      if case .success(let urls) = result { addFiles(urls) }
    }
    .onChange(of: photoItems) { _, items in
      guard !items.isEmpty else { return }
      addPhotos(items)
      photoItems = []
    }
    .onChange(of: model.draft) { _, draft in
      if let draft {
        text = draft
        model.draft = nil
        focused = true
      }
    }
  }

  private func attachmentChip(_ a: Attachment) -> some View {
    ZStack(alignment: .topTrailing) {
      Group {
        if let image = a.preview {
          Image(uiImage: image).resizable().scaledToFill()
        } else {
          VStack(spacing: 4) {
            Image(systemName: "doc")
            Text(a.name).font(.caption2).lineLimit(2)
          }
          .padding(6)
          .foregroundStyle(.secondary)
        }
      }
      .frame(width: 64, height: 64)
      .background(.fill.tertiary)
      .clipShape(.rect(cornerRadius: 14))
      .overlay {
        if a.upload == nil && !a.failed { ProgressView() }
        if a.failed { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red) }
      }
      Button {
        attachments.removeAll { $0.id == a.id }
      } label: {
        Image(systemName: "xmark.circle.fill")
          .symbolRenderingMode(.palette)
          .foregroundStyle(.white, .black.opacity(0.6))
      }
      .offset(x: 6, y: -6)
    }
    .padding(.top, 6)
  }

  private func addPhotos(_ items: [PhotosPickerItem]) {
    for item in items {
      let a = Attachment(name: "photo.jpg")
      attachments.append(a)
      Task {
        guard let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) else {
          mark(a.id, failed: true)
          return
        }
        update(a.id) { $0.preview = image.preparingThumbnail(of: CGSize(width: 160, height: 160)) ?? image }
        // HEIC and friends become JPEG, which the agent can read.
        guard let jpeg = image.jpegData(compressionQuality: 0.85) else { return mark(a.id, failed: true) }
        await upload(a.id, data: jpeg, name: "photo-\(Int(Date().timeIntervalSince1970)).jpg", mime: "image/jpeg")
      }
    }
  }

  private func addFiles(_ urls: [URL]) {
    for url in urls {
      let a = Attachment(name: url.lastPathComponent)
      attachments.append(a)
      Task {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return mark(a.id, failed: true) }
        let mime = UTType(filenameExtension: url.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        if mime.hasPrefix("image/"), let image = UIImage(data: data) {
          update(a.id) { $0.preview = image.preparingThumbnail(of: CGSize(width: 160, height: 160)) }
        }
        await upload(a.id, data: data, name: url.lastPathComponent, mime: mime)
      }
    }
  }

  private func upload(_ id: UUID, data: Data, name: String, mime: String) async {
    do {
      let up = try await model.api.upload(data, filename: name, mime: mime)
      update(id) { $0.upload = up }
    } catch {
      mark(id, failed: true)
      self.error = error.localizedDescription
    }
  }

  private func update(_ id: UUID, _ change: (inout Attachment) -> Void) {
    guard let i = attachments.firstIndex(where: { $0.id == id }) else { return }
    change(&attachments[i])
  }

  private func mark(_ id: UUID, failed: Bool) {
    update(id) { $0.failed = failed }
  }

  private func send() {
    guard canSend else { return }
    let message = trimmed
    let uploads = attachments.compactMap { $0.upload?.id }
    sending = true
    error = nil
    Task {
      defer { sending = false }
      do {
        try await model.send(message, uploads: uploads)
        text = ""
        attachments = []
        sent += 1
      } catch {
        withAnimation { self.error = error.localizedDescription }
      }
    }
  }
}
