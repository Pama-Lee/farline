import Foundation
import Testing
@testable import Farline

struct WireTests {
  @Test func decodesSnapshot() throws {
    let json = """
    {"state":{"id":"s1","title":"Fix","cwd":"/home/me/app","status":"running","provider":"claude","model":"default","permissionMode":"auto","effort":"xhigh","classifierModel":null,"live":true,"tasks":[]},
     "items":[
      {"kind":"user","id":"u1","text":"hi","images":[{"url":"/api/x"}]},
      {"kind":"thinking","id":"t1","text":"hmm","streaming":true},
      {"kind":"tool","id":"b1","name":"Bash","input":{"command":"ls -la","timeout":5,"flags":[true,null]},"status":"running","permission":{"reqId":"r1","canAlways":true,"status":"pending"}},
      {"kind":"text","id":"m1:0","text":"**done**","edited":true},
      {"kind":"ask","id":"a1","reqId":"q1","questions":[{"question":"Which?","options":[{"label":"A"},{"label":"B","description":"b"}]}],"status":"pending"},
      {"kind":"notice","id":"n1","level":"info","text":"x","code":"interrupted"},
      {"kind":"task","id":"k1","taskId":"tk","summary":"done","status":"completed"},
      {"kind":"brand-new","id":"z1"}
     ],
     "seq":7,"hasEarlier":false}
    """
    let snap = try JSONDecoder().decode(SessionSnapshot.self, from: Data(json.utf8))
    #expect(snap.state.status == .running)
    #expect(snap.state.permissionMode == .auto)
    #expect(snap.items.count == 8)
    guard case .tool(let tool) = snap.items[2] else { Issue.record("not a tool"); return }
    #expect(tool.arg("command") == "ls -la")
    #expect(tool.permission?.pending == true)
    guard case .unknown(let id) = snap.items[7] else { Issue.record("not unknown"); return }
    #expect(id == "z1")
  }

  @Test func unknownStatusFallsBackToIdle() throws {
    let s = try JSONDecoder().decode(SessionStatus.self, from: Data(#""paused""#.utf8))
    #expect(s == .idle)
  }
}

struct BlockTests {
  private func items(_ json: String) throws -> [Item] {
    try JSONDecoder().decode([Item].self, from: Data(json.utf8))
  }

  @Test func foldsStepsAndMarksLastReply() throws {
    let list = try items("""
    [{"kind":"user","id":"u1","text":"go"},
     {"kind":"tool","id":"t1","name":"Read","input":{"file_path":"/a/b.swift"},"status":"done"},
     {"kind":"tool","id":"t2","name":"Bash","input":{"command":"make"},"status":"done"},
     {"kind":"thinking","id":"th","text":"  "},
     {"kind":"text","id":"x1","text":"first"},
     {"kind":"text","id":"x2","text":"second"},
     {"kind":"notice","id":"n1","level":"info","text":"note"}]
    """)
    let blocks = Block.build(list)
    #expect(blocks.count == 5)
    guard case .steps(_, let steps) = blocks[1] else { Issue.record("no steps"); return }
    #expect(steps.count == 2)
    #expect(StepText.detail(steps[0]) == "b.swift")
    guard case .text(_, let firstLast) = blocks[2], case .text(_, let secondLast) = blocks[3] else { Issue.record("no text"); return }
    #expect(!firstLast)
    #expect(secondLast)
  }

  @Test func patchesRemoveThenUpsert() throws {
    var list = try items(#"[{"kind":"text","id":"a","text":"1"},{"kind":"text","id":"b","text":"2"}]"#)
    let patch = try JSONDecoder().decode(Patch.self, from: Data(#"{"seq":2,"removes":["a"],"upserts":[{"kind":"text","id":"b","text":"22"},{"kind":"text","id":"c","text":"3"}]}"#.utf8))
    list.apply(patch)
    #expect(list.map(\.id) == ["b", "c"])
    guard case .text(let b) = list[0] else { Issue.record("not text"); return }
    #expect(b.text == "22")
  }

  @Test func mcpToolNames() {
    #expect(StepText.toolName("mcp__github__create_issue") == "github · create_issue")
    #expect(StepText.toolName("Bash") == "Bash")
  }

  @Test func parsesAnswers() {
    #expect(Answers.parse(#"User answered: "Which?"="A", "Why?"="B""#) == ["Which?": "A", "Why?": "B"])
    #expect(Answers.parse("Which?\nA\n\nWhy?\nB") == ["Which?": "A", "Why?": "B"])
  }
}

struct EventStreamTests {
  @Test func parsesEvents() {
    var p = EventStreamParser()
    var out: [ServerEvent] = []
    for line in ["event: patch", "data: {\"seq\":1}", "id: 1", "", ": comment", "event: ping", "data:", "", "", "data: a", "data: b", "\r"] {
      if let e = p.feed(line) { out.append(e) }
    }
    #expect(out == [
      ServerEvent(event: "patch", data: #"{"seq":1}"#, id: "1"),
      ServerEvent(event: "ping", data: "", id: nil),
      ServerEvent(event: "message", data: "a\nb", id: nil),
    ])
  }
}

struct MarkdownTests {
  @Test func findsBlocks() {
    let md = """
    # Title
    Some *text*
    still the same paragraph.

    - one
    - [x] two
      - nested
    1. first
    2) second

    ```swift
    let x = 1
    ```

    > quoted

    | a | b |
    |---|:-:|
    | 1 | 2 |

    ---
    """
    let blocks = Markdown.blocks(md)
    #expect(blocks.count == 8)
    #expect(blocks[0] == .heading(level: 1, text: "Title"))
    #expect(blocks[1] == .paragraph("Some *text*\nstill the same paragraph."))
    guard case .list(false, _, let items) = blocks[2] else { Issue.record("no list"); return }
    #expect(items.count == 3)
    #expect(items[1].checked == true)
    #expect(items[2].indent == 1)
    guard case .list(true, 1, let ordered) = blocks[3] else { Issue.record("no ordered list"); return }
    #expect(ordered.count == 2)
    #expect(blocks[4] == .code(language: "swift", text: "let x = 1"))
    #expect(blocks[5] == .quote("quoted"))
    #expect(blocks[6] == .table(header: ["a", "b"], rows: [["1", "2"]]))
    #expect(blocks[7] == .rule)
  }

  @Test func unfinishedFenceWhileStreaming() {
    let blocks = Markdown.blocks("Look:\n```\npartial")
    #expect(blocks == [.paragraph("Look:"), .code(language: "", text: "partial")])
  }

  @Test func normalizesServerAddresses() {
    #expect(AppModel.normalize("192.168.1.5:3077/")?.absoluteString == "http://192.168.1.5:3077")
    #expect(AppModel.normalize("https://farline.example.com")?.absoluteString == "https://farline.example.com")
    #expect(AppModel.normalize("  ") == nil)
  }
}
