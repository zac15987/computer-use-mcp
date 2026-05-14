import assert from 'node:assert/strict'
import test from 'node:test'
import { isAumid, aumidShellTarget, looksLikeWin32App } from '../dist/aumid.js'

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

// Regression: the `activated: false` hint used to fire the UWP/AUMID message
// for any non-AUMID bid, including .exe paths. That pushed agents toward
// looking up an AUMID for an installer that was simply waiting on UAC.
// `looksLikeWin32App` separates "path or .exe" (Win32 hint) from "bare
// friendly name" (UWP hint).

test('looksLikeWin32App detects Windows paths', () => {
  assert.equal(looksLikeWin32App('C:\\Windows\\System32\\notepad.exe'), true)
  assert.equal(looksLikeWin32App('D:\\Program Files\\App\\app.exe'), true)
  assert.equal(looksLikeWin32App('C:\\Users\\Peanut\\Downloads\\KVS_Setup\\KVS_Setup_G_1240_combine.exe'), true)
})

test('looksLikeWin32App detects bare .exe filenames', () => {
  assert.equal(looksLikeWin32App('notepad.exe'), true)
  assert.equal(looksLikeWin32App('chrome.exe'), true)
  assert.equal(looksLikeWin32App('SETUP.EXE'), true)  // case-insensitive
})

test('looksLikeWin32App detects POSIX-style paths', () => {
  // Some environments may translate paths; still treat as Win32-ish.
  assert.equal(looksLikeWin32App('/c/Users/test/app.exe'), true)
  assert.equal(looksLikeWin32App('./setup.exe'), true)
})

test('looksLikeWin32App rejects friendly names and partial PFNs', () => {
  // These should still hit the UWP/AUMID hint, not the Win32 hint.
  assert.equal(looksLikeWin32App('Clock'), false)
  assert.equal(looksLikeWin32App('Calculator'), false)
  assert.equal(looksLikeWin32App('Microsoft.WindowsAlarms'), false)
  assert.equal(looksLikeWin32App('notepad'), false)  // no extension; treat as bare name
})

test('looksLikeWin32App rejects AUMIDs and macOS bundle IDs', () => {
  assert.equal(looksLikeWin32App('Microsoft.WindowsAlarms_8wekyb3d8bbwe!App'), false)
  assert.equal(looksLikeWin32App('com.apple.Safari'), false)
})

test('looksLikeWin32App handles edge cases gracefully', () => {
  assert.equal(looksLikeWin32App(''), false)
  assert.equal(looksLikeWin32App(undefined), false)
  assert.equal(looksLikeWin32App(null), false)
  assert.equal(looksLikeWin32App(123), false)
})
