# 3DViewerIDV

A plugin for **neo-bpsys-wpf** (a WPF host app for Identity V tournament/broadcast tooling).
Renders a 3D scene of the hunter + 4 survivors in a WebView2 panel, driven by picks fed from the host app.

Currently on plugin API v3 (`apiVersion: "3.0.0.0"`), targeting `net10.0-windows`.

## Three directories, one plugin

| Role | Path |
|---|---|
| **Install / runtime** (this dir, `cwd`) | `C:\Users\jef\AppData\Roaming\neo-bpsys-wpf\Plugins\3DViewerIDV\` |
| **C# source** | `C:\Users\jef\Documents\3DViewerIDV\` |
| **Host source tree (v3 SDK lives here)** | `C:\Users\jef\Downloads\neo-bpsys-wpf-main (2)\neo-bpsys-wpf-main\` |

The install dir is what neo-bpsys-wpf loads at startup. It is also its own git repo (`git@github.com:jefcrb/3DViewerIDV.git`) tracking the shipped binaries + JSON + wwwroot + frontend — **not source**. Recent commits: "add Dentist / 牙医", "increase version" — release-only edits.

The C# source dir is a separate git tree with the C# projects (`Plugin.cs`, `Services\`, `ViewModels\`, `Views\`) and the authoritative `characters_catalog.json`. It is not the same repo as the install dir.

The host source tree contains the host app + `neo-bpsys-wpf.PluginSdk\` + `neo-bpsys-wpf.Core\` + `neo-bpsys-wpf.V3SourceGenerator\`. The plugin csproj references PluginSdk.csproj + PluginSdk.targets by absolute path into this tree. If either the host source tree or the plugin source moves, update the two paths in `neo-bpsys-wpf.3DViewerIDV.csproj`.

## Plugin API v3 essentials

The host's PluginSdk went v2 → v3 (July 2026). What changed that matters here:

- **`[FrontedWindowInfo(id, name, canvas[])]`** — the `canvas` overload is `[Obsolete]` and ignored. Every window has one internal BaseCanvas.
- **`FrontedWindowBase`** — window classes must inherit this (not raw `Window`). Its constructor sets `WindowStyle=None`, `ResizeMode=NoResize`, `WindowStartupLocation=CenterScreen`, and `OnClosing` hides instead of closing.
- **`OnContentChanged` auto-wraps in a Viewbox.** The base class always wraps `Window.Content` in a scaling Viewbox — designed for fixed-size WPF layouts. See the WebView2 gotcha below.
- **`AddFrontedWindow<TView, TVM>`, `AddBackendPage<TView, TVM>`, `PluginBase.Initialize`, `ConfigureFileHelper`, `PluginConfigFolder`** — all unchanged from v2.
- **Removed:** `IFrontedControlPluginContributor`, `FrontedPluginControlDescriptor`, `AddFrontedPluginControlContributor<T>` — no shim. This plugin never used them.

New v3 registration APIs we do NOT use (not applicable to a WebView2 plugin):

- `AddFrontedV3LayoutWindow("id")` — user-editable `.bpui` layout windows.
- `AddFrontedV3Control<TControl>()` — designer-embeddable widgets.

### The WebView2 / Viewbox gotcha (important)

`FrontedWindowBase.OnContentChanged` wraps whatever you set as `Content` in an auto-scaling Viewbox. But WebView2 (`Microsoft.Web.WebView2.Wpf.WebView2`) uses `HwndHost` to embed a native Chromium HWND, and native windows don't participate in WPF's render-transform pipeline (the "airspace" problem). Under a Viewbox, WebView2 renders as a **blank white rectangle**.

`StatsViewerWindow.xaml.cs` overrides `OnContentChanged` and intentionally does **not** call base, which skips the wrap. The `Content` DP setter handles logical-tree parenting on its own, so this is safe. **Do not remove that override** unless you also switch away from WebView2.

## Runtime flow (what actually happens when the plugin runs)

1. Host loads `neo-bpsys-wpf.3DViewerIDV.dll` per `manifest.yml`.
2. `SettingsPageViewModel` (settings tab) starts a `WebServer` on the configured port, serving `wwwroot\` (the JS/HTML/three.js scene) and a websocket that pushes the currently-picked hunter as JSON.
3. WebView2 (or OBS browser source, or a real browser) loads `scene.html` from that server. `wwwroot\js\characters\loader.js` fetches `./<type>/<folderName>/<folderName>.gltf` on demand.
4. Character models are looked up by **folder name = the catalog's `zy` field with wrapping quotes stripped** (see `CharacterDownloadService.DownloadCharacterAsync` — handles both ASCII `"'` and fullwidth `""''`).

## The catalog → download → wwwroot pipeline

`characters_catalog.json` (lives next to the DLL, read via `Assembly.Location`) lists every hunter/survivor with a `modelUrl` on NetEase's CDN. It is **not** bundled into the DLL — it's read fresh on every `DownloadAllCharactersAsync()` call, so editing it doesn't require a rebuild.

The "Download All" button in the settings page:
- Parses the catalog, downloads each `.gltf` (handles both JSON glTF and binary GLB — sniffs the `glTF` magic bytes), fetches referenced `.bin` buffers and `.jpg` textures, dumps them into `wwwroot\hunters\<zy>\` and `wwwroot\survivors\<zy>\`.
- 10 concurrent downloads, cancellable.
- `TotalHunters` / `TotalSurvivors` / `DownloadProgress` are computed dynamically from the catalog (see `GetCatalogTotalsAsync()`) — no hardcoded totals to keep in sync.

**To add a new character:** add an entry to `characters_catalog.json` in both the install dir and the C# source dir (the source's copy has `<CopyToOutputDirectory>Always</CopyToOutputDirectory>` and will overwrite the installed one on next redeploy). Then click "Download All" — no rebuild needed. Restart the app or reopen the settings page for the totals to refresh.

## Build & deploy

From the C# source repo:

```powershell
cd 'C:\Users\jef\Documents\3DViewerIDV'
dotnet build -c Release
```

Output: `bin\Release\net10.0-windows\neo-bpsys-wpf.3DViewerIDV.dll`.

Copy just the DLL to the install dir — don't clobber `Settings.json` (user config) or `wwwroot\hunters\` / `wwwroot\survivors\` (already-downloaded models):

```powershell
Copy-Item 'bin\Release\net10.0-windows\neo-bpsys-wpf.3DViewerIDV.dll' `
  'C:\Users\jef\AppData\Roaming\neo-bpsys-wpf\Plugins\3DViewerIDV\' -Force
```

**Cannot hot-swap:** `neo-bpsys-wpf.exe` locks the DLL while running. Close it before copying.

Csproj marks `characters_catalog.json` and `manifest.yml` as `CopyToOutputDirectory=Always` and `wwwroot\**\*` as `PreserveNewest`. If you build via `dotnet publish` (rather than manual copy of the DLL), the whole plugin folder in `bin\Release\...` becomes the deploy artifact and will overwrite the install's copies of those files.

## Build warnings you can ignore

- `NU1603: Microsoft.Web.WebView2 X.X was not found; Y was resolved instead` — NuGet floor-vs-actual mismatch, harmless.
- `CS9057: Analyzer assembly ... references version '5.6.0.0' of the compiler` — the V3SourceGenerator needs a newer Roslyn than the SDK ships. It only matters if you add `[FrontedV3Control]`, which we don't. Warning is silent otherwise.
- Hundreds of `CS1591: Missing XML comment` on Core types — not your code, not actionable.

## Dead files (do not update these)

- `wwwroot\hunters_list.txt` — 34 lines, referenced nowhere.
- `wwwroot\hunters\character_list.json` / `wwwroot\survivors\character_list.json` — `loader.js:97` tries to fetch these to preload models but they don't exist; the loader silently skips. Preload is currently off.
- `wwwroot\js\config.js` `AVAILABLE_HUNTERS` — a stale 10-entry hardcoded list, not the runtime source of truth. Runtime picks are by folder name, so folder presence + catalog entry is all that matters.

## Key source files

- `Plugin.cs` — plugin entry point, host integration.
- `Services\WebServer.cs` — HTTP + websocket server serving `wwwroot\` and pushing pick state as JSON.
- `Services\CharacterDownloadService.cs` — catalog parsing, model downloading, folder-name sanitization.
- `ViewModels\SettingsPageViewModel.cs` — settings tab bindings (port, scene upload/download, viewer_settings import/export, character download).
- `ViewModels\StatsViewerWindowViewModel.cs` — the pick state that gets serialized to `HunterDataJson` for the websocket.
- `Views\SettingsPage.xaml` — settings tab UI. Has a `Page.Resources` implicit TextBlock style setting `Foreground` to `TextFillColorPrimaryBrush` — needed because raw TextBlocks otherwise render black on dark themes until the theme is toggled.
- `Views\StatsViewerWindow.xaml` — hosts the WebView2 that renders the 3D scene. Root element is `<controls:FrontedWindowBase>` (v3 requirement).
- `Views\StatsViewerWindow.xaml.cs` — the `OnContentChanged` override that bypasses the base's Viewbox wrap (see WebView2 gotcha above).
- `wwwroot\js\` — three.js frontend. `scene\loader.js` handles the .glb scene + dummy transforms; `characters\loader.js` loads per-character .gltf models; `animation\sequencer.js` drives entrance/idle sequences; `perf\statsMonitor.js` is the FPS overlay.

## Reference: host docs & source

- **Plugin dev guide**: <https://docs.bpsys.plfjy.top/dev/plugin/plugin-development.html> — the canonical v3 SDK reference (registration APIs, `FrontedV3Control`, migration notes).
- **Docs hub**: <https://docs.bpsys.plfjy.top/dev/> — links to plugin market, plugin system, web renderer pages.
- **API reference**: <https://docs.bpsys.plfjy.top/api/api/index.html> — generated API browser.
- **Host repo**: <https://github.com/PLFJY/neo-bpsys-wpf>
- **Host source tree on disk**: `C:\Users\jef\Downloads\neo-bpsys-wpf-main (2)\neo-bpsys-wpf-main\` — has its own `AGENTS.md` and `docs\` folder with architecture notes; check `neo-bpsys-wpf.ExamplePlugin\` for a working v3 plugin example (uses `AddFrontedWindow`, `AddFrontedV3LayoutWindow`, `AddFrontedV3Control` — a superset of what we do).
- **This plugin's release repo**: <https://github.com/jefcrb/3DViewerIDV> — same as the install dir's git.
- **Plugin market**: `C:\Users\jef\Documents\neo-bpsys.PluginMarket\` — has `PluginIndex.json` and manifests; that's how the plugin is discoverable to other users.
