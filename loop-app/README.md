# Loop

Detects when you're stuck scrolling and interrupts you.

On iOS it uses Apple's DeviceActivity API to watch for repeated opens of the same app. On Android it polls UsageStats every 15 minutes via WorkManager. When the score crosses a threshold it fires a notification; tapping it opens a redirect screen with something better to do.

---

## Before you build

**iOS requires a restricted entitlement.** The `com.apple.developer.family-controls` entitlement is not available by default — Apple has to approve it for your App ID. Without it, the Screen Time authorization dialog never appears and app monitoring silently does nothing. Request access at developer.apple.com before spending time on a build.

The notification-based nudges and the rest of the app work fine without it. Only the automatic "you've been scrolling for 5 minutes" detection is blocked.

---

## Setup

```bash
npm install
npx expo prebuild --clean
cd ios && pod install && cd ..
open ios/Loop.xcworkspace
```

Build to a physical device. FamilyControls doesn't work in the simulator.

For everything that needs a native rebuild (changes to `modules/loop-native` or `plugins/`), run `prebuild --clean` again. For JS-only changes you can use the dev server normally.

See `modules/loop-native/README-native.md` for Xcode capability setup, the Android usage access flow, and the architecture diagram.

---

## Structure

```
app/               screens (Expo Router)
  onboarding/      three-step first-run flow
  index.tsx        home
  redirect.tsx     break-the-loop screen
  settings.tsx     manage apps + hours
  debug.tsx        score breakdown (5-tap on home title)
lib/               shared logic
  content.ts       pick redirect content (weighted, deduped)
  notifications.ts schedule nudges
  storage.ts       AsyncStorage wrappers
  useLoopNative.ts JS wrappers around the native module
modules/loop-native/
  ios/             Swift — FamilyControls, DeviceActivity, score sync
  android/         Kotlin — UsageStats, WorkManager, Loop Score
plugins/           withLoopNative.js — generates the Xcode extension target
data/content.json  149 redirect items
```

---

## Builds

```bash
# internal test build
eas build --profile preview --platform ios

# both platforms
eas build --profile preview --platform all
```

You'll need to fill in `owner` and `extra.eas.projectId` in `app.json` after running `eas init`.
