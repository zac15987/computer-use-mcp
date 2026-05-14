# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

This is **`zpit-desktop-mcp`** — a personal fork of [`@zavora-ai/computer-use-mcp@6.1.0`](https://github.com/zavora-ai/computer-use-mcp), maintained as the desktop-control MCP server backing [zpit](https://github.com/zac15987/zpit)'s desktop agent. The npm name and `bin` were renamed (`zpit-desktop-mcp`), but the internal API, tool surface, and module layout are unchanged from upstream — keep deltas vs. upstream minimal so they can be PR'd back.

Current fork-specific changes:
- **Windows AUMID launch** in `open_application` (`src/aumid.ts` + session integration) — resolves UWP/Microsoft Store apps via `explorer.exe shell:AppsFolder\<AUMID>`, then re-attempts `activateApp`.
- **Stdio entrypoint detection** in `src/entrypoint.ts` — accepts Windows backslash paths in `process.argv[1]` so `node dist\server.js` and `npx zpit-desktop-mcp` actually start the server on Windows. Posted upstream as PR #9.
- **Win32 `.exe` launch via `ShellExecuteExW`** in `open_application` (recent commit `46bb017`).
- Server version is read from `package.json` at runtime in `src/server.ts` (`resolvePackageVersion()`), not hardcoded — bumping the `version` field is sufficient to update the MCP `initialize` handshake.

The primary working platform here is **Windows** (this repo lives under `D:\Documents\MyProjects\`). macOS support is preserved from upstream and must keep working; both platforms ship the same TypeScript surface and the same Rust crate, gated by `#[cfg(target_os = ...)]`.

## Build & test commands

```powershell
npm install                          # installs deps; package.json os field gates non-mac/non-win
npm run build                        # build:native (cargo --release) + build:ts (tsc)
npm run build:native                 # cross-platform native build via scripts/build-native.mjs
npm run build:ts                     # tsc -> dist/
npm test                             # build:ts + node --test test/*.test.mjs
node --test test/session.test.mjs    # run a single test file
npm run server                       # tsx src/server.ts (dev MCP server on stdio)
node test/smoke-windows.mjs          # Windows live smoke test (after build)
npm run smoke                        # build + macOS live smoke (scripts/test-v5-smoke.mjs)
```

`SKIP_NATIVE_BUILD=1` short-circuits `build:native` — useful when you only changed TypeScript and the `.node` binary on disk is already current. `prepublishOnly` runs the full `build` so published artifacts always include a fresh native binary.

`scripts/build-native.mjs` is the cross-platform replacement for the old shell scripts; it runs `cargo build --release` and copies the produced dylib/dll to `computer-use-napi.{darwin-arm64,darwin-x64,win32-x64}.node` at the repo root.

Windows native build prerequisites: Rust (stable, MSVC toolchain), Node.js ≥18, Visual Studio Build Tools (C++ workload), Windows SDK.

## Architecture

Five-layer stack — MCP boundary → session → native — with cross-platform parity enforced at every layer:

```
MCP client (Claude Desktop, Cursor, etc.)
        │  JSON-RPC over stdio or in-memory transport
        ▼
src/server.ts          — registers ~60 tools, Zod-validates inputs at the boundary,
                         attaches ToolMeta { focusRequired, mutates } per tool
        ▼
src/session.ts         — single ~3000-line "do everything" module:
                         resolves target (target_window_id → target_app → state),
                         applies focus_strategy (strict / best_effort / none / prepare_display),
                         dispatches to native + spawns AppleScript / PowerShell,
                         returns structured FocusFailure diagnostics on miss
        ▼
src/native.ts          — loads computer-use-napi.<platform>-<arch>.node
        ▼
native/src/*.rs        — Rust NAPI; per-OS code via #[cfg(target_os = "...")]
                         and sometimes #[path = "*_macos.rs"] (windows.rs, accessibility.rs,
                         spaces.rs each have a sibling _macos.rs file with the mac body)
```

**Helper modules kept separate from `session.ts` deliberately** so they can be unit-tested without building the NAPI binary:
- `src/entrypoint.ts` — `isStdioEntrypoint(argv1)` decides whether to start `StdioServerTransport` or stay library-only.
- `src/aumid.ts` — `isAumid`, `looksLikeWin32App`, `launchAumidViaExplorer`.

**TypeScript client** (`src/client.ts`) is the typed counterpart used by examples and by zpit; `connectInProcess(server)` and `connectStdio(cmd, args)` are the two entrypoints.

### Cross-platform conventions

- Rust: `#[cfg(target_os = "macos")]` / `#[cfg(target_os = "windows")]` modules, with the macOS implementation often split into a `*_macos.rs` sibling and pulled in via `#[path = "..."]`. NAPI function signatures must be identical across platforms.
- TypeScript: branch via `IS_WINDOWS` / `IS_MACOS` constants; never inline `process.platform` checks at call sites.
- `bundle_id` is the unified identifier — a macOS bundle ID *or* a Windows process name *or* (on Windows) an AUMID *or* a Win32 `.exe` path. `session.ts` normalizes transparently; `aumid.ts` heuristics decide which Windows launch path applies.
- Adding a new tool requires changes in all three layers: register schema in `server.ts`, implement dispatch in `session.ts`, expose typed wrapper in `client.ts`.

### Focus model (read this before touching session.ts)

Every mutating action follows the same four steps: **resolve target → ensure focus per strategy → act → update TargetState**. `target_window_id` always takes precedence over `target_app`. Pointer tools default to `best_effort`; keyboard and text-writing AX tools default to `strict`. `prepare_display` (v5.2) hides every non-target regular app before activating — used to defeat focus-stealing background apps; the response payload includes `hiddenBundleIds` so callers can restore later via `unhide_app`.

On focus failure the server returns `{ isError: true, error: 'focus_failed', ..., suggestedRecovery: 'activate_window'|'unhide_app'|'open_application' }` — preserve this contract when modifying focus logic.

### Tool metadata

Each tool registers a `ToolMeta { focusRequired: 'scripting'|'ax'|'cgevent'|'none', mutates: boolean }`. This is appended to descriptions and exposed via `get_tool_metadata` so agents can choose paths without trial and error. When adding tools, classify honestly — `cgevent` tools require frontmost; `scripting` can run against backgrounded/hidden apps; `ax` needs Accessibility permission.

## Code standards

- TypeScript `strict: true` — no `any` except where genuinely unavoidable.
- Rust: `cargo fmt` and `cargo clippy` must be clean before committing.
- Validate all tool inputs in `session.ts` *before* they reach native code, on top of the Zod validation in `server.ts`.
- The session is **not thread-safe** — tools must be awaited sequentially. Don't introduce concurrent native calls.
- This server has full control of the user's machine when permissions are granted. Shell-backed tools must continue to use argument arrays or encoded PowerShell, never string-concatenated commands. Temp files must use `O_EXCL`. The `wait` tool stays capped at 300s.

## Testing

`npm test` builds TypeScript and runs `node --test test/*.test.mjs`. The suite includes property-based tests via `fast-check` covering session semantics, focus strategies, target resolution, tool schemas, AUMID detection, entrypoint detection, and `.exe` launch.

`test/smoke-windows.mjs`, `test/smoke-new-tools.mjs`, and `test/verify-macos-parity.mjs` are live smoke scripts — they actually drive the OS, so they're not part of `npm test`. Run them manually after a build when touching native code or session focus paths.
