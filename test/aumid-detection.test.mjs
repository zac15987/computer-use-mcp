import assert from 'node:assert/strict'
import test from 'node:test'
import { isAumid, aumidShellTarget } from '../dist/aumid.js'

// Regression: upstream `open_application` only calls `activateApp`, which on
// Windows is `EnumWindows`-based and can't launch a not-yet-running UWP /
// packaged app — it returns `activated: false` with no further recovery.
// This fork detects AUMID-shaped bundle_ids and falls back to
// `explorer.exe shell:AppsFolder\<AUMID>` before re-trying activateApp.

test('isAumid accepts well-known Microsoft Store AUMIDs', () => {
  assert.equal(isAumid('Microsoft.WindowsAlarms_8wekyb3d8bbwe!App'), true)
  assert.equal(isAumid('Microsoft.WindowsCalculator_8wekyb3d8bbwe!App'), true)
  assert.equal(isAumid('Microsoft.WindowsTerminal_8wekyb3d8bbwe!App'), true)
})

test('isAumid accepts AUMIDs with non-App ApplicationId suffix', () => {
  // Some packages register multiple entry points under different ApplicationIds.
  assert.equal(isAumid('Microsoft.Office.OUTLOOK.EXE.15'), false)  // no "!"
  assert.equal(isAumid('Some.Package_pubhash!OtherApp'), true)
  assert.equal(isAumid('Some.Package_pubhash!sub.app.id'), true)
})

test('isAumid rejects Win32 executable names', () => {
  assert.equal(isAumid('notepad.exe'), false)
  assert.equal(isAumid('notepad'), false)
  assert.equal(isAumid('chrome.exe'), false)
})

test('isAumid rejects Win32 executable paths', () => {
  assert.equal(isAumid('C:\\Windows\\System32\\notepad.exe'), false)
  assert.equal(isAumid('D:\\Program Files\\App\\app.exe'), false)
})

test('isAumid rejects POSIX-style paths (false-positive guard for "!")', () => {
  // If a user accidentally passes a path containing "!" (e.g. through
  // shell history expansion), don't mistake it for an AUMID.
  assert.equal(isAumid('/tmp/file!name'), false)
  assert.equal(isAumid('./hist!.txt'), false)
})

test('isAumid rejects macOS bundle IDs', () => {
  assert.equal(isAumid('com.apple.Safari'), false)
  assert.equal(isAumid('com.microsoft.VSCode'), false)
})

test('isAumid handles edge cases gracefully', () => {
  assert.equal(isAumid(''), false)
  assert.equal(isAumid('!'), true)  // technically matches; harmless to forward
  assert.equal(isAumid(undefined), false)
  assert.equal(isAumid(null), false)
  assert.equal(isAumid(123), false)
})

test('aumidShellTarget builds the shell:AppsFolder URI with backslash separator', () => {
  assert.equal(
    aumidShellTarget('Microsoft.WindowsAlarms_8wekyb3d8bbwe!App'),
    'shell:AppsFolder\\Microsoft.WindowsAlarms_8wekyb3d8bbwe!App',
  )
})

test('aumidShellTarget does not re-encode the AUMID body', () => {
  // The AUMID is opaque to explorer.exe — pass it through verbatim.
  assert.equal(
    aumidShellTarget('Some.Package_hash!multi.dot.id'),
    'shell:AppsFolder\\Some.Package_hash!multi.dot.id',
  )
})
