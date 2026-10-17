#!/usr/bin/env node
/**
 * Automated Packaging Tool for Space Lab / Space Sim.
 * Supports:
 *   - Standalone Desktop Executable (Windows, macOS, Linux via Node SEA)
 *   - Dedicated Server Executable (Windows, macOS, Linux via Node SEA)
 *   - Offline Single-File HTML Player
 *   - Native Desktop Application via Tauri v2
 *   - Mobile Application for Android (Capacitor / Tauri)
 *   - Mobile Application for iOS (Capacitor / Tauri)
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const HELP_TEXT = `
Space Lab · Auto Packaging Tool

Usage:
  npm run package -- [options]
  node scripts/package.mjs [options]

Targets:
  --target=desktop-exe    Build standalone game executable for current OS (default)
  --target=server-exe     Build standalone dedicated server executable
  --target=offline        Build single-file offline HTML game (space-sim-offline.html)
  --target=tauri          Build native desktop application via Tauri v2 (requires Rust)
  --target=android        Prepare & build Android mobile package (Capacitor / Tauri)
  --target=ios            Prepare & build iOS mobile package (Capacitor / Tauri)
  --target=all            Build all locally supported targets

Options:
  --check-env             Check prerequisites for Desktop, Android, and iOS
  -h, --help              Show this help message

Platform Output Summary:
  • Windows:   dist-desktop/space-sim.exe
  • macOS:     dist-desktop/space-sim
  • Linux:     dist-desktop/space-sim
  • Web:       dist/space-sim-offline.html
  • Android:   android/app/build/outputs/apk/debug/app-debug.apk
  • iOS:       ios/App (Xcode Project)
`;

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function runStep(label, fn) {
  process.stdout.write(`  ▶ ${label}... `);
  const start = Date.now();
  try {
    const result = fn();
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`✓ (${duration}s)`);
    return result;
  } catch (err) {
    console.log(`✗`);
    console.error(`\nError during: ${label}`);
    console.error(err.message || String(err));
    throw err;
  }
}

function checkTool(name, args = ['--version']) {
  try {
    const res = spawnSync(name, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    if (res.status === 0) {
      return res.stdout.trim().split('\n')[0] || 'installed';
    }
  } catch {
    // not found
  }
  return null;
}

function checkEnvironment() {
  console.log('\n--- Build Environment Check ---');
  
  // Node.js
  const nodeVer = checkTool('node');
  console.log(`  • Node.js:       ${nodeVer ? `✓ ${nodeVer}` : '✗ Missing (v22.12+ required)'}`);

  // Rust / Cargo (for Tauri)
  const cargoVer = checkTool('cargo');
  console.log(`  • Rust / Cargo:  ${cargoVer ? `✓ ${cargoVer}` : '○ Optional (required for Tauri v2 native desktop/mobile)'}`);

  // Java / Gradle (for Android)
  const javaVer = checkTool('java', ['-version']);
  const gradleVer = checkTool('gradle');
  console.log(`  • Java / JDK:    ${javaVer ? `✓ Found` : '○ Optional (required for Android APK builds)'}`);
  console.log(`  • Gradle:        ${gradleVer ? `✓ ${gradleVer}` : '○ Optional (required for Android build)'}`);

  // Xcode (for iOS)
  if (process.platform === 'darwin') {
    const xcodeVer = checkTool('xcodebuild', ['-version']);
    console.log(`  • Xcode:         ${xcodeVer ? `✓ ${xcodeVer}` : '○ Optional (required for iOS builds)'}`);
  } else {
    console.log(`  • iOS Toolchain: ○ macOS required for native iOS compilation (use GitHub Actions for cloud builds)`);
  }
  console.log('-------------------------------\n');
}

function buildWebAssets() {
  runStep('Building web distribution & offline artifacts', () => {
    const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    execFileSync(npmCmd, ['run', 'build'], { cwd: root, stdio: 'inherit' });
  });
}

function packageDesktopExe() {
  console.log('\n[1/1] Packaging Standalone Game Desktop Executable...');
  buildWebAssets();

  runStep('Injecting single-executable Node SEA bundle', () => {
    execFileSync('node', ['scripts/build_game_exe.mjs'], { cwd: root, stdio: 'inherit' });
  });

  const exeName = process.platform === 'win32' ? 'space-sim.exe' : 'space-sim';
  const exePath = join(root, 'dist-desktop', exeName);
  if (existsSync(exePath)) {
    const size = formatSize(statSync(exePath).size);
    console.log(`\n🎉 Success! Standalone game executable ready:`);
    console.log(`   Location: ${exePath}`);
    console.log(`   Size:     ${size}`);
    console.log(`   Run with: ${process.platform === 'win32' ? '.\\dist-desktop\\space-sim.exe' : './dist-desktop/space-sim'}\n`);
  }
}

function packageServerExe() {
  console.log('\n[1/1] Packaging Dedicated Server Executable...');
  buildWebAssets();

  runStep('Injecting dedicated server SEA bundle', () => {
    execFileSync('node', ['scripts/build_server_exe.mjs'], { cwd: root, stdio: 'inherit' });
  });

  const exeName = process.platform === 'win32' ? 'space-sim-server.exe' : 'space-sim-server';
  const exePath = join(root, 'dist-server', exeName);
  if (existsSync(exePath)) {
    const size = formatSize(statSync(exePath).size);
    console.log(`\n🎉 Success! Server executable ready:`);
    console.log(`   Location: ${exePath}`);
    console.log(`   Size:     ${size}\n`);
  }
}

function packageTauri() {
  console.log('\nPackaging Native Desktop App with Tauri v2...');
  const cargo = checkTool('cargo');
  if (!cargo) {
    console.error('Error: Rust/Cargo is not installed on this system.');
    console.log('To install Rust: curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh');
    console.log('Alternatively, you can use GitHub Actions for automated cloud packaging without installing Rust locally.');
    process.exit(1);
  }

  buildWebAssets();

  runStep('Running Tauri build', () => {
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    execFileSync(npxCmd, ['@tauri-apps/cli', 'build'], { cwd: root, stdio: 'inherit' });
  });
}

function packageAndroid() {
  console.log('\nPackaging Android App...');
  buildWebAssets();

  runStep('Syncing web game assets into Android project', () => {
    const src = join(root, 'dist');
    const dest = join(root, 'android', 'app', 'src', 'main', 'assets', 'public');
    mkdirSync(dest, { recursive: true });
    cpSync(src, dest, { recursive: true });
  });

  const hasAndroidSdk = Boolean(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT);
  const gradlew = join(root, 'android', process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');

  if (hasAndroidSdk && existsSync(gradlew)) {
    runStep('Compiling Android APK with Gradle', () => {
      execFileSync(gradlew, ['assembleDebug'], { cwd: join(root, 'android'), stdio: 'inherit' });
    });
    const apkPath = join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
    if (existsSync(apkPath)) {
      console.log(`\n🎉 Success! Android APK built at:\n   ${apkPath}\n`);
      return;
    }
  }

  console.log('\n🎉 Success! Android project is prepared and synced at:');
  console.log('   Location: android/');
  console.log('   Assets:   android/app/src/main/assets/public/');
  console.log('\nNext steps:');
  console.log('  1. Open the "android" folder in Android Studio to run on an emulator or device.');
  console.log('  2. Or run: cd android && ./gradlew assembleDebug (when Android SDK is installed).');
  console.log('  3. Or trigger GitHub Actions (.github/workflows/package.yml) for automated cloud APK builds.');
}

function packageIos() {
  console.log('\nPackaging iOS App...');
  buildWebAssets();

  console.log('\niOS packaging workflow:');
  console.log('1. Capacitor Method (Recommended for iOS Safari/WKWebView):');
  console.log('   - Install Capacitor CLI:  npm install -D @capacitor/core @capacitor/cli @capacitor/ios');
  console.log('   - Initialize iOS:         npx cap add ios');
  console.log('   - Sync latest build:      npx cap sync ios');
  console.log('   - Open in Xcode:          npx cap open ios');
  console.log('   - Build IPA / Archive:    Product -> Archive in Xcode');
  console.log('\n2. Tauri v2 Mobile Method:');
  console.log('   - Initialize Tauri iOS:   npx @tauri-apps/cli ios init');
  console.log('   - Build iOS package:      npx @tauri-apps/cli ios build');
  console.log('\n3. Progressive Web App (PWA):');
  console.log('   - Manifest and Apple touch icons are configured.');
  console.log('   - iOS users can tap Share -> "Add to Home Screen" to play fullscreen offline!');
}

function main() {
  const { values } = parseArgs({
    options: {
      target: { type: 'string', short: 't', default: 'desktop-exe' },
      'check-env': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (values['check-env']) {
    checkEnvironment();
    return;
  }

  const target = values.target || 'desktop-exe';

  switch (target) {
    case 'desktop-exe':
    case 'game-exe':
      packageDesktopExe();
      break;
    case 'server-exe':
      packageServerExe();
      break;
    case 'offline':
      buildWebAssets();
      console.log('\nOffline single-file HTML ready at dist/space-sim-offline.html');
      break;
    case 'tauri':
      packageTauri();
      break;
    case 'android':
      packageAndroid();
      break;
    case 'ios':
      packageIos();
      break;
    case 'all':
      packageDesktopExe();
      packageServerExe();
      packageAndroid();
      packageIos();
      break;
    default:
      console.error(`Unknown target "${target}". Run with --help for available targets.`);
      process.exit(1);
  }
}

main();
