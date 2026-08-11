# Text crispness vs. browsers - self-consistent subpixel glyph placement

Investigation log + proposal, 2026-08-11. Grounds Vellum's (`taf_can_do`) text-vs-Firefox
softness gap in the actual `cosmic-text`/`swash` API rather than guesswork, and proposes a
concrete next fix. Related: `resources/nature-of-fonts.md` (font delivery/licensing, not
rendering fidelity).

## What's already shipped this session

1. **Row-clipping fix.** `pixel_snap` only snapped a text area's own origin, not each line
   within it - multi-line runs could drift off the physical-pixel grid line-by-line, which is
   what caused glyphs to lose a row of pixels and shipped `pixel_snap` disabled. Fixed by snapping
   `run.line_y` per-line in `shape_area` (`taf_can_do/src/text/mod.rs`), re-enabled `pixel_snap`
   by default.
2. **Nearest-filtering experiment - tried, reverted.** Switched the glyph atlas sampler from
   `Linear` to `Nearest` to test whether GPU bilinear resampling was the source of general
   softness. It wasn't a clear win (softness looked about the same) and it exposed a *new* defect:
   adjacent letters with an already-tight natural gap ("se" in "Classes", "es" in "Coaches")
   appeared to touch. Reverted to `Linear`.
3. **Self-consistent subpixel X placement - shipped.** The fix proposed below: `CacheKey::new`'s
   discarded `x` return value is now used for glyph placement instead of raw `glyph.x`. Confirmed
   fixed the "se"/"es" sticking-letters artifact.
4. **Extreme-zoom OOM - shipped and confirmed fixed, separate bug, same code area.** Reported
   after the above: zooming in far enough crashed wgpu with an out-of-memory error. Root cause:
   `raster_font_size` (= `area.font_size * dpr`, with `view_zoom` already baked into
   `area.font_size`) has no upper bound, and a large-enough heading at a high-enough zoom/dpr
   combination (reachable through the editor's own 30x zoom ceiling) demands a large
   coverage-bitmap allocation for one glyph - worse, straddling-viewport big-glyph runs rebuild
   that allocation *every frame* by design (`CULL_RASTER_THRESHOLD` routes them to an uncached
   path). Fixed in `taf_can_do/src/text/mod.rs`'s `shape_area` + `src/text/atlas.rs`:
   - `MAX_RASTER_FONT_PX` caps what swash is ever asked to rasterize a glyph at, with the
     resulting bitmap uniformly upscaled (`raster_scale`) to still fill the glyph's true
     on-screen quad - a no-op below the cap, so ordinary zoom levels are bit-identical to before.
   - A cheap `GlyphAtlas::get` cache-hit check skips rebuilding the RGBA8 buffer entirely once a
     glyph/size/phase is already resident.
   - `GlyphAtlas::clear` (the overflow-reset path) was reallocating a fresh 64MiB zero-buffer on
     every single overflow; now reuses one.
   - Added a web logger (`initialize()` in `lib.rs` never installed one - every `log::` call on
     the actual deployed build was previously silent) plus targeted `log::info!` diagnostics at
     device/adapter acquisition, `content_texture` (re)size, and atlas overflow/clear, so a future
     report is self-diagnosing instead of requiring guesswork.
   - **First pass (`MAX_RASTER_FONT_PX = 1024`) still crashed** on a real repro. The new
     diagnostics showed why: `content_texture` was tiny (4.1 MiB, ruled out) and the crash fired
     immediately after the *first* glyph-atlas overflow/clear - at 1024px only ~4 max-size glyphs
     fit in the 4096px atlas before overflow, so a heading with several large distinct letters at
     high zoom hit that wall almost immediately. Dropped to `MAX_RASTER_FONT_PX = 256` (~225
     glyphs fit before overflow) - **confirmed fixed**: no more crash zooming to 3000%.

## Root cause of the "sticking letters" artifact

Found by reading `cosmic-text-0.19.0/src/glyph_cache.rs` directly, not inferred:

```rust
impl CacheKey {
    pub fn new(..., pos: (f32, f32), ...) -> (Self, i32, i32) {
        let (x, x_bin) = SubpixelBin::new(pos.0);
        let (y, y_bin) = SubpixelBin::new(pos.1);
        (Self { ..., x_bin, y_bin, ... }, x, y)
    }
}
```

`SubpixelBin::new` quantizes a continuous position into a **truncated integer pixel** (`x`/`y`)
plus **one of 4 fractional phases** (`Zero`/`One`/`Two`/`Three` = 0/0.25/0.5/0.75). Swash
rasterizes the glyph bitmap *pre-shifted* for that exact quantized phase - the bitmap is only
correct for that specific `(x, x_bin)` pair, not for the raw continuous input.

Vellum's call site (`taf_can_do/src/text/mod.rs`, the `FORCE_BITMAP` branch) does this:

```rust
let (cache_key, _, _) = CacheKey::new(..., (glyph.x * dpr, 0.0), ...);
...
let left = glyph.x + p.left as f32 / dpr;   // <- raw glyph.x, not the quantized `x`
```

The returned integer `x` (the position the bitmap was *actually* rasterized for) is discarded.
The glyph is then drawn at the true continuous `glyph.x` instead - a value that can differ from
the quantized position by up to 0.125px (half a phase-width) *before* the GPU's own rasterization
rounds it again to a physical pixel. That second, independent rounding is what varies
glyph-to-glyph and is what showed up as visible jitter once `Linear` filtering stopped blurring it
away.

This is the X-axis twin of the row-clipping bug: a self-consistency gap between "what was
rasterized" and "where it's drawn," not a fundamental limitation. Y is already self-consistent
after the `pixel_snap` fix (swash's `y_bin` is hardcoded to `Zero`/whole-pixel, and `line_y` now
gets snapped to match).

## Fix - shipped, confirmed

Capture and use `CacheKey::new`'s returned `x`, instead of recomputing from raw `glyph.x`:

```rust
let (cache_key, x_snapped, _) = CacheKey::new(..., (glyph.x * dpr, 0.0), ...);
...
let left = (x_snapped as f32 + p.left as f32) / dpr;
```

This is exactly the technique production subpixel-positioned glyph caches use (this *is* what
Skia/Pango/etc. mean by "N-phase subpixel glyph cache" - 3-4 phases is a standard, not a
corner-cut). No accuracy is thrown away versus what swash already computes; the fix is using the
value that already exists instead of ignoring it. Does not touch caching cost - `x_bin` is already
part of `cache_key`, so atlas slot count is unaffected.

**Confirmed by screenshot**: re-cropped "Classes"/"Coaches" at 8x zoom post-fix shows even letter
spacing matching Firefox's, no more touching "se"/"es".

## What this does NOT close

- **Stem/outline hinting quality.** Whether swash's hint interpreter grid-fits stems as
  aggressively/well as FreeType's (what Firefox uses on Linux) is a separate, deeper gap in the
  rasterizer itself, not a placement bug. Closing it fully means forking/patching swash or
  switching rasterizer backends (e.g. `freetype-sys`/`freetype-rs`) - real wasm-build-complexity
  lift, last resort, not proposed here.
- **4-phase granularity.** 0.25px steps are coarse compared to a hypothetical infinite-resolution
  cache, but this matches what most production engines actually ship - not expected to be
  perceptible on its own.

## Recommendation

Implement the self-consistent-placement fix above next. It's small, directly explains and fixes
the reported artifact, and is architecturally correct (not a workaround). Re-evaluate general
softness after it ships - if a real gap remains, the FreeType-backend swap is the only lever left,
and that's a separate, much bigger decision to make deliberately, not something to reach for yet.
