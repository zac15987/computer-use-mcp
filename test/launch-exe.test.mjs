import assert from 'node:assert/strict'
import test from 'node:test'
import { createSession } from '../dist/session.js'

// Regression: on Windows, `activateApp` is EnumWindows-based and does NOT
// spawn a new process — it only raises an existing window. Before the
// launchExe branch was added, `open_application` with a `.exe` path for a
// not-yet-running program returned `activated: false` and the program was
// never actually launched. The hint blamed UAC, which was misleading
// whenever UAC was off (or set to "Never notify").
//
// These tests are platform-aware: the open_application Win32 launch branch
// only runs under `IS_WINDOWS`, so the assertions about hint text and PID
// suffix only apply on Windows. On macOS the branch is skipped entirely
// and the existing macOS behavior is unchanged.

const IS_WINDOWS = process.platform === 'win32'

function createNativeWithLaunchExe(opts = {}) {
  const launchExeCalls = []
  const activateAppCalls = []
  let activatedAfterLaunch = opts.activatedAfterLaunch ?? false
  const launchResult = opts.launchResult ?? { launched: true, pid: 12345 }

  return {
    launchExeCalls,
    activateAppCalls,
    setActivatedAfterLaunch(v) { activatedAfterLaunch = v },
    // Minimum stubs to satisfy session lifecycle.
    drainRunloop() {},
    activateApp(bundleId) {
      activateAppCalls.push(bundleId)
      const activated = activateAppCalls.length === 1 ? false : activatedAfterLaunch
      return { bundleId, activated, displayName: bundleId }
    },
    launchExe(path) {
      launchExeCalls.push(path)
      return launchResult
    },
    getFrontmostApp() { return null },
    listRunningApps() { return [] },
    listWindows() { return [] },
    prepareDisplay() { return { targetBundleId: '', hiddenBundleIds: [] } },
  }
}

test('open_application on Windows .exe path: calls launchExe when activateApp says not_running', { skip: !IS_WINDOWS }, async () => {
  const native = createNativeWithLaunchExe()
  const session = createSession({ native })

  const result = await session.dispatch('open_application', {
    bundle_id: 'C:\\Windows\\System32\\notepad.exe',
  })

  assert.deepEqual(native.launchExeCalls, ['C:\\Windows\\System32\\notepad.exe'])
  // launchExe is only called after the first activateApp returns activated: false.
  assert.equal(native.activateAppCalls.length, 2)
  const text = result.content[0].text
  assert.match(text, /pid: 12345/)
})

test('open_application on Windows .exe path: surfaces hint with PID + child-process discovery instructions', { skip: !IS_WINDOWS }, async () => {
  const native = createNativeWithLaunchExe()
  const session = createSession({ native })

  const result = await session.dispatch('open_application', {
    bundle_id: 'C:\\setup.exe',
  })

  const text = result.content[0].text
  // The hint must guide the agent toward checking child processes (the
  // KVS_Setup case: the parent is a self-extractor, the UI is in a child).
  assert.match(text, /ParentProcessId=12345/)
  // Must NOT lead with UAC — that was the misleading old behavior.
  assert.match(text, /Only blame UAC if your startup UAC probe/)
  // Must include the explicit "do not relaunch" rule.
  assert.match(text, /Do NOT call open_application again/)
})

test('open_application on Windows .exe path: when activateApp succeeds first try, launchExe is NOT called', { skip: !IS_WINDOWS }, async () => {
  const native = createNativeWithLaunchExe()
  // Override: first activateApp returns activated: true (program already running).
  native.activateApp = function(bundleId) {
    native.activateAppCalls.push(bundleId)
    return { bundleId, activated: true, displayName: bundleId }
  }
  const session = createSession({ native })

  await session.dispatch('open_application', {
    bundle_id: 'C:\\Windows\\System32\\notepad.exe',
  })

  assert.deepEqual(native.launchExeCalls, [])
})

test('open_application on Windows .exe path: launchExe failure surfaces the reason in the hint', { skip: !IS_WINDOWS }, async () => {
  const native = createNativeWithLaunchExe({
    launchResult: { launched: false, pid: null, reason: 'shell_execute_failed: file not found' },
  })
  const session = createSession({ native })

  const result = await session.dispatch('open_application', {
    bundle_id: 'C:\\does-not-exist.exe',
  })

  const text = result.content[0].text
  assert.match(text, /launch failed/)
  assert.match(text, /shell_execute_failed/)
  assert.match(text, /Verify the path/)
})

test('open_application on Windows AUMID: launchExe is NOT called for AUMID-shaped bid', { skip: !IS_WINDOWS }, async () => {
  const native = createNativeWithLaunchExe()
  const session = createSession({ native })

  await session.dispatch('open_application', {
    bundle_id: 'Microsoft.WindowsAlarms_8wekyb3d8bbwe!App',
  })

  // AUMID branch uses explorer.exe (not launchExe). launchExe is only for
  // Win32 `.exe` paths.
  assert.deepEqual(native.launchExeCalls, [])
})

test('open_application without launchExe in native module degrades gracefully', { skip: !IS_WINDOWS }, async () => {
  const native = createNativeWithLaunchExe()
  // Simulate an older .node binary that doesn't expose launchExe.
  delete native.launchExe
  const session = createSession({ native })

  const result = await session.dispatch('open_application', {
    bundle_id: 'C:\\Windows\\System32\\notepad.exe',
  })

  const text = result.content[0].text
  // Should still return a usable response, not throw.
  assert.match(text, /activated: false/)
  assert.match(text, /native module may be out of date/)
})
