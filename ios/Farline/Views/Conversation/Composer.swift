// The composer card from the web: text on top, then attach, the model pill,
// dictation and send (or stop) underneath.
import AVFoundation
import PhotosUI
import Speech
import SwiftUI
import UIKit
import UniformTypeIdentifiers

struct Composer<Models: View>: View {
  let placeholder: LocalizedStringKey
  let api: APIClient
  let running: Bool
  let modelLabel: String
  let effortLabel: LocalizedStringKey?
  @Binding var mode: PermissionMode
  @Binding var draft: String?
  let onSend: (String, [String]) async throws -> Void
  let onStop: () async -> Void
  @ViewBuilder let modelSheet: () -> Models

  @State private var text = ""
  @State private var attachments: [Attachment] = []
  @State private var photoItems: [PhotosPickerItem] = []
  @State private var showPhotos = false
  @State private var showFiles = false
  @State private var showModels = ProcessInfo.processInfo.environment["FARLINE_SHEET"] == "models"
  @State private var sending = false
  @State private var sent = 0
  @State private var error: String?
  @State private var dictation = Dictation()
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
  private var canSend: Bool { (!trimmed.isEmpty || attachments.contains { $0.upload != nil }) && !uploading && !sending }

  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      if let error = error ?? dictation.error {
        Text(error)
          .font(.ui(13.5))
          .foregroundStyle(Color.fRed)
          .padding(.horizontal, 11)
          .padding(.bottom, 8)
          .onTapGesture {
            self.error = nil
            dictation.error = nil
          }
      }
      if !attachments.isEmpty {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: 8) {
            ForEach(attachments) { a in
              attachmentChip(a)
            }
          }
          .padding(.horizontal, 4)
          .padding(.bottom, 10)
        }
      }
      TextField("", text: $text, prompt: Text(placeholder).foregroundStyle(Color.text3), axis: .vertical)
        .font(.ui(16.5))
        .foregroundStyle(Color.text1)
        .lineLimit(1...10)
        .focused($focused)
        .padding(.horizontal, 11)
        .padding(.top, 2)
        .padding(.bottom, 12)

      HStack(spacing: 9) {
        // Attachments and permissions, as the web's context sheet.
        Menu {
          Button("Photos", systemImage: "photo.on.rectangle") { showPhotos = true }
          Button("Files", systemImage: "folder") { showFiles = true }
          Picker(selection: $mode) {
            ForEach(PermissionMode.allCases) { m in
              Label(m.title, systemImage: m.symbol).tag(m)
            }
          } label: {
            Label("Permissions", systemImage: mode.symbol)
          }
          .pickerStyle(.menu)
        } label: {
          round("plus", size: 36, font: .ui(19, .light))
        }
        .accessibilityLabel(Text("Add"))

        Button {
          showModels = true
        } label: {
          HStack(spacing: 5) {
            Text(verbatim: modelLabel)
              .foregroundStyle(Color.text1)
              .lineLimit(1)
            if let effortLabel {
              Text(effortLabel)
                .foregroundStyle(Color(light: 0x686866, dark: 0xA6A39B))
                .fixedSize()
            }
          }
          .font(.ui(14.5))
          .padding(.horizontal, 14)
          .frame(height: 36)
          .background(Color.fillGray, in: .capsule)
        }
        .buttonStyle(PressStyle())
        .sheet(isPresented: $showModels, content: modelSheet)

        Spacer(minLength: 0)

        Button {
          if dictation.on { dictation.stop() } else { dictation.start(after: text) }
        } label: {
          Image(systemName: "mic")
            .font(.ui(17))
            .foregroundStyle(dictation.on ? Color.white : Color.text1)
            .frame(width: 36, height: 36)
            .background(dictation.on ? Color.claude : Color.fillGray, in: .circle)
            .symbolEffect(.pulse, options: .repeat(.continuous), isActive: dictation.on)
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(Text("Dictate"))

        if running && trimmed.isEmpty && attachments.isEmpty {
          Button {
            Task { await onStop() }
          } label: {
            Image(systemName: "square.fill")
              .font(.ui(13))
              .foregroundStyle(Color.onInk)
              .frame(width: 38, height: 38)
              .background(Color.ink, in: .circle)
          }
          .buttonStyle(PressStyle())
          .accessibilityLabel(Text("Stop"))
          .transition(.scale.combined(with: .opacity))
        } else {
          Button(action: send) {
            Group {
              if sending {
                ProgressView().tint(.white)
              } else {
                Image(systemName: "arrow.up").font(.ui(17, .semibold))
              }
            }
            .foregroundStyle(.white)
            .frame(width: 38, height: 38)
            .background(canSend ? Color.fOrange : Color.sendOff, in: .circle)
          }
          .buttonStyle(PressStyle())
          .disabled(!canSend)
          .accessibilityLabel(Text("Send"))
          .transition(.scale.combined(with: .opacity))
        }
      }
      .animation(.smooth(duration: 0.2), value: running && trimmed.isEmpty)
    }
    .padding(.top, 12)
    .padding(.horizontal, 9)
    .padding(.bottom, 8)
    .background(Color.composer, in: .rect(cornerRadius: 30))
    .overlay(RoundedRectangle(cornerRadius: 30).strokeBorder(Color.text1.opacity(0.07), lineWidth: 0.5))
    .shadow(color: .black.opacity(0.06), radius: 11, y: 6)
    .padding(.horizontal, 15)
    .frame(maxWidth: 760)
    .sensoryFeedback(.impact(weight: .light), trigger: sent)
    .sensoryFeedback(.start, trigger: dictation.on) { _, on in on }
    .photosPicker(isPresented: $showPhotos, selection: $photoItems, maxSelectionCount: 6, matching: .images)
    .fileImporter(isPresented: $showFiles, allowedContentTypes: [.item], allowsMultipleSelection: true) { result in
      if case .success(let urls) = result { addFiles(urls) }
    }
    .onChange(of: photoItems) { _, items in
      guard !items.isEmpty else { return }
      addPhotos(items)
      photoItems = []
    }
    .onChange(of: dictation.text) { _, heard in
      if let heard { text = heard }
    }
    .onChange(of: draft) { _, draft in
      if let draft {
        text = draft
        self.draft = nil
        focused = true
      }
    }
    .onDisappear { dictation.stop() }
  }

  private func round(_ symbol: String, size: CGFloat, font: Font) -> some View {
    Image(systemName: symbol)
      .font(font)
      .foregroundStyle(Color.text1)
      .frame(width: size, height: size)
      .background(Color.fillGray, in: .circle)
  }

  private func attachmentChip(_ a: Attachment) -> some View {
    ZStack(alignment: .topTrailing) {
      Group {
        if let image = a.preview {
          Image(uiImage: image).resizable().scaledToFill()
        } else {
          VStack(spacing: 4) {
            Image(systemName: "doc.text")
            Text(verbatim: a.name).font(.ui(11)).lineLimit(2)
          }
          .padding(6)
          .foregroundStyle(Color.text2)
        }
      }
      .frame(width: 64, height: 64)
      .background(Color.fillGray)
      .clipShape(.rect(cornerRadius: 14))
      .overlay {
        if a.upload == nil && !a.failed { ProgressView() }
        if a.failed { Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Color.fRed) }
      }
      Button {
        attachments.removeAll { $0.id == a.id }
      } label: {
        Image(systemName: "xmark")
          .font(.ui(10, .bold))
          .foregroundStyle(.white)
          .frame(width: 20, height: 20)
          .background(Color.black.opacity(0.6), in: .circle)
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
      let up = try await api.upload(data, filename: name, mime: mime)
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
    dictation.stop()
    let message = trimmed
    let uploads = attachments.compactMap { $0.upload?.id }
    sending = true
    error = nil
    Task {
      defer { sending = false }
      do {
        try await onSend(message, uploads)
        text = ""
        attachments = []
        sent += 1
      } catch {
        withAnimation { self.error = error.localizedDescription }
      }
    }
  }
}

extension PermissionMode {
  var title: LocalizedStringKey {
    switch self {
    case .default: "Ask every time"
    case .auto: "Auto"
    case .acceptEdits: "Accept edits"
    case .plan: "Plan only"
    case .bypassPermissions: "Allow everything"
    }
  }

  var symbol: String {
    switch self {
    case .default: "hand.raised"
    case .auto: "sparkles"
    case .acceptEdits: "pencil.and.list.clipboard"
    case .plan: "map"
    case .bypassPermissions: "exclamationmark.shield"
    }
  }
}

extension EffortLevel {
  var title: LocalizedStringKey {
    switch self {
    case .low: "Low"
    case .medium: "Medium"
    case .high: "High"
    case .xhigh: "Extra high"
    case .max: "Max"
    }
  }
}

// Speech to text into the composer, with the system recognizer.
@MainActor
@Observable
final class Dictation {
  private(set) var on = false
  // The composer's text with what was heard so far.
  private(set) var text: String?
  var error: String?

  private var base = ""
  private var engine: AVAudioEngine?
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?

  func start(after current: String) {
    guard !on else { return }
    on = true
    error = nil
    text = nil
    base = current
    Task {
      guard await Self.authorize() else {
        error = String(localized: "Dictation needs microphone and speech recognition access in Settings.")
        on = false
        return
      }
      guard on else { return }
      do {
        try begin()
      } catch {
        self.error = error.localizedDescription
        stop()
      }
    }
  }

  func stop() {
    guard on || engine != nil else { return }
    on = false
    engine?.stop()
    engine?.inputNode.removeTap(onBus: 0)
    request?.endAudio()
    task?.finish()
    engine = nil
    request = nil
    task = nil
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func begin() throws {
    guard let recognizer = SFSpeechRecognizer(locale: Locale.current) ?? SFSpeechRecognizer(), recognizer.isAvailable else {
      throw DictationError.unavailable
    }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.record, mode: .measurement, options: .duckOthers)
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    let request = SFSpeechAudioBufferRecognitionRequest()
    request.shouldReportPartialResults = true
    request.addsPunctuation = true
    let engine = AVAudioEngine()
    let input = engine.inputNode
    input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0), block: Self.feed(RequestBox(request: request)))
    engine.prepare()
    try engine.start()

    task = recognizer.recognitionTask(with: request, resultHandler: Self.results { heard, final, failed in
      Task { @MainActor in self.heard(heard, final: final, failed: failed) }
    })
    self.engine = engine
    self.request = request
  }

  private func heard(_ heard: String?, final: Bool, failed: Bool) {
    guard on else { return }
    if let heard { text = base + heard }
    if final || failed { stop() }
  }

  enum DictationError: LocalizedError {
    case unavailable
    var errorDescription: String? { String(localized: "Dictation isn't available right now.") }
  }

  // The recognizer and the audio tap call back off the main thread, so their
  // closures are made outside the main actor.
  nonisolated private static func feed(_ box: RequestBox) -> @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void {
    { buffer, _ in box.request.append(buffer) }
  }

  nonisolated private static func results(_ deliver: @escaping @Sendable (String?, Bool, Bool) -> Void) -> @Sendable (SFSpeechRecognitionResult?, (any Error)?) -> Void {
    { result, error in
      deliver(result?.bestTranscription.formattedString, result?.isFinal ?? false, error != nil)
    }
  }

  nonisolated private static func authorize() async -> Bool {
    let speech = await withCheckedContinuation { (c: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
      SFSpeechRecognizer.requestAuthorization { c.resume(returning: $0) }
    }
    guard speech == .authorized else { return false }
    return await AVAudioApplication.requestRecordPermission()
  }
}

// Once recording starts, the request is only appended to from the audio thread.
private final class RequestBox: @unchecked Sendable {
  let request: SFSpeechAudioBufferRecognitionRequest
  init(request: SFSpeechAudioBufferRecognitionRequest) { self.request = request }
}
