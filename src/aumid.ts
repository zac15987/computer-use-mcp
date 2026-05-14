/**
 * Windows AUMID (Application User Model ID) launch support.
 *
 * UWP / Microsoft-Store / packaged apps don't have a traditional .exe path —
 * the OS reaches them through an AUMID like
 * `Microsoft.WindowsAlarms_8wekyb3d8bbwe!App`. The Win32 `EnumWindows`-based
 * `activateApp` in the native module can only activate an *already-running*
 * window; it can't actually launch a not-yet-running packaged app. To start
 * one, the standard Windows mechanism is `explorer.exe shell:AppsFolder\<AUMID>`,
 * which dispatches to the shell's app activation pipeline (the same one used
 * by the Start menu).
 *
 * Kept in its own module (no native imports beyond `child_process`) so the
 * detection helpers can be unit-tested without building the Rust NAPI binary.
 */

import { execFile } from 'child_process'

/**
 * Detect whether a bundle_id looks like a Windows AUMID.
 *
 * AUMIDs always contain a `!` between PackageFamilyName and ApplicationId.
 * Win32 executable paths (`C:\foo\bar.exe`, `notepad`) and macOS bundle IDs
 * (`com.apple.Safari`) never contain `!`. We also reject anything that looks
 * like a path (contains `/` or `\`) to avoid false positives on edge-case
 * input.
 */
export function isAumid(s: string): boolean {
  if (typeof s !== 'string') return false
  if (!s.includes('!')) return false
  if (s.includes('/') || s.includes('\\')) return false
  return true
}

/**
 * Detect whether a bundle_id looks like a Win32 executable path or filename.
 *
 * Used by `open_application` to decide which hint to show on
 * `activated: false`. When the agent passes a `.exe` path (e.g. an installer
 * the user just downloaded), the AUMID hint is actively misleading — the
 * real reason `activated` is false is usually that the process was just
 * dispatched and no window is visible yet (UAC pending on secure desktop,
 * still unpacking, or a prior UAC denial). Showing the AUMID hint pushes
 * the agent into "look up the friendly name → retry with AUMID" reasoning
 * when it should be looking at `list_windows` / `tasklist` instead.
 *
 * Heuristic:
 *   - contains `\` or `/`  → looks like a path
 *   - ends with `.exe` (case-insensitive) → looks like a Win32 executable
 *
 * Friendly names (`Clock`), partial PFNs (`Microsoft.WindowsAlarms`), and
 * macOS bundle IDs (`com.apple.Safari`) all return false — for those the
 * AUMID hint is still the right answer.
 */
export function looksLikeWin32App(s: string): boolean {
  if (typeof s !== 'string') return false
  if (s.length === 0) return false
  if (s.includes('\\') || s.includes('/')) return true
  if (s.toLowerCase().endsWith('.exe')) return true
  return false
}

/**
 * Build the `shell:` URI that `explorer.exe` accepts as an AUMID activation.
 * Example output: `shell:AppsFolder\Microsoft.WindowsAlarms_8wekyb3d8bbwe!App`.
 */
export function aumidShellTarget(aumid: string): string {
  return `shell:AppsFolder\\${aumid}`
}

/**
 * Launch a packaged app by AUMID through `explorer.exe`. Returns when the
 * explorer.exe invocation exits (which is usually within ~100-300ms because
 * explorer dispatches to the shell activation pipeline asynchronously), or
 * after `timeoutMs` if explorer hangs. The actual app launch continues in
 * the background — callers should `sleep` a short window before re-querying
 * window state.
 *
 * Never throws; explorer.exe exit codes for `shell:` URIs are not reliable
 * indicators of success/failure, so we just wait and let the caller verify
 * via the native module.
 */
export function launchAumidViaExplorer(aumid: string, timeoutMs = 2000): Promise<void> {
  return new Promise<void>(resolve => {
    const child = execFile('explorer.exe', [aumidShellTarget(aumid)], () => resolve())
    const killer = setTimeout(() => {
      try { child.kill() } catch { /* ignore */ }
      resolve()
    }, Math.max(timeoutMs, 100))
    child.on('exit', () => clearTimeout(killer))
    child.on('error', () => { clearTimeout(killer); resolve() })
  })
}
