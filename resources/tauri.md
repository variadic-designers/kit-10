# Tauri Desktop Packaging - Feasibility Notes (2026-07-19)

Research snapshot for whether KIT•10 could ship as a Tauri desktop app. Not yet decided or built - this is the background for that decision.

## Where the actual risk is

The editor's UI (Svelte panels, dialogs, forms) is plain CSS/DOM - any OS webview renders that fine, zero Tauri risk there. The only real compatibility question is narrowly scoped to **Vellum's `<canvas>`**, which needs WebGPU. Tauri hosts the app in the OS's native webview instead of bundling Chromium (unlike Electron), so WebGPU support is only as good as that platform's webview:

- **macOS (WKWebView)** - solid. Safari/WebKit shipped WebGPU by default as of the version current this year (Safari 26 / macOS Tahoe 26). No extra config needed.
- **Windows (WebView2)** - good. WebView2 is Edge/Chromium under the hood and auto-updates; the Tauri team has confirmed WebGPU works there. Worth a sanity check against whatever WebView2 Runtime version target users actually have, since some threads suggest flag/version sensitivity.
- **Linux (WebKitGTK)** - the real gap. WebKitGTK has **no WebGPU implementation and no committed roadmap** (confirmed on the webkit-gtk mailing list: no flag, no plan). This isn't unique to Tauri - Electron's Chromium on Linux returns `null` for WebGPU adapters too, and even Chrome/Firefox's own Linux WebGPU rollouts are behind Windows/macOS this year. WebKitGTK is behind even that general Linux lag.

## Two different fallback patterns exist in the wild

**Pattern A - Linux gets the web app.** The common, simple answer: treat Linux as second-class for the desktop build, direct those users to the existing browser version. This is legitimate precedent (it's literally what Electron/Tauri WebGPU apps do today, per multiple tracking issues - e.g. rerun-io's Chrome-on-Linux WebGPU perf issue, Tauri's own WebGPU tracking issues #6381/#12846) but leaves Linux desktop users worse off than everyone else.

**Pattern B - bypass the webview's WebGPU entirely (better fit for us).** Tauri's `wry` library ships a native-wgpu-overlay example (`wry/examples/wgpu.rs`), and there's active discussion (`tauri-apps/tauri` discussion #11944, "Render wgpu frames as webview overlay") describing the real production pattern: don't route through the webview's JS `navigator.gpu` at all. Run `wgpu` **natively** in Rust against a raw window handle, compositing it as an overlay/child surface next to the webview (which renders only the UI chrome). Native wgpu on Linux talks to Vulkan directly, so WebKitGTK's missing WebGPU implementation never enters the picture.

## Why Pattern B is realistic for KIT•10 specifically

`taf_can_do` (Vellum) already has a **`standalone` feature flag** (winit/pollster) used for the native demo binary - see the Vellum section of `AGENTS.md`. That's the native-rendering groundwork Pattern B needs already sitting in the codebase; it would need to become a raw-window-handle overlay hosted inside a Tauri window instead of its own standalone winit window, but this isn't starting from zero. This path would make Linux a first-class target instead of a "use the browser" carve-out.

## Open questions / not yet done

- No prototype exists yet - before committing to a desktop build, get Vellum initializing and drawing one frame in a bare Tauri window on each target OS (this is the cheap way to de-risk before wiring up the rest of the editor).
- Haven't confirmed WebView2 Runtime version floor needed for WebGPU on realistic target-user machines.
- Haven't scoped the work to adapt the `standalone` feature into a Tauri-hosted overlay (vs. its own window) - currently just a plausible direction, not a plan.

## Sources

- [Render wgpu frames as webview overlay · tauri-apps Discussion #11944](https://github.com/orgs/tauri-apps/discussions/11944)
- [wry/examples/wgpu.rs](https://github.com/tauri-apps/wry/blob/dev/examples/wgpu.rs)
- [WebGPU support? · Issue #6381 · tauri-apps/tauri](https://github.com/tauri-apps/tauri/issues/6381)
- [[WebGPU] Support? · Issue #12846 · tauri-apps/tauri](https://github.com/tauri-apps/tauri/issues/12846)
- [Chrome @ Linux is laggy using experimental WebGPU · rerun-io/rerun#9453](https://github.com/rerun-io/rerun/issues/9453)
- [[Bug]: Cannot get WebGPU adapter in Linux · electron/electron#41763](https://github.com/electron/electron/issues/41763)
- [GPUWeb Implementation Status (Safari/WebKit)](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status)
- [Re: [webkit-gtk] No flag for WebGPU - is it planned?](https://www.mail-archive.com/webkit-gtk@lists.webkit.org/msg03883.html)
- [Tauri on X: "webgpu on Windows in Tauri works"](https://x.com/TauriApps/status/1630990337576431616)
