# loop-native — native setup guide

`expo prebuild` has already done most of the work. Here's exactly what's done
and what's left.

---

## What's already set up (no action needed)

- `LoopActivityMonitor` extension target exists in the Xcode project
- Extension is embedded in the main Loop app ("Embed Foundation Extensions" phase)
- Bundle IDs are set: `com.noalani.loop` (main) and `com.noalani.loop.LoopActivityMonitor` (extension)
- Entitlements files are in place with `com.apple.developer.family-controls` and App Group `group.com.noalani.loop`
- Our `LoopActivityMonitor.swift` is already in `ios/LoopActivityMonitor/`

---

## Step 1 — Install CocoaPods and run pod install

```bash
brew install cocoapods      # if you just installed Homebrew
cd ios && pod install && cd ..
```

---

## Step 2 — Open the workspace in Xcode

Always open the `.xcworkspace`, not the `.xcodeproj`:

```bash
open ios/Loop.xcworkspace
```

---

## Step 3 — Delete the auto-generated stub file

Xcode created a placeholder file you don't need:

1. In the left panel, expand **LoopActivityMonitor** group
2. Find `DeviceActivityMonitorExtension.swift`
3. Right-click → **Delete** → **Move to Trash**

Your `LoopActivityMonitor.swift` (already in the group) is the real implementation.

---

## Step 4 — Add capabilities in Xcode

You need to tell Xcode about the entitlements for **both** targets.

**Loop target (main app):**
1. Click the **Loop** project in the left panel → select the **Loop** target (not LoopActivityMonitor)
2. Go to **Signing & Capabilities** tab
3. Click **+ Capability** → add **Family Controls**
4. Click **+ Capability** → add **App Groups** → add `group.com.noalani.loop`

**LoopActivityMonitor target:**
1. Select the **LoopActivityMonitor** target (same top-left project panel, different target)
2. **Signing & Capabilities** tab
3. Click **+ Capability** → add **Family Controls**
4. Click **+ Capability** → add **App Groups** → add `group.com.noalani.loop`

> Both targets already have the entitlements *files* — this step registers those
> capabilities with your provisioning profile so signing works.

---

## Step 5 — Apple Developer Portal

The `com.apple.developer.family-controls` entitlement requires explicit enablement
in the portal before it appears in provisioning profiles.

1. Go to [developer.apple.com](https://developer.apple.com) → **Certificates, IDs & Profiles**
2. Select App ID **com.noalani.loop** → edit → enable **Family Controls** → Save
3. Create a new App ID **com.noalani.loop.LoopActivityMonitor** → enable **Family Controls** and **App Groups** (same group)
4. Regenerate your development provisioning profiles for both App IDs
5. In Xcode → Signing, select your team — Xcode will pull the updated profiles automatically if "Manage signing automatically" is on

---

## Step 6 — Build to a physical device

FamilyControls does **not** work in the Simulator. You need a real iPhone.

```bash
npx expo run:ios --device
```

Or press **Run** (▶) in Xcode with your device selected.

---

## Architecture recap

```
iOS                                     Android
────────────────────────────────────    ────────────────────────────────────
DeviceActivity extension                WorkManager (15-min periodic task)
  eventDidReachThreshold()                doWork() detects repeated opens
    → writes App Group flag                 → writes SharedPrefs flag
    → fires local notification              → fires local notification

App comes to foreground                 App comes to foreground
  checkPendingLoopAlert()                 checkPendingLoopAlert()
    → reads App Group flag                  → reads SharedPrefs flag
    → emits onLoopDetected                  → emits onLoopDetected

_layout.tsx (both platforms)
  useLoopForegroundCheck()
    → router.push('/redirect')
```

---

## Android — Usage Access

```bash
npx expo run:android
```

On device: **Settings → Apps → Special App Access → Usage Access → Loop → Allow**

The app calls `requestUsageAccessPermission()` which opens that settings page directly.
