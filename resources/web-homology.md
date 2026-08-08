# Web homology audit

How closely does KIT•10's model map onto the actual web platform (CSS Box Model, Flexbox, Grid,
Positioning, Cascade, Custom Properties, Color 4, the DOM, HTML elements, DOM events, ARIA)? Where
it diverges, is that a deliberate opinionated choice (VISION.md's "opinionated translation layer,
not raw CSS pass-through" 1st Principle) or an unexamined gap?

Conducted 2026-08-08 via three parallel code-reading passes (layout/positioning, styling/cascade/
values, tree/primitives/rendering/interaction). Every entry below is: **web concept** → **KIT•10
mechanism** → **verdict** → citation. Verdicts:

- **Faithful** - same math/spec/semantics, not just a similar name.
- **Deliberate subset** - a real, intentional opinion narrowing or reshaping the web concept, cited
  against a documented rationale.
- **Structural divergence** - genuinely different mechanism, by design, that doesn't map onto the
  web concept at all (not a bug - just a different architecture).
- **Total gap** - the web concept has no KIT•10 equivalent whatsoever.

---

## 1. Layout & box model

**Box sizing.** CSS `width`/`height` + `box-sizing: content-box | border-box`. KIT•10's `Extent`
(`Auto | Px(f32) | Percent(f32)`) is a reduced 3-way length analog, and Vellum pins every taffy
`Style.box_sizing` to `ContentBox` permanently (`taf_can_do/src/layout/mod.rs:675`) - `border-box`
would shrink content as padding grows, overflowing text. WebCodium is explicitly forbidden from ever
emitting a `box-sizing` rule (`kit10/CLAUDE.md:173`), since a CSS reset defaulting to `border-box`
would silently conflict. **Deliberate subset** - content-box is a real CSS value, just permanently
fixed rather than exposed.

**Resize semantics (Fixed/Hug/Fill).** Real CSS: `flex-grow`/`flex-shrink`/`flex-basis`,
`width: fit-content/min-content/max-content`. Charter's `compile_resize`
(`plugins/charter/src/lib.rs:1338-1429`) is a Figma-borrowed abstraction, not a CSS keyword,
compiled down to those exact flex fields (Fill → `grow:1,shrink:1,basis:0`+`align-self:stretch`;
Hug → `grow:0,shrink:0`). **Deliberate subset / opinionated layer.**

**Arrangement (Stack/Cluster/Split/Center/Grid).** Real CSS: `flex-direction`/`justify-content`/
`align-items`/`flex-wrap`/`display:grid`. Charter's `compile_arrange`
(`plugins/charter/src/lib.rs:1431+`) is named-outcome presets compiling to those same fields
(`resources/layout-affordances.md:126-132`), explicitly modeled on Figma/Framer naming to collapse
~19 raw fields into a tab row (`layout-affordances.md:22-30`). Raw fields stay reachable via a
per-tab Advanced escape hatch. **Deliberate subset.**

**Grid.** CSS Grid Level 1/2 vs Charter's `TrackSize`/`GridLine`/`GridTemplateArea`/`GridAutoFlow`.
taffy 0.10.1 already implements the real CSS Grid vocabulary natively, and KIT•10 wires nearly all
of it end-to-end (`resources/grid-mastery-plan.md:15-19`), including a real quoted-string
`grid-template-areas` parser. Two documented v1 cuts: named-line *declaration* (only placement
resolves; unmatched names fall back to `auto`, `grid-mastery-plan.md:60-64`) and subgrid/masonry
(blocked on a future taffy upgrade, not a KIT•10 choice). **Near-faithful, explicit partial gaps.**

**Positioning.** CSS `position: static/relative/absolute/fixed/sticky` + `inset`/z-index. The four
`NodePosition` variants (`kit10-scene/src/lib.rs:295-325`): `Relative` (static), `Nudged{dx,dy}`
(paint-time-only translation, stays in flow - genuinely equivalent to `position:relative`+top/left,
`CLAUDE.md:346`), `Absolute{x,y}` (world-space, root-only, drag-hint-driven only), `Anchored{dx,dy}`
(leaves flow, resolves against the *parent's* resolved rect via a third layout pass). None of the
four are ever mapped onto taffy's real `Position`/`inset` (`CLAUDE.md:346,488`) - CSS
`position:absolute` couples "leave flow" with shrink-to-fit sizing that collapses text to zero
width, so KIT•10 deliberately reimplements it as an independent-tree-plus-post-layout-translation
instead. `Anchored` is closer to "`position:absolute` on a `position:relative` parent" than to the
newer CSS Anchor Positioning spec (`anchor()`) - no cross-tree anchor reference, and doesn't chain
(an `Anchored` child of an `Anchored` parent falls back to `Relative`, `lib.rs:317-319`). No
equivalent exists for `position:fixed`/`sticky`, real `inset`, or z-index/stacking contexts.
**Structural divergence by design**, with `fixed`/`sticky`/`z-index` as flat gaps.

**Corner shape.** Real 2026 CSS `corner-shape: superellipse(n)` (Chromium-only). Vellum's SDF
renders a true superellipse, `n` fixed at 4 (`CLAUDE.md:315`). WebCodium emits
`@supports (corner-shape: superellipse(4))` as the same keyword/exponent for supporting browsers
(`plugins/webcodium/src/css.rs:361-367`) - faithful there. The fallback path uses a proportionally
area-matched circular `border-radius` (`SQUIRCLE_AREA_MATCH_SCALE ≈ 0.583`, `css.rs:273-290`), a
deliberate approximation, not the literal radius. **Faithful (enhancement path) / deliberate
approximation (fallback).**

**Margin vs gap/padding.** CSS keeps these fully independent. `BoxExtra.margin: f32` is still a real
wire field (`kit10-scene/src/lib.rs:416-418`), but `build_box_node` hardcodes `margin: 0.0` and
never parses it from kit data, and it's explicitly retired from the Render panel alongside the
item-flex trio ("Charter's no-margins opinion," `plugins/charter/src/lib.rs:2271-2273`) - spacing is
the container's job via gap/padding. **Field alive, authoring surface deliberately removed.**

**Paint order / z-ordering.** CSS stacking contexts make paint order z-index/DOM-position sensitive.
Vellum's is explicitly not: one global pass per primitive type (all boxes, then shapes, then images,
then text - `CLAUDE.md:359`) - any text anywhere paints above any box anywhere regardless of
nesting. Traded batching-for-performance against z-correctness; flagged in CLAUDE.md as "not yet
fixed," not a permanent design choice. **Structural divergence, currently unfixed** (see Backlog #1).

---

## 2. Styling, cascade, and values

**Cascade & specificity.** Real CSS: `(inline, ID, class, type)` 4-tuple + source order, largely
orthogonal to the newer `@layer` ordering. KIT•10's Layer specificity is
`[conditionCount, ...axisPriorities]` (`resolve.ts:196-209`, mirrored in `merge_kits`,
`plugins/charter/src/lib.rs:653-667`) - condition-count-derived with human-assigned per-axis
priority ranks, no ID/class/type distinction at all. `merge_kits` additionally lets a
lower-priority kit's more-specific layer beat a higher-priority kit's unconditional one, which has
no CSS analog (a later `@layer` always wins regardless of in-layer specificity). **Structural
divergence** - cascade-inspired, but its own numeric-vector system, not CSS's 4-tuple or `@layer`.

**Axes vs media/container queries.** An axis roughly matches like a media/container *feature*:
`matchesArg` (`resolve.ts:140-194`) does discrete-string equality (≈ `prefers-color-scheme`) or
numeric range overlap (≈ `(min-width: …)`/`@container`). But axes are author-defined arbitrary
dimensions (theme/density/plan/…), not CSS's fixed feature vocabulary, and one Layer's conditions
freely mix axes of any kind - CSS never lets a media query and container query combine in one rule.
`excluded_from_export` (an axis kept out of exported CSS, collapsed to its default) has no CSS
analog at all - closer to a build-time flag. **Deliberate reduced/generalized subset.**

**Tokens vs CSS custom properties.** `tokens.value` (`scalar`/`view` union, `CLAUDE.md:52`) maps
onto `--x` semantics for the scalar case, and `render_root_variables`
(`plugins/webcodium/src/variants.rs:1114-1135`) genuinely emits `:root { --alias: value; }` for
**project**-scope tokens, substituted via real `var(--alias)`
(`resolve_properties_with_tokens`, `variants.rs:250`). But kit/view-scoped tokens are literal-baked,
not emitted as custom properties (`CLAUDE.md:175`) - only one scope tier is faithful; CSS custom
properties have no such scope tiering at all. A `view`-typed token has no CSS counterpart (it's a
structural DAG reference, not styling data). **Faithful-but-partial** (see Backlog #4).

**View composition vs Web Components/`<use>`.** The occurrence model (`CLAUDE.md:476`,
`occurrence_map`/`ViewOccurrence`) - one view referenced by N parents, each independently resolving/
selecting/overriding via `token_axis_overrides` - behaves closer to SVG `<use>` (shared definition,
independently-styleable instances) than a Web Component (no shadow-DOM/slot boundary at all -
styling is fully global/inherited across occurrences). Per-occurrence *axis-argument* overriding has
no equivalent in either `<use>` or Web Components. **Structural divergence** - no clean single web
analog (see Backlog #5 on the missing encapsulation boundary).

**Color.** The most faithful axis. `oklch_to_oklab`/`linear_srgb_to_oklab`
(`taf_can_do/src/color.rs:44-61`, `plugins/charter/src/lib.rs:712-715`) use Björn Ottosson's exact
published Oklab matrices - the same math CSS Color 4's `oklch()`/`oklab()` spec is built on -
`parse_color` parses `oklch()`/`oklab()` first-class (`resources/oklch.md`). Display-P3 uses the CSS
Color 4/Color.js reference primary-rotation matrix. The one honest gap: real CSS Color 4 gamut
mapping (binary-search MINDE, `resources/oklch.md:130-158`) isn't built - KIT•10 falls back to
per-channel GPU clip, the same shortcut some browsers also take, explicitly documented as such.
**Faithful** on core spec math; gamut mapping is a known, documented gap, not a different derivation.

**Text properties.** `text-align`/`text-decoration` (`plugins/charter/src/lib.rs:1746-1764`) are
literal CSS keyword passthroughs. `compile_line_height` honors CSS's unitless-multiplier semantics
but adds a KIT•10-invented size-interpolated ramp (1.5×→1.1×) when unset, which CSS's own
`line-height: normal` doesn't have. `resolve_font_weight`'s snapping mimics the CSS Fonts
fallback-direction algorithm but applies it to Fontavious's variable-font catalog, a KIT•10-specific
concept with no `@font-face`-exposed equivalent. **Mostly faithful passthrough, two deliberate
opinions layered on top.**

**WebCodium's generated CSS - how literal is it?** For the common case, genuinely idiomatic: one BEM
modifier class per condition, real compound selectors for multi-condition layers
(`.button.button--theme-dark`), real `:hover`/`:focus` for dynamic axes. But multi-kit composition
synthesizes machinery no human author would hand-write: `composition_signature_class`
(`plugins/webcodium/src/tree.rs:183-187`) is a hash-based class solely to disambiguate two views
composing the same kits in opposite priority order, and `synthesize_contested_rules`
(`variants.rs:340+`) emits extra rules purely to reproduce KIT•10's own cross-kit winner logic in
CSS's native cascade. **Idiomatic for single-kit/single-axis; multi-kit composition compiles to CSS
as a bytecode target**, repurposing real cascade mechanics to encode resolution semantics CSS has no
native vocabulary for.

---

## 3. Tree, primitives, rendering, and interaction

**Tree shape.** Real DOM nodes hold live child references (a true node-graph). KIT•10's wire model
is a flat `Vec<UiNode>` with only `parent_id: Option<usize>` per node
(`kit10-scene/src/lib.rs:512,593,643,753,812`). Nobody walks it as a parent-pointer structure at
runtime - both Vellum's layout builder and WebCodium's exporter each independently do one O(N) pass
to reconstruct a `HashMap<parent, Vec<child>>` before recursing
(`taf_can_do/src/layout/mod.rs:629-649`, `plugins/webcodium/src/tree.rs:306-314`) - the "real tree"
is rebuilt ad hoc by every consumer, never carried on the wire. **Deliberate reduced subset** -
cheaper to serialize/diff than a graph, at the cost of every walker reconstructing children itself.

**Primitive vocabulary.** HTML has dozens of semantic/interactive elements; KIT•10 has exactly five
paintable primitives (Box/Text/Img/Shape/SpriteBatch, `kit10-scene/src/lib.rs:839-844`), chosen by
`detect_primitive`'s heuristic over resolved properties (`plugins/charter/src/lib.rs:2209-2269`).
There is no button/input/link primitive at all - everything interactive is a generic Box. Closer to
Figma's flat node-kind vocabulary than to HTML's tag set, confirmed by `composition_field_keys()`
only ever returning `["children"]`. **Structural divergence** from HTML's semantic vocabulary,
faithful only to the small paint-primitive subset a CSS framework actually needs.

**Rendering pipeline.** Browsers separate DOM, CSSOM, and render tree as distinct live objects.
KIT•10 collapses style resolution entirely upstream: Charter's `build_viewport` bakes already-
resolved values straight into `UiNode` before Vellum ever sees it - there is no separate stylesheet
object model on the render side, only a per-node `taffy::Style` derived at layout time. Painting is
GPU/SDF-based (`fwidth`-based AA, MSAA off on web, `CLAUDE.md:313`) rather than a CPU rasterizer.
**Structural divergence** - style resolution happens once, upstream, with no live CSSOM equivalent.

**Interaction model.** No in-scene DOM-event system exists - no bubbling/capturing, no
`addEventListener`, no event object. Selection/hover/drag are entirely host-orchestrated: the Svelte
editor calls `vellum.set_hover`/`start_node_drag`/`update_node_drag`/`end_node_drag` directly on the
Rust API (`CLAUDE.md:378,351`). `rebuild_selection_instances` is a pure rendering overlay (outline +
corner handles) run every frame - directly analogous to a devtools element-inspector overlay, not a
live pseudo-class. There is no `:hover`/`:focus-visible` state a Box/Shape remembers itself; hover
state is always pushed in from outside. **Total gap** vs DOM events/CSS pseudo-classes; faithful
only to the "external inspector overlay" analogy.

**Accessibility.** Effectively nothing. A repo-wide search for ARIA/accessibility/semantic-HTML
concepts turns up only one real hit: `src/lib/types/aria.ts`, used solely by the editor's own
`DarkModeToggle.svelte` - accessibility of the *editor's own UI chrome*, not of anything users author
or export. WebCodium's `html.rs` emits only `<div>`/`<p>`/`<img alt="">` (alt text hard-coded empty,
`plugins/webcodium/src/html.rs:99,102,128`); Shape/SpriteBatch emit no markup at all. No
nav/header/main/button, no `role=`, no `aria-*` anywhere in exported output or the data model.
**Total gap** - accessibility/semantic HTML is not a modeled concept in the design system at all
(see Backlog #2).

**Shape/SpriteBatch vs SVG/Canvas.** `ShapeKind` (Rect/Ellipse/Line/Polygon/Star) renders via a GPU
analytic-SDF pipeline (`sd_polygon_generic`) conceptually parallel to SVG's vector path model, but
WebCodium explicitly refuses to emit any markup or CSS for Shape or SpriteBatch nodes ("staying
silent is the honest behavior until Shape export is actually built," `html.rs:133-138`). Zero
web-exportable output for either primitive today - GPU-only. **Total gap on export**, despite a real
conceptual analog existing only inside the renderer (see Backlog #3).

---

## Backlog

Ranked by rough severity × effort. Only the genuine-gap/currently-unfixed findings above - the
deliberate-subset and faithful verdicts are documented architectural decisions, not backlog items.

1. **Paint order not z-sorted** (Vellum, medium effort). Real visual bug once views overlap; the
   just-shipped `Anchored` positioning makes overlap a more reachable authoring pattern than before
   (a badge pinned to a parent's corner is exactly the kind of composition likely to overlap
   siblings), so this is now more likely to surface than when it was first flagged. Fix needs
   either interleaved per-node draws (loses the current per-primitive-type batching) or a depth
   buffer - a real engineering tradeoff, not a quick patch.

2. **Accessibility/semantic export** (large, scope undecided). Zero ARIA/semantic-HTML concept
   anywhere in the data model or exporter. Largest and least-scoped item on this list - would need
   its own dedicated scoping pass (does "accessibility" mean semantic tag inference on primitives,
   an authorable `role`/`aria-label` property surface, alt-text authoring for Img, or all three?)
   before any implementation is sized. Not estimated here on purpose.

3. **Shape/SpriteBatch have no web-exportable output** (WebCodium, medium effort). Already a
   documented v1 scope cut, not a surprise - but this audit surfaces a concrete conceptual path
   forward: Shape's SDF path ≈ SVG `<path>`/`<polygon>`, SpriteBatch ≈ `<canvas>` sprite blitting or
   a CSS sprite sheet. Natural next primitive-support step for WebCodium once prioritized.

4. **Kit/view-scoped tokens don't emit as CSS custom properties** (WebCodium, small effort). Only
   project-scope tokens do today. CLAUDE.md already documents the exact mechanism
   (`resolve_properties_with_tokens`'s project-tokens-map gate) that would need extending to cover
   the other two scopes - the smallest, most mechanical item here.

5. **View composition has no encapsulation boundary** (large effort, unclear demand).
   Global/inherited styling across occurrences, no shadow-DOM-style scoping. Architecturally
   interesting - flagged here because the audit surfaced it, not because there's a reported pain
   point driving it (unlike the positioning gap, which came from a real authoring wall). Lowest
   priority of the five until a concrete use case appears.
