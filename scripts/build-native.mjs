#!/usr/bin/env node
/**
 * Cross-platform native module build.
 *
 * Runs `cargo build --release` in native/ and copies the produced dynamic
 * library to the per-platform .node filename(s) the native.ts loader expects.
 * Replaces the previous Unix-only `build:native` and Windows-only
 * `build:native:win` shell scripts so `npm run build` (and therefore
 * `prepublishOnly`) succeeds identically on macOS and Windows.
 *
 * Environment knobs:
 *   SKIP_NATIVE_BUILD=1 — skip cargo and the copy step entirely. Useful
 *     when binaries were built externally (CI artifact download) or when
 *     publishing from a host that doesn't need to rebuild.
 *
 * Exits non-zero only on real build failures. Platforms outside the
 * supported set (linux, etc.) exit 0 so `npm install` on a source clone
 * doesn't fail — the package.json `os` field already gates installs.
 */

import { spawnSync } from 'child_process'
import { copyFileSync, existsSync } from 'fs'
import { join } from 'path'
import process from 'process'

const platform = process.platform
const arch = process.arch

if (process.env.SKIP_NATIVE_BUILD === '1') {
  console.error('[build-native] SKIP_NATIVE_BUILD=1, skipping cargo build and copy step.')
  process.exit(0)
}

if (platform !== 'darwin' && platform !== 'win32') {
  console.error(`[build-native] platform ${platform} not shipped by this package — skipping (no-op).`)
  process.exit(0)
}

const repoRoot = process.cwd()
const nativeDir = join(repoRoot, 'native')

if (!existsSync(nativeDir)) {
  console.error(`[build-native] native/ directory not found at ${nativeDir}`)
  process.exit(1)
}

console.error(`[build-native] cargo build --release  (cwd=${nativeDir})`)
// Pass the command as a single string with shell:true so the OS resolves
// `cargo` from PATH (incl. Windows PATHEXT for cargo.exe / cargo.cmd shims).
// Node 22 DEP0190 forbids combining argv array with shell:true.
const cargo = spawnSync('cargo build --release', {
  cwd: nativeDir,
  stdio: 'inherit',
  shell: true,
})
if (cargo.status !== 0) {
  console.error(`[build-native] cargo build failed (exit ${cargo.status})`)
  process.exit(cargo.status ?? 1)
}

const releaseDir = join(nativeDir, 'target', 'release')
const copies = []

if (platform === 'darwin') {
  const src = join(releaseDir, 'libcomputer_use_napi.dylib')
  const archTag = arch === 'arm64' ? 'arm64' : 'x64'
  copies.push(
    [src, join(repoRoot, `computer-use-napi.darwin-${archTag}.node`)],
    // Generic fallback name used by native.ts when the platform-tagged copy
    // is missing. Preserves upstream behavior.
    [src, join(repoRoot, 'computer-use-napi.node')],
  )
} else if (platform === 'win32') {
  const src = join(releaseDir, 'computer_use_napi.dll')
  copies.push(
    [src, join(repoRoot, 'computer-use-napi.win32-x64.node')],
  )
}

for (const [src, dst] of copies) {
  if (!existsSync(src)) {
    console.error(`[build-native] expected cargo output not found: ${src}`)
    process.exit(1)
  }
  copyFileSync(src, dst)
  console.error(`[build-native] copied ${src} -> ${dst}`)
}

console.error('[build-native] done.')
