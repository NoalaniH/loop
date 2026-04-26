'use strict';

/**
 * Config plugin for loop-native.
 *
 * iOS:
 *   - Adds FamilyControls + App Group entitlements to the main app.
 *   - Copies LoopActivityMonitor extension files into ios/.
 *   - Creates the LoopActivityMonitor extension target in project.pbxproj
 *     automatically — no manual Xcode steps after `npx expo prebuild --clean`.
 *
 * Android:
 *   - Adds PACKAGE_USAGE_STATS permission to the manifest.
 */

const {
  withEntitlementsPlist,
  withAndroidManifest,
  withDangerousMod,
  withXcodeProject,
} = require('@expo/config-plugins');
const path = require('path');
const fs   = require('fs');

const APP_GROUP        = 'group.com.noalani.loop';
const EXTENSION_NAME   = 'LoopActivityMonitor';
const EXT_BUNDLE_ID    = 'com.noalani.loop.LoopActivityMonitor';
const EXT_PRODUCT_TYPE = 'com.apple.product-type.app-extension';

// ─── Stable UUIDs ─────────────────────────────────────────────────────────────
// Deterministic 24-char uppercase hex so repeated prebuilds are idempotent.
// Using FNV-1a 32-bit stretched to 24 hex chars across three hashed rounds.

function stableUUID(seed) {
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h  = (Math.imul(h, 0x01000193) >>> 0);
  }
  const a = h;
  const b = (Math.imul(h ^ 0xdeadbeef, 0x9e3779b9) >>> 0);
  const c = (Math.imul(h ^ 0xcafebabe, 0x517cc1b7) >>> 0);
  return [a, b, c]
    .map(n => n.toString(16).toUpperCase().padStart(8, '0'))
    .join('')
    .slice(0, 24);
}

const U = {
  TARGET:           stableUUID('LAM_TARGET'),
  APPEX_REF:        stableUUID('LAM_APPEX_REF'),
  FRAMEWORK_REF:    stableUUID('LAM_FRAMEWORK_REF'),
  FRAMEWORK_BUILD:  stableUUID('LAM_FRAMEWORK_BUILD'),
  APPEX_EMBED:      stableUUID('LAM_APPEX_EMBED'),
  SOURCES:          stableUUID('LAM_SOURCES_PHASE'),
  FRAMEWORKS:       stableUUID('LAM_FRAMEWORKS_PHASE'),
  RESOURCES:        stableUUID('LAM_RESOURCES_PHASE'),
  EMBED_PHASE:      stableUUID('LAM_EMBED_PHASE'),
  DEBUG_CONFIG:     stableUUID('LAM_DEBUG_CONFIG'),
  RELEASE_CONFIG:   stableUUID('LAM_RELEASE_CONFIG'),
  CONFIG_LIST:      stableUUID('LAM_CONFIG_LIST'),
  GROUP:            stableUUID('LAM_GROUP'),
  SWIFT_REF:        stableUUID('LAM_SWIFT_REF'),
  SWIFT_BUILD:      stableUUID('LAM_SWIFT_BUILD'),
  PLIST_REF:        stableUUID('LAM_PLIST_REF'),
  ENTITLEMENTS_REF: stableUUID('LAM_ENTITLEMENTS_REF'),
  CONTAINER_PROXY:  stableUUID('LAM_CONTAINER_PROXY'),
  TARGET_DEP:       stableUUID('LAM_TARGET_DEP'),
};

// ─── iOS entitlements (main app) ──────────────────────────────────────────────

function withFamilyControlsEntitlements(config) {
  return withEntitlementsPlist(config, (c) => {
    c.modResults['com.apple.developer.family-controls'] = true;
    c.modResults['com.apple.security.application-groups'] = [APP_GROUP];
    return c;
  });
}

// ─── Copy extension source files into ios/ ────────────────────────────────────

function withExtensionFiles(config) {
  return withDangerousMod(config, ['ios', (c) => {
    const iosRoot = c.modRequest.platformProjectRoot;
    const srcDir  = path.join(
      c.modRequest.projectRoot,
      'modules/loop-native/ios/LoopActivityMonitor',
    );
    const destDir = path.join(iosRoot, EXTENSION_NAME);

    if (!fs.existsSync(srcDir)) return c;
    fs.mkdirSync(destDir, { recursive: true });
    for (const file of fs.readdirSync(srcDir)) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
    }
    return c;
  }]);
}

// ─── Create extension Xcode target ────────────────────────────────────────────

function withExtensionTarget(config) {
  return withXcodeProject(config, (c) => {
    const xp  = c.modResults;
    const obj = xp.hash.project.objects;

    // Idempotency: skip if already present
    if (obj.PBXNativeTarget?.[U.TARGET]) return c;

    const projectInfo = xp.getFirstProject();
    const targetInfo  = xp.getFirstTarget();
    if (!projectInfo || !targetInfo) return c;

    const proj       = projectInfo.firstProject;
    const mainTarget = targetInfo.firstTarget;
    const projUUID   = projectInfo.uuid;

    // Inherit deployment target + team from main app's generated Debug config
    const cfgListUUID = mainTarget.buildConfigurationList;
    const cfgList     = (obj.XCConfigurationList ?? {})[cfgListUUID];
    const debugRef    = cfgList?.buildConfigurations?.find(
      r => (obj.XCBuildConfiguration?.[r.value])?.name === 'Debug',
    );
    const debugCfg     = debugRef ? (obj.XCBuildConfiguration ?? {})[debugRef.value] : null;
    const deployTarget = debugCfg?.buildSettings?.IPHONEOS_DEPLOYMENT_TARGET ?? '16.0';
    const devTeam      = debugCfg?.buildSettings?.DEVELOPMENT_TEAM ?? '';

    // Ensure all pbxproj section containers exist
    [
      'PBXBuildFile', 'PBXContainerItemProxy', 'PBXCopyFilesBuildPhase',
      'PBXFileReference', 'PBXFrameworksBuildPhase', 'PBXGroup',
      'PBXNativeTarget', 'PBXResourcesBuildPhase', 'PBXSourcesBuildPhase',
      'PBXTargetDependency', 'XCBuildConfiguration', 'XCConfigurationList',
    ].forEach(isa => { if (!obj[isa]) obj[isa] = {}; });

    // ── File references ───────────────────────────────────────────────────

    obj.PBXFileReference[U.APPEX_REF] = {
      isa: 'PBXFileReference',
      explicitFileType: '"wrapper.app-extension"',
      includeInIndex: 0,
      path: 'LoopActivityMonitor.appex',
      sourceTree: 'BUILT_PRODUCTS_DIR',
    };
    obj.PBXFileReference[`${U.APPEX_REF}_comment`] = 'LoopActivityMonitor.appex';

    obj.PBXFileReference[U.FRAMEWORK_REF] = {
      isa: 'PBXFileReference',
      lastKnownFileType: 'wrapper.framework',
      name: 'DeviceActivity.framework',
      path: 'System/Library/Frameworks/DeviceActivity.framework',
      sourceTree: 'SDKROOT',
    };
    obj.PBXFileReference[`${U.FRAMEWORK_REF}_comment`] = 'DeviceActivity.framework';

    obj.PBXFileReference[U.SWIFT_REF] = {
      isa: 'PBXFileReference',
      lastKnownFileType: 'sourcecode.swift',
      path: 'LoopActivityMonitor.swift',
      sourceTree: '"<group>"',
    };
    obj.PBXFileReference[`${U.SWIFT_REF}_comment`] = 'LoopActivityMonitor.swift';

    obj.PBXFileReference[U.PLIST_REF] = {
      isa: 'PBXFileReference',
      lastKnownFileType: 'text.plist.xml',
      path: 'Info.plist',
      sourceTree: '"<group>"',
    };
    obj.PBXFileReference[`${U.PLIST_REF}_comment`] = 'Info.plist';

    obj.PBXFileReference[U.ENTITLEMENTS_REF] = {
      isa: 'PBXFileReference',
      lastKnownFileType: 'text.plist.entitlements',
      path: 'LoopActivityMonitor.entitlements',
      sourceTree: '"<group>"',
    };
    obj.PBXFileReference[`${U.ENTITLEMENTS_REF}_comment`] = 'LoopActivityMonitor.entitlements';

    // ── Build files ───────────────────────────────────────────────────────

    obj.PBXBuildFile[U.SWIFT_BUILD] = {
      isa: 'PBXBuildFile',
      fileRef: U.SWIFT_REF,
      fileRef_comment: 'LoopActivityMonitor.swift',
    };
    obj.PBXBuildFile[`${U.SWIFT_BUILD}_comment`] = 'LoopActivityMonitor.swift in Sources';

    obj.PBXBuildFile[U.FRAMEWORK_BUILD] = {
      isa: 'PBXBuildFile',
      fileRef: U.FRAMEWORK_REF,
      fileRef_comment: 'DeviceActivity.framework',
    };
    obj.PBXBuildFile[`${U.FRAMEWORK_BUILD}_comment`] = 'DeviceActivity.framework in Frameworks';

    obj.PBXBuildFile[U.APPEX_EMBED] = {
      isa: 'PBXBuildFile',
      fileRef: U.APPEX_REF,
      fileRef_comment: 'LoopActivityMonitor.appex',
      settings: { ATTRIBUTES: ['RemoveHeadersOnCopy'] },
    };
    obj.PBXBuildFile[`${U.APPEX_EMBED}_comment`] =
      'LoopActivityMonitor.appex in Embed Foundation Extensions';

    // ── Source group for the extension folder ─────────────────────────────

    obj.PBXGroup[U.GROUP] = {
      isa: 'PBXGroup',
      children: [
        { value: U.SWIFT_REF,        comment: 'LoopActivityMonitor.swift' },
        { value: U.PLIST_REF,        comment: 'Info.plist' },
        { value: U.ENTITLEMENTS_REF, comment: 'LoopActivityMonitor.entitlements' },
      ],
      path: EXTENSION_NAME,
      sourceTree: '"<group>"',
    };
    obj.PBXGroup[`${U.GROUP}_comment`] = EXTENSION_NAME;

    // ── Build phases (extension target) ──────────────────────────────────

    obj.PBXSourcesBuildPhase[U.SOURCES] = {
      isa: 'PBXSourcesBuildPhase',
      buildActionMask: 2147483647,
      files: [{ value: U.SWIFT_BUILD, comment: 'LoopActivityMonitor.swift in Sources' }],
      runOnlyForDeploymentPostprocessing: 0,
    };
    obj.PBXSourcesBuildPhase[`${U.SOURCES}_comment`] = 'Sources';

    obj.PBXFrameworksBuildPhase[U.FRAMEWORKS] = {
      isa: 'PBXFrameworksBuildPhase',
      buildActionMask: 2147483647,
      files: [{ value: U.FRAMEWORK_BUILD, comment: 'DeviceActivity.framework in Frameworks' }],
      runOnlyForDeploymentPostprocessing: 0,
    };
    obj.PBXFrameworksBuildPhase[`${U.FRAMEWORKS}_comment`] = 'Frameworks';

    obj.PBXResourcesBuildPhase[U.RESOURCES] = {
      isa: 'PBXResourcesBuildPhase',
      buildActionMask: 2147483647,
      files: [],
      runOnlyForDeploymentPostprocessing: 0,
    };
    obj.PBXResourcesBuildPhase[`${U.RESOURCES}_comment`] = 'Resources';

    // ── Embed phase (added to main app target) ────────────────────────────

    obj.PBXCopyFilesBuildPhase[U.EMBED_PHASE] = {
      isa: 'PBXCopyFilesBuildPhase',
      buildActionMask: 2147483647,
      dstPath: '""',
      dstSubfolderSpec: 13,   // 13 = PlugIns / App Extensions
      files: [{
        value: U.APPEX_EMBED,
        comment: 'LoopActivityMonitor.appex in Embed Foundation Extensions',
      }],
      name: '"Embed Foundation Extensions"',
      runOnlyForDeploymentPostprocessing: 0,
    };
    obj.PBXCopyFilesBuildPhase[`${U.EMBED_PHASE}_comment`] = 'Embed Foundation Extensions';

    // ── Build configurations ──────────────────────────────────────────────

    const sharedSettings = {
      CODE_SIGN_ENTITLEMENTS: 'LoopActivityMonitor/LoopActivityMonitor.entitlements',
      CODE_SIGN_STYLE: 'Automatic',
      CURRENT_PROJECT_VERSION: 1,
      ENABLE_USER_SCRIPT_SANDBOXING: 'YES',
      GCC_C_LANGUAGE_STANDARD: 'gnu17',
      GENERATE_INFOPLIST_FILE: 'YES',
      INFOPLIST_FILE: 'LoopActivityMonitor/Info.plist',
      INFOPLIST_KEY_CFBundleDisplayName: EXTENSION_NAME,
      INFOPLIST_KEY_NSHumanReadableCopyright: '""',
      IPHONEOS_DEPLOYMENT_TARGET: deployTarget,
      LD_RUNPATH_SEARCH_PATHS: [
        '"$(inherited)"',
        '"@executable_path/Frameworks"',
        '"@executable_path/../../Frameworks"',
      ],
      MARKETING_VERSION: '1.0',
      PRODUCT_BUNDLE_IDENTIFIER: EXT_BUNDLE_ID,
      PRODUCT_NAME: '"$(TARGET_NAME)"',
      SKIP_INSTALL: 'YES',
      SWIFT_EMIT_LOC_STRINGS: 'YES',
      SWIFT_VERSION: '5.0',
      TARGETED_DEVICE_FAMILY: '"1,2"',
    };
    if (devTeam) sharedSettings.DEVELOPMENT_TEAM = devTeam;

    obj.XCBuildConfiguration[U.DEBUG_CONFIG] = {
      isa: 'XCBuildConfiguration',
      buildSettings: {
        ...sharedSettings,
        DEBUG_INFORMATION_FORMAT: 'dwarf',
        MTL_ENABLE_DEBUG_INFO: 'INCLUDE_SOURCE',
        MTL_FAST_MATH: 'YES',
        SWIFT_ACTIVE_COMPILATION_CONDITIONS: '"DEBUG $(inherited)"',
        SWIFT_OPTIMIZATION_LEVEL: '"-Onone"',
      },
      name: 'Debug',
    };
    obj.XCBuildConfiguration[`${U.DEBUG_CONFIG}_comment`] = 'Debug';

    obj.XCBuildConfiguration[U.RELEASE_CONFIG] = {
      isa: 'XCBuildConfiguration',
      buildSettings: {
        ...sharedSettings,
        COPY_PHASE_STRIP: 'NO',
        DEBUG_INFORMATION_FORMAT: '"dwarf-with-dsym"',
        MTL_FAST_MATH: 'YES',
        SWIFT_COMPILATION_MODE: 'wholemodule',
      },
      name: 'Release',
    };
    obj.XCBuildConfiguration[`${U.RELEASE_CONFIG}_comment`] = 'Release';

    obj.XCConfigurationList[U.CONFIG_LIST] = {
      isa: 'XCConfigurationList',
      buildConfigurations: [
        { value: U.DEBUG_CONFIG,   comment: 'Debug' },
        { value: U.RELEASE_CONFIG, comment: 'Release' },
      ],
      defaultConfigurationIsVisible: 0,
      defaultConfigurationName: 'Release',
    };
    obj.XCConfigurationList[`${U.CONFIG_LIST}_comment`] =
      `Build configuration list for PBXNativeTarget "${EXTENSION_NAME}"`;

    // ── Target dependency plumbing ────────────────────────────────────────

    obj.PBXContainerItemProxy[U.CONTAINER_PROXY] = {
      isa: 'PBXContainerItemProxy',
      containerPortal: projUUID,
      containerPortal_comment: 'Project object',
      proxyType: 1,
      remoteGlobalIDString: U.TARGET,
      remoteInfo: EXTENSION_NAME,
    };
    obj.PBXContainerItemProxy[`${U.CONTAINER_PROXY}_comment`] = 'PBXContainerItemProxy';

    obj.PBXTargetDependency[U.TARGET_DEP] = {
      isa: 'PBXTargetDependency',
      target: U.TARGET,
      target_comment: EXTENSION_NAME,
      targetProxy: U.CONTAINER_PROXY,
      targetProxy_comment: 'PBXContainerItemProxy',
    };
    obj.PBXTargetDependency[`${U.TARGET_DEP}_comment`] = EXTENSION_NAME;

    // ── Extension native target ───────────────────────────────────────────

    obj.PBXNativeTarget[U.TARGET] = {
      isa: 'PBXNativeTarget',
      buildConfigurationList: U.CONFIG_LIST,
      buildConfigurationList_comment:
        `Build configuration list for PBXNativeTarget "${EXTENSION_NAME}"`,
      buildPhases: [
        { value: U.SOURCES,    comment: 'Sources' },
        { value: U.FRAMEWORKS, comment: 'Frameworks' },
        { value: U.RESOURCES,  comment: 'Resources' },
      ],
      buildRules: [],
      dependencies: [],
      name: EXTENSION_NAME,
      packageProductDependencies: [],
      productName: EXTENSION_NAME,
      productReference: U.APPEX_REF,
      productReference_comment: 'LoopActivityMonitor.appex',
      productType: `"${EXT_PRODUCT_TYPE}"`,
    };
    obj.PBXNativeTarget[`${U.TARGET}_comment`] = EXTENSION_NAME;

    // ── Wire everything into the project + main app target ────────────────

    // Add extension target to project's targets list
    if (!proj.targets.some(t => t.value === U.TARGET)) {
      proj.targets.push({ value: U.TARGET, comment: EXTENSION_NAME });
    }

    // Add extension group to root main group (before Products)
    const mainGroupUUID = proj.mainGroup;
    const mainGroup     = obj.PBXGroup?.[mainGroupUUID];
    if (mainGroup && !mainGroup.children.some(ch => ch.value === U.GROUP)) {
      const prodIdx = mainGroup.children.findIndex(
        ch => obj.PBXGroup?.[`${ch.value}_comment`] === 'Products',
      );
      const at = prodIdx >= 0 ? prodIdx : mainGroup.children.length;
      mainGroup.children.splice(at, 0, { value: U.GROUP, comment: EXTENSION_NAME });
    }

    // Add .appex product to Products group
    const productsGroup = xp.pbxGroupByName('Products');
    if (productsGroup && !productsGroup.children.some(ch => ch.value === U.APPEX_REF)) {
      productsGroup.children.push({ value: U.APPEX_REF, comment: 'LoopActivityMonitor.appex' });
    }

    // Add DeviceActivity.framework to Frameworks group (sidebar display)
    const frameworksGroup = xp.pbxGroupByName('Frameworks');
    if (frameworksGroup && !frameworksGroup.children.some(ch => ch.value === U.FRAMEWORK_REF)) {
      frameworksGroup.children.push({
        value: U.FRAMEWORK_REF,
        comment: 'DeviceActivity.framework',
      });
    }

    // Add embed phase to main app target buildPhases
    if (!mainTarget.buildPhases.some(p => p.value === U.EMBED_PHASE)) {
      mainTarget.buildPhases.push({
        value: U.EMBED_PHASE,
        comment: 'Embed Foundation Extensions',
      });
    }

    // Add target dependency to main app target
    if (!mainTarget.dependencies) mainTarget.dependencies = [];
    if (!mainTarget.dependencies.some(d => d.value === U.TARGET_DEP)) {
      mainTarget.dependencies.push({ value: U.TARGET_DEP, comment: EXTENSION_NAME });
    }

    console.log(
      `\n[loop-native] ✓ LoopActivityMonitor extension target added to Xcode project\n`,
    );
    return c;
  });
}

// ─── Android: PACKAGE_USAGE_STATS ─────────────────────────────────────────────

function withUsageStatsPermission(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest;
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    const perms = manifest['uses-permission'] ?? [];
    const name  = 'android.permission.PACKAGE_USAGE_STATS';
    if (!perms.some(p => p.$['android:name'] === name)) {
      perms.push({ $: { 'android:name': name, 'tools:ignore': 'ProtectedPermissions' } });
      manifest['uses-permission'] = perms;
    }
    return c;
  });
}

// ─── Compose ──────────────────────────────────────────────────────────────────

module.exports = (config) => {
  config = withFamilyControlsEntitlements(config);
  config = withExtensionFiles(config);
  config = withExtensionTarget(config);
  config = withUsageStatsPermission(config);
  return config;
};
