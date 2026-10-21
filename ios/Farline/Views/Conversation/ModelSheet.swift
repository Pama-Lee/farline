// The web's model sheet: the agent, then its providers as chips, then that
// provider's models; effort, the auto-mode check and more models one level down.
import SwiftUI

enum Agent: String, CaseIterable, Identifiable {
  case claude, pi

  var id: String { rawValue }
  var name: String { self == .claude ? "Claude Code" : "pi" }

  init(provider: String) {
    self = provider.hasPrefix("pi:") ? .pi : .claude
  }
}

struct ModelSheet: View {
  let catalog: Catalog
  let provider: String
  let model: String
  let effort: EffortLevel?
  let classifierModel: String?
  // A started session keeps its agent: offer only that agent's providers.
  var lockAgent = false
  let onModel: (ModelOption) -> Void
  let onEffort: (EffortLevel) -> Void
  let onClassifier: (String) -> Void

  @Environment(\.dismiss) private var dismiss
  @State private var tab = ""

  private var all: [ProviderInfo] {
    catalog.pickable.filter { !lockAgent || Agent(provider: $0.id) == Agent(provider: provider) }
  }
  private var agents: [Agent] { Agent.allCases.filter { a in all.contains { Agent(provider: $0.id) == a } } }
  private var shown: String { tab.isEmpty ? provider : tab }
  private var available: [ProviderInfo] { all.filter { Agent(provider: $0.id) == Agent(provider: shown) } }
  private var current: ModelOption? { catalog.current(provider: provider, model: model) }
  // Models the current provider's auto-mode check may run on.
  private var classifiers: [ModelOption] {
    (catalog.providers.first { $0.id == provider }?.classifierModels ?? []).compactMap { v in
      catalog.models.first { $0.provider == provider && $0.value == v }
    }
  }

  private var inTab: [ModelOption] { catalog.models(for: shown) }
  private var main: [ModelOption] { inTab.filter { $0.more != true } }
  private var more: [ModelOption] { inTab.filter { $0.more == true } }

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 0) {
          if agents.count > 1 { agentPicker }
          if available.count > 1 { chips }
          if !main.isEmpty {
            OptionGroup(main) { m in row(m) }
          }
          VStack(spacing: 16) {
            effortLink
            classifierLink
            moreLink
          }
          .buttonStyle(PressStyle())
          .padding(.top, main.isEmpty ? 0 : 14)
        }
        .padding(.horizontal, 16)
        .padding(.top, 4)
        .padding(.bottom, 20)
      }
      .background(Color.bg)
      .sensoryFeedback(.selection, trigger: tab)
      .navigationTitle("Choose model")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .topBarLeading) {
          Button(role: .close) { dismiss() }
        }
      }
    }
    .presentationDetents([.medium, .large])
    .farlineSheet()
  }

  private var agentPicker: some View {
    Picker(selection: Binding(get: { Agent(provider: shown) }, set: { pickAgent($0) })) {
      ForEach(agents) { a in
        Text(verbatim: a.name).tag(a)
      }
    } label: {
      EmptyView()
    }
    .pickerStyle(.segmented)
    .padding(.bottom, 14)
  }

  private var chips: some View {
    WrapLayout(spacing: 8) {
      ForEach(available) { p in
        chip(p)
      }
    }
    .padding(.bottom, 12)
  }

  @ViewBuilder
  private var effortLink: some View {
    if shown == provider, let effort, let efforts = current?.efforts, !efforts.isEmpty {
      NavigationLink {
        ChoiceList(title: "Effort", options: efforts, selected: effort, label: { (e: EffortLevel) in Text(e.title) }, onPick: onEffort)
      } label: {
        ValueRow(title: "Effort", value: Text(effort.title))
      }
    }
  }

  @ViewBuilder
  private var classifierLink: some View {
    if shown == provider, classifiers.count > 1 {
      let labels = Dictionary(classifiers.map { ($0.value, $0.label) }, uniquingKeysWith: { a, _ in a })
      NavigationLink {
        ChoiceList(title: "Auto mode check", options: classifiers.map(\.value), selected: classifierModel, label: { (v: String) in Text(verbatim: labels[v] ?? v) }, onPick: onClassifier)
      } label: {
        ValueRow(title: "Auto mode check", value: Text(verbatim: classifierModel.flatMap { labels[$0] } ?? ""))
      }
    }
  }

  @ViewBuilder
  private var moreLink: some View {
    if !more.isEmpty {
      let chosen = current.flatMap { $0.more == true && $0.provider == shown ? $0.label : nil }
      NavigationLink {
        ScrollView {
          OptionGroup(more) { m in row(m) }
            .padding(16)
        }
        .background(Color.bg)
        .navigationTitle("More models")
        .navigationBarTitleDisplayMode(.inline)
      } label: {
        ValueRow(title: "More models", value: Text(verbatim: chosen ?? ""))
      }
    }
  }

  private func pickAgent(_ a: Agent) {
    guard a != Agent(provider: shown) else { return }
    tab = Agent(provider: provider) == a ? provider : all.first { Agent(provider: $0.id) == a }?.id ?? shown
  }

  private func chip(_ p: ProviderInfo) -> some View {
    let on = p.id == shown
    return Button {
      tab = p.id
    } label: {
      // "pi · OpenRouter" reads "OpenRouter" once the agent is chosen.
      Text(verbatim: p.label.hasPrefix("pi · ") ? String(p.label.dropFirst(5)) : p.label)
        .font(.ui(14))
        .foregroundStyle(on ? Color.bg : Color.text2)
        .lineLimit(1)
        .padding(.horizontal, 14)
        .frame(height: 34)
        .background(on ? Color.ink : Color.fillGray, in: .capsule)
    }
    .buttonStyle(PressStyle())
  }

  private func row(_ m: ModelOption) -> some View {
    Button {
      onModel(m)
      dismiss()
    } label: {
      HStack(spacing: 12) {
        VStack(alignment: .leading, spacing: 1) {
          Text(verbatim: m.label)
            .font(.ui(15.5))
            .foregroundStyle(Color.text1)
          if let desc = m.desc {
            Text(verbatim: desc)
              .font(.ui(12))
              .foregroundStyle(Color.text2)
              .lineSpacing(2)
          }
        }
        Spacer(minLength: 0)
        if m.isCurrent(provider: provider, model: model) {
          Image(systemName: "checkmark")
            .font(.ui(17, .semibold))
            .foregroundStyle(Color.fBlue)
        }
      }
      .padding(.horizontal, 15)
      .padding(.vertical, 10)
      .frame(minHeight: m.desc == nil ? 48 : 63)
      .contentShape(.rect)
    }
    .buttonStyle(RowPressStyle())
  }
}

// The web's .group: white, rounded, hairlines between rows.
private struct OptionGroup<Row: View>: View {
  let items: [ModelOption]
  @ViewBuilder let row: (ModelOption) -> Row

  init(_ items: [ModelOption], @ViewBuilder row: @escaping (ModelOption) -> Row) {
    self.items = items
    self.row = row
  }

  var body: some View {
    VStack(spacing: 0) {
      ForEach(Array(items.enumerated()), id: \.element.id) { i, m in
        if i > 0 {
          Color.line.frame(height: 1).padding(.horizontal, 15)
        }
        row(m)
      }
    }
    .background(Color.surface, in: .rect(cornerRadius: 24))
    .clipShape(.rect(cornerRadius: 24))
  }
}

// A pushed list with a check on the chosen one; picking goes back.
private struct ChoiceList<Value: Hashable>: View {
  let title: LocalizedStringKey
  let options: [Value]
  let selected: Value?
  let label: (Value) -> Text
  let onPick: (Value) -> Void

  @Environment(\.dismiss) private var dismiss

  var body: some View {
    ScrollView {
      VStack(spacing: 0) {
        ForEach(Array(options.enumerated()), id: \.element) { i, v in
          if i > 0 {
            Color.line.frame(height: 1).padding(.horizontal, 15)
          }
          Button {
            onPick(v)
            dismiss()
          } label: {
            HStack {
              label(v)
                .font(.ui(15.5))
                .foregroundStyle(Color.text1)
              Spacer(minLength: 0)
              if v == selected {
                Image(systemName: "checkmark")
                  .font(.ui(17, .semibold))
                  .foregroundStyle(Color.fBlue)
              }
            }
            .padding(.horizontal, 15)
            .frame(minHeight: 48)
            .contentShape(.rect)
          }
          .buttonStyle(RowPressStyle())
        }
      }
      .background(Color.surface, in: .rect(cornerRadius: 24))
      .clipShape(.rect(cornerRadius: 24))
      .padding(16)
    }
    .background(Color.bg)
    .navigationTitle(title)
    .navigationBarTitleDisplayMode(.inline)
  }
}

// The web's .row-btn: a white pill with the value and a chevron.
private struct ValueRow: View {
  let title: LocalizedStringKey
  let value: Text

  var body: some View {
    HStack(spacing: 12) {
      Text(title)
        .foregroundStyle(Color.text1)
        .lineLimit(1)
      Spacer(minLength: 8)
      value
        .foregroundStyle(Color.text2)
        .lineLimit(1)
      Image(systemName: "chevron.right")
        .font(.ui(15, .medium))
        .foregroundStyle(Color.text2)
    }
    .font(.ui(15.5))
    .padding(.horizontal, 17)
    .frame(height: 50)
    .background(Color.surface, in: .capsule)
    .contentShape(.capsule)
  }
}

// Rows darken a touch when pressed, like the web's .option:active.
private struct RowPressStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .background(Color.text1.opacity(configuration.isPressed ? 0.04 : 0))
  }
}

// Chips that wrap onto the next line, like the web's flex-wrap.
private struct WrapLayout: Layout {
  var spacing: CGFloat

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(width: proposal.width ?? .infinity, subviews)
    let width = rows.map(\.width).max() ?? 0
    let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(rows.count - 1, 0))
    return CGSize(width: proposal.width ?? width, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(width: bounds.width, subviews) {
      var x = bounds.minX
      for i in row.indices {
        let size = subviews[i].sizeThatFits(.unspecified)
        subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func arrange(width: CGFloat, _ subviews: Subviews) -> [Row] {
    var rows: [Row] = [Row()]
    for (i, view) in subviews.enumerated() {
      let size = view.sizeThatFits(.unspecified)
      if !rows[rows.count - 1].indices.isEmpty && rows[rows.count - 1].width + spacing + size.width > width {
        rows.append(Row())
      }
      var row = rows[rows.count - 1]
      row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
      row.height = max(row.height, size.height)
      row.indices.append(i)
      rows[rows.count - 1] = row
    }
    return rows
  }
}
