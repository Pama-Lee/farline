# Farline for iOS

A native SwiftUI client for a Farline server, built for iOS 26 and Liquid Glass. It talks to the same HTTP API and event stream as the web app, so the server needs no changes.

## What's in it

- Connect to a server, first-run setup with the setup code, password sign-in
- Session list with live status, search, swipe to hide; split view on iPad
- Conversation drawn natively: Markdown replies, folded tool steps with a detail sheet, thinking, background task notices
- Permission requests and agent questions answered inline, with haptics
- A floating glass composer: photos and files, send, stop
- Model, effort and permission mode from the toolbar; rename, share link
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
- `Farline/Views`: connect, sessions, conversation, composer
- `FarlineTests`: decoding, patches, steps, Markdown, SSE
