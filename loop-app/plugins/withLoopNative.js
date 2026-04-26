/**
 * Config plugin for loop-native.
 *
 * iOS:  Adds FamilyControls + App Group entitlements to the main app.
 *       Copies the LoopActivityMonitor extension files into ios/.
 *       NOTE: You still need to manually add the LoopActivityMonitor target in
 *       Xcode (see README-native.md). Automate this once the spike validates.
 *
 * Android: Adds PACKAGE_USAGE_STATS permission to the manifest.
 */

const {
  withEntitlementsPlist,
  withAndroidManifest,
  withDangerousMod,
} = require('@expo/config-plugins');
const path = require('path');
const fs   = require('fs');

const APP_GROUP      = 'group.com.noalani.loop';
const EXTENSION_NAME = 'LoopActivityMonitor';

// ─── iOS entitlements ─────────────────────────────────────────────────────────

function withFamilyControlsEntitlements(config) {
  return withEntitlementsPlist(config, (c) => {
    c.modResults['com.apple.developer.family-controls'] = true;
    c.modResults['com.apple.security.application-groups'] = [APP_GROUP];
    return c;
  });
}

// ─── Copy DeviceActivity extension files into ios/ ───────────────────────────

function withDeviceActivityExtensionFiles(config) {
  return withDangerousMod(config, [
    'ios',
    (c) => {
      const iosRoot    = c.modRequest.platformProjectRoot;              // ios/
      const srcDir     = path.join(                                     // modules/.../ios/LoopActivityMonitor/
        c.modRequest.projectRoot,
        'modules/loop-native/ios/LoopActivityMonitor',
      );
      const destDir    = path.join(iosRoot, EXTENSION_NAME);

      if (!fs.existsSync(srcDir)) return c; // module not installed yet

      fs.mkdirSync(destDir, { recursive: true });

      for (const file of fs.readdirSync(srcDir)) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      }

      console.log(
        `\n[loop-native] ✓ Copied ${EXTENSION_NAME} extension files to ios/${EXTENSION_NAME}/` +
        '\n              ⚠ Add the LoopActivityMonitor target manually in Xcode.' +
        '\n                See modules/loop-native/README-native.md for steps.\n',
      );

      return c;
    },
  ]);
}

// ─── Android PACKAGE_USAGE_STATS ─────────────────────────────────────────────

function withUsageStatsPermission(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;

    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }

    const perms = manifest['uses-permission'] ?? [];
    const name  = 'android.permission.PACKAGE_USAGE_STATS';
    if (!perms.some((p) => p.$['android:name'] === name)) {
      perms.push({ $: { 'android:name': name, 'tools:ignore': 'ProtectedPermissions' } });
      manifest['uses-permission'] = perms;
    }
    return c;
  });
}

// ─── Compose ─────────────────────────────────────────────────────────────────

module.exports = (config) => {
  config = withFamilyControlsEntitlements(config);
  config = withDeviceActivityExtensionFiles(config);
  config = withUsageStatsPermission(config);
  return config;
};
