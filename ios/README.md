# Farline for iOS

A native SwiftUI client for a Farline server, built for iOS 26. It looks like the web app with the Claude skin (the palette, layout and type sizes in `web/src/styles.css`), but navigation, sheets, menus, search, context menus, dictation and haptics are the system's own, with Liquid Glass where iOS puts it. It talks to the same HTTP API and event stream as the web app, so the server needs no changes.

## What's in it

- Connect to a server, first-run setup with the setup code, password sign-in
- Home: the device, sessions with live status, search, folder filter, history, swipe to hide
- New session: pick a folder on the device, then the first message starts it
- Conversation: Markdown replies with highlighted code, tool steps folded into one line with a timeline sheet, thinking, background task notices
- Permission requests pinned above the composer, agent questions inline, with haptics
- The composer card: photos, files and permissions, the model sheet (agent, provider, model, effort), dictation, send, stop
- Copy, read aloud, react and edit under the last reply; rename, copy ID, share link, hide
- Rewind to before a message (conversation, code, or both) and edit the last reply
- English and Simplified Chinese

Plugins, skins and agent setup stay in the web app.

## Build

You need a Mac with Xcode 26 and [XcodeGen](https://github.com/yonaskolb/XcodeGen).

```sh
brew install xcodegen
cd ios
xcodegen generate
open Farline.xcodeproj
```

Pick your team under Signing & Capabilities, then run on a simulator or your phone. With a free Apple account the app has to be reinstalled every 7 days; TestFlight needs a paid developer account.

Run the tests with ⌘U, or:

```sh
xcodebuild test -project Farline.xcodeproj -scheme Farline -destination 'platform=iOS Simulator,name=iPhone 17'
```

## Connecting

Enter the address the server prints, for example `192.168.1.10:3077` on your network or `https://farline.example.com` behind HTTPS. Plain http is allowed because Farline is self-hosted; outside your own network use HTTPS, as with the web app.

## Layout

- `Farline/Model`: wire types (mirroring `shared/types.ts`), the session model (snapshot plus SSE patches), Markdown blocks
- `Farline/Net`: the API client and the event stream parser
- `Farline/Views`: connect, home and its sheets, conversation, composer; `Common/Theme.swift` has the web palette
- `FarlineTests`: decoding, patches, steps, Markdown, SSE
