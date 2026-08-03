# 3DViewerIDV

A plugin for **[neo-bpsys-wpf](https://github.com/PLFJY/neo-bpsys-wpf)** (a WPF host app for Identity V tournament/broadcast tooling).
Renders a 3D scene of the hunter + 4 survivors in a WebView2 panel, driven by picks fed from the host app.

Plugin API v3 (`apiVersion: "3.0.0.0"`), targeting `net10.0-windows`.

## Repos

Two GitHub repos, one plugin:

| Purpose | Repo |
|---|---|
| **C# source** (this project) | <https://github.com/jefcrb/3DViewerIDVPlugin> |
| **Release / dist** (what users install) | <https://github.com/jefcrb/3DViewerIDV> |

The release repo tracks the shipped binaries + `characters_catalog.json` + `wwwroot/` (the JS/HTML/three.js frontend). It is what gets copied into `%APPDATA%\neo-bpsys-wpf\Plugins\3DViewerIDV\` on install. Frontend edits happen there.

The C# source repo has `Plugin.cs`, `Services/`, `ViewModels/`, `Views/`, the csproj, and the authoritative `characters_catalog.json` used at build time. It does **not** carry the frontend — `wwwroot/` is intentionally absent from this repo.

## Plugin API v3 essentials

The host's PluginSdk went v2 → v3 in mid-2026. Points that matter for this plugin:

- **`FrontedWindowBase`** — window classes must inherit this (not raw `Window`). The base ctor sets `WindowStyle=None`, `ResizeMode=NoResize`, `WindowStartupLocation=CenterScreen`; `OnClosing` hides instead of closing (the host uses `RequestServiceClose()` for actual quit).
- **`[FrontedWindowInfo(id, name)]`** — the `canvas[]` overload is `[Obsolete]` and ignored. Every window has one internal `BaseCanvas`. Use a GUID for `id` to avoid conflicts with other plugins.
- **`OnContentChanged` auto-wraps in a Viewbox.** `FrontedWindowBase` always wraps `Window.Content` in a scaling Viewbox — see the WebView2 gotcha below.
- **`AddFrontedWindow<TView, TVM>`, `AddBackendPage<TView, TVM>`, `PluginBase.Initialize`, `ConfigureFileHelper`, `PluginConfigFolder`** — all unchanged from v2.
- **Removed in v3:** `IFrontedControlPluginContributor`, `FrontedPluginControlDescriptor`, `AddFrontedPluginControlContributor<T>` — no shim provided. This plugin never used them.

New v3 registration APIs this plugin does NOT use (not applicable to a WebView2-based full-window plugin):

- `AddFrontedV3LayoutWindow("id")` — user-editable `.bpui` layout windows.
- `AddFrontedV3Control<TControl>()` — designer-embeddable widgets.

### The WebView2 / Viewbox gotcha (important)

`FrontedWindowBase.OnContentChanged` wraps whatever you set as `Content` in an auto-scaling Viewbox. But `Microsoft.Web.WebView2.Wpf.WebView2` uses `HwndHost` to embed a native Chromium HWND, and native windows don't participate in WPF's render-transform pipeline (the "airspace" problem). Under a Viewbox, WebView2 renders as a **blank white rectangle**.

`Views/StatsViewerWindow.xaml.cs` overrides `OnContentChanged` and intentionally does **not** call base, which skips the wrap. The `Content` DP setter handles logical-tree parenting on its own, so this is safe. **Do not remove that override** unless the plugin also switches away from WebView2.

## Runtime flow

1. Host loads `neo-bpsys-wpf.3DViewerIDV.dll` per `manifest.yml`.
2. `SettingsPageViewModel` (settings tab) starts a `WebServer` on the configured port, serving `wwwroot/` (the JS/HTML/three.js scene) and a websocket that pushes the currently-picked hunter as JSON.
3. `StatsViewerWindow` (WebView2), or an OBS browser source, or any browser loads `scene.html` from that server. `wwwroot/js/characters/loader.js` fetches `./<type>/<folderName>/<folderName>.gltf` on demand.
4. Character models are looked up by **folder name = the catalog's `zy` field with wrapping quotes stripped** (see `CharacterDownloadService.DownloadCharacterAsync` — handles both ASCII `"'` and fullwidth `""''`).

## The catalog → download → wwwroot pipeline

`characters_catalog.json` (deployed next to the DLL, read via `Assembly.Location`) lists every hunter/survivor with a `modelUrl` on NetEase's CDN. It is **not** embedded in the DLL — it's read fresh on every `DownloadAllCharactersAsync()` call, so editing it doesn't require a rebuild.

The "Download All" button in the plugin settings page:

- Parses the catalog, downloads each `.gltf` (handles both JSON glTF and binary GLB — sniffs the `glTF` magic bytes), fetches referenced `.bin` buffers and `.jpg`/`.png` textures, writes into `wwwroot/hunters/<zy>/` and `wwwroot/survivors/<zy>/`.
- 10 concurrent downloads, cancellable.
- `TotalHunters` / `TotalSurvivors` / `DownloadProgress` are computed dynamically from the catalog (see `CharacterDownloadService.GetCatalogTotalsAsync`) — no hardcoded totals to keep in sync.

**To add a new character:** add an entry to `characters_catalog.json` in the source repo (build copies it to the plugin dir on next deploy). Restart the host and click "Download All" — no rebuild needed for a catalog-only change.

## Build & deploy

```powershell
dotnet build -c Release
```

Output: `bin/Release/net10.0-windows/neo-bpsys-wpf.3DViewerIDV.dll`.

Copy just the DLL into the install dir — don't clobber `Settings.json` (user config) or `wwwroot/hunters/` / `wwwroot/survivors/` (already-downloaded models):

```powershell
Copy-Item 'bin/Release/net10.0-windows/neo-bpsys-wpf.3DViewerIDV.dll' `
  "$env:APPDATA/neo-bpsys-wpf/Plugins/3DViewerIDV/" -Force
```

**Cannot hot-swap:** `neo-bpsys-wpf.exe` locks the DLL while running. Close it before copying.

The csproj marks `characters_catalog.json` and `manifest.yml` as `CopyToOutputDirectory=Always`. `wwwroot/` is intentionally not part of this project — a full `dotnet publish` would only produce the C#/JSON deploy artifact and would need the release repo's `wwwroot/` copied in separately.

### Plugin SDK reference

The csproj uses a `<ProjectReference>` to `neo-bpsys-wpf.PluginSdk.csproj` in a locally cloned host source tree, plus an `<Import>` of `neo-bpsys-wpf.PluginSdk.targets` from the same location. Both paths are absolute in the csproj — update them to point at wherever the host source is checked out on your machine, or refactor to a NuGet package reference (`neo-bpsys-wpf.PluginSdk` v3.x, `ExcludeAssets="runtime"`).

## Build warnings that can be ignored

- `NU1603: Microsoft.Web.WebView2 X.X was not found; Y was resolved instead` — NuGet floor-vs-actual mismatch, harmless.
- `CS9057: Analyzer assembly ... references version '5.6.0.0' of the compiler` — the V3SourceGenerator needs a newer Roslyn than the SDK ships. Only matters if the plugin adds `[FrontedV3Control]`, which it doesn't.
- Hundreds of `CS1591: Missing XML comment` on `neo-bpsys-wpf.Core` types — not plugin code, not actionable from here.

## Dead files in the release repo (do not update these)

- `wwwroot/hunters_list.txt` — 34-line list, referenced nowhere.
- `wwwroot/hunters/character_list.json` / `wwwroot/survivors/character_list.json` — `characters/loader.js` tries to fetch these to preload models but they usually don't exist; the loader silently skips. Preload is off in practice.
- `wwwroot/js/config.js` `AVAILABLE_HUNTERS` — a stale hardcoded list, not the runtime source of truth. Runtime picks are by folder name, so folder presence + catalog entry is all that matters.

## Key source files

- `Plugin.cs` — plugin entry point, host DI wiring.
- `Services/WebServer.cs` — HTTP + websocket server serving `wwwroot/` and pushing pick state as JSON.
- `Services/CharacterDownloadService.cs` — catalog parsing, model downloading, folder-name sanitization.
- `ViewModels/SettingsPageViewModel.cs` — settings tab bindings (port, scene upload/download, viewer settings import/export, character download).
- `ViewModels/StatsViewerWindowViewModel.cs` — the pick state that gets serialized to `HunterDataJson` for the websocket.
- `Views/SettingsPage.xaml` — settings tab UI. Has a `Page.Resources` implicit TextBlock style setting `Foreground` to `TextFillColorPrimaryBrush` — needed because raw TextBlocks otherwise render black on dark themes until the theme is toggled.
- `Views/StatsViewerWindow.xaml` — hosts the WebView2 that renders the 3D scene. Root element is `<controls:FrontedWindowBase>` (v3 requirement).
- `Views/StatsViewerWindow.xaml.cs` — the `OnContentChanged` override that bypasses the base's Viewbox wrap (see WebView2 gotcha above).
- `wwwroot/js/` (in the release repo) — three.js frontend. `scene/loader.js` handles the `.glb` scene + dummy transforms; `characters/loader.js` loads per-character `.gltf` models; `animation/sequencer.js` drives entrance/idle sequences; `perf/statsMonitor.js` is the FPS overlay.

## Reference

- **Plugin dev guide**: <https://docs.bpsys.plfjy.top/dev/plugin/plugin-development.html> — canonical v3 SDK reference (registration APIs, `FrontedV3Control`, migration notes).
- **Docs hub**: <https://docs.bpsys.plfjy.top/dev/> — links to plugin market, plugin system, web renderer pages.
- **API reference**: <https://docs.bpsys.plfjy.top/api/api/index.html> — generated API browser.
- **Host repo**: <https://github.com/PLFJY/neo-bpsys-wpf> — the `neo-bpsys-wpf.ExamplePlugin/` project inside is a working v3 plugin example that uses `AddFrontedWindow`, `AddFrontedV3LayoutWindow`, and `AddFrontedV3Control` (a superset of what this plugin does).
