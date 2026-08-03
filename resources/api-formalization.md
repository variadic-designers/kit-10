# API Formalization - Boundaries, Drift, and a Doc-Generation Roadmap

Status: research + roadmap (2026-07-21). Phase 0 in progress. Phases 1–2 not started.

This doc records an audit of KIT•10's internal API boundaries and the recommended
long-term path to formalizing them - including an automated plugin-doc generator so
the reader-facing docs stop drifting from the code.

---

## Why this exists

Manager is the most formal API in the system: a single hand-written `Api` interface
(`manager/src/api/index.ts`), Kysely-inferred columns off a hand-authored schema
(`manager/src/schema.ts`), and - crucially - it's consumed as **raw TS source**
(`manager/package.json` `main` → `./src/index.ts`), so the whole Manager↔Editor
boundary is type-checked end-to-end by `npm run check`.

The other boundaries are held together by hand-mirrored type definitions and human
discipline, and they are **already drifting**. Concrete proof, found during the audit,
in `PLUGINS.md` (the primary artifact a third-party plugin author reads):

- It listed `inputType` as `color, text, number, select, slider` - the real set
  (`src/lib/plugins/types.ts:3-33`) has **14**.
- It documented colors as `[r,g,b,a]` arrays - post-Oklab the wire shape is an
  `OklabColor {l,a,b,alpha}` **object** (`plugins/charter/src/lib.rs:813`), so the doc
  described a format that would fail to deserialize.
- It documented 6 of the **11** registered host functions and omitted
  `PanelManifest`/`PanelOp` entirely.

(These specific drifts were corrected in the same pass that produced this doc; the
point is that hand-written contract docs rot the moment the code moves.)

---

## The four boundaries, assessed

| Boundary | Contract today | Drift safety | Main gap |
|---|---|---|---|
| **Manager ↔ Editor** (TS↔TS) | One hand-written `Api`, consumed as source → fully `tsc`-checked | **Strong** | `ResolvedView`/`ResolvedViewData` duplicated + `as` cast (`Editor.svelte`); two raw-dialect escape hatches (`Axes.svelte`); untyped `RESOLVE_LIVE_QUERY_SQL` (columns unchecked) |
| **Charter ↔ Vellum** (Rust↔Rust, JSON/msgpack) | ~15 struct/enum pairs **hand-mirrored across two repos**, no shared crate, no codegen | **Mixed** - loud on type/shape/enum-value drift; **silent on field-name drift** where Vellum's field is `#[serde(default)]` (a renamed `flex_grow` → silent `0.0`) | No test round-trips real data through *both* crates |
| **Editor ↔ Plugins** (TS host ↔ Rust/WASM Extism) | JSON payloads; types hand-declared twice (`types.ts` + `charter/lib.rs`), synced by serde-key tests + camelCase/snake_case discipline | **Mixed** | `inputType` is a closed set hardcoded in `Styles.svelte`/`StyleField.svelte`, not runtime-discoverable or plugin-extensible; residual hardcoded `'fontavious'` in `Editor.svelte` |
| **Formalization / docs (meta)** | Cheap string-scraping tests (`resolve-live-query.test.ts`, serde-key asserts at `charter/lib.rs:3016/3058`); **zero** schema tooling; docs are hand-written prose | - | Wire types triplicated (Charter Rust / Vellum Rust / TS) + a 4th hand-synced copy of the Oklab matrices (`src/lib/color/oklch.ts`); docs derived from nothing |

---

## Core finding

There are only **two real wire boundaries** (Charter↔Vellum, Editor↔Charter), and the
*same* leaf data structs (`BoxData`, `TextData`, `ImgData`, `Extent`, `OklabColor`,
`TrackSize`, `BoxExtra`, …) are hand-copied **three-to-four times**:

- Charter Rust - `plugins/charter/src/lib.rs`
- Vellum Rust - `../taf_can_do/src/api.rs`, `render/types.rs`, `color.rs`
- TS mirror - `src/lib/plugins/types.ts` (the file's own comments say "Mirrors
  Charter's struct exactly")
- Oklab matrices - a 4th copy in `src/lib/color/oklch.ts`

Every drift bug in CLAUDE.md's "Common Pitfalls" list traces to this triplication. The
existing tests catch the *loud* classes cheaply; the one genuinely **silent** class is
field-name drift on `#[serde(default)]` fields, which no current test closes.

**Nuance that shapes the fix:** a single shared `UiNode` *enum* is not straightforward -
Charter deliberately uses `#[serde(untagged)]` wrapper structs (`UiBoxNode` with
`#[serde(rename = "Box")]`) to emit the *same* JSON as Vellum's externally-tagged enum
(two Rust shapes, one wire format). So the shared-type move targets the **leaf data
structs** (byte-identical, where field-name drift actually bites), while each side keeps
its own `UiNode` enum assembling those shared leaves.

---

## Roadmap

Three phases, each independently shippable. Phase 0 is the recommended immediate start -
cheapest, closes the one silent failure mode, and fixes docs that are wrong today.

### Phase 0 - Close the silent-drift path + fix what's already wrong

1. ✅ **Cross-language round-trip golden test (SHIPPED).** Charter's `wire_golden_tests`
   (`plugins/charter/src/lib.rs`) builds one canonical instance of every `UiNode` variant
   with a distinct non-default sentinel per field, serializes it, and pins it to
   `plugins/charter/tests/wire-format.golden.json` (regenerate with `UPDATE_WIRE_GOLDEN=1`).
   Vellum's `charter_wire_golden_tests` (`../taf_can_do/src/api.rs`) deserializes a committed
   copy of that golden with **Vellum's** structs and asserts every sentinel survived -
   closing the silent field-name-drift path (verified: renaming `flex_grow` in the wire makes
   Vellum's assertion fail on the defaulted `0.0`). A new wire field is a compile error in
   `canonical_wire_nodes()` until given a sentinel, forcing the golden + Vellum consumer to be
   updated together. A best-effort cross-repo identity check flags a stale fixture copy when
   both repos are checked out as siblings. The golden is duplicated across the two repos until
   Phase 1's shared crate removes the copy.
2. **Fix `PLUGINS.md`** (inputType list, Oklab color shape, all 11 host fns, add
   `PanelManifest`/`PanelOp`). *(Done in this pass; Phase 2 keeps it honest automatically.)*
3. **Manager↔Editor cheap wins:** delete `ResolvedView` and re-export `ResolvedViewData`
   from manager, removing the `as` cast in `Editor.svelte`; promote the two raw-dialect
   reads in `Axes.svelte` to real `Api` methods.
4. **Remove the residual hardcoded `'fontavious'`** in `Editor.svelte`'s font scan -
   route it through the `inputType`/provider indirection `suggestion-providers.ts`
   already establishes.

### Phase 1 - Single source for the wire leaf-structs (shared Rust crate)

Extract the identical leaf structs (`BoxData`, `TextData`, `ImgData`, `Extent`,
`OklabColor`, `TrackSize`, `GridLine`, `AlignValue`, `JustifyValue`, `FlexWrapValue`,
`NodePosition`, `BoxExtra`, `BoxShadow`) into a small shared crate both `plugins/charter`
and `../taf_can_do` depend on (path dependency first - already checked out as siblings;
publish only if that coupling becomes painful). Each crate keeps its own `UiNode` enum.
The Oklab matrices (`color.rs`) fold in too, killing the 4th hand-copy. This makes the
leaf structs a single authoritative definition - the prerequisite for trustworthy Phase 2
generation.

### Phase 2 - Automated plugin docs generated from that source

**Status: partially SHIPPED (2026-07-21).** Three PLUGINS.md sections are now machine-backed:
the inputType table is *generated* from the TS `InputType` union's `@doc:` comments; the
host-fn list and node examples are *guarded*; and - the schemars piece - the **wire-type
reference** is generated from `schemars`. Charter derives `JsonSchema` (behind an optional
`schema` feature so the shipped wasm never pulls schemars in) on the `UiNode` wire cluster;
`cargo test --features schema` dumps + guards `plugins/charter/generated/wire-schema.json`;
`scripts/generate-plugin-docs.mjs` renders it into PLUGINS.md's "Wire type reference" tables
(field / type / required), Prettier-aligned and vitest-guarded. Not yet done: schemars over
`FieldDef`/`FieldCategory`/`OnResolveResult` (the editor-contract structs), and enriching the
generated tables with descriptions (Charter's wire fields use `//`, not `///`, so schemars sees
no doc comments - converting them would auto-populate a Description column). The original design
for the rest:

Rust/Charter is the authoritative *producer* of the plugin-facing contract, so generation
flows **one direction: Rust → JSON → docs + TS**, snapshot-test-driven (never a live
schema-first build):

1. Add `schemars` to the shared crate + Charter; derive `JsonSchema` on the wire structs
   and on `FieldDef`/`FieldCategory`.
2. A `cargo test`-driven dump writes the wire-type **JSON Schema** and a serialized
   snapshot of `box_categories()`/`text_categories()`/`image_categories()`
   (`plugins/charter/src/lib.rs`) - the exhaustive catalog of every field + `inputType`
   + side-channel.
3. A `scripts/generate-plugin-docs.mjs` (modeled on `plugins/fontavious/generate-catalogue.mjs`
   + the "generated, do not edit" header from `scripts/fetch-fonts.mjs`) regenerates,
   between marker comments: `PLUGINS.md`'s Data-Types/inputType/field-catalog sections,
   and the `InputType` union in `src/lib/plugins/types.ts`.
4. A CI check runs the generator and `git diff --exit-code` - stale docs become a caught
   failure, exactly like `resolve-live-query.test.ts` makes an unjoined table one.

**Deeper unlock (optional):** making `inputType → widget` a runtime registry (as
`suggestion-providers.ts` already does for `inputType → provider`) would let a plugin
*introduce* a field kind without editing editor source - the extensibility VISION's 1st
Principle ultimately wants. Not required for doc automation.

### Explicit non-goals

- **No heavyweight bidirectional JSON-Schema single-source-of-truth pipeline** that
  generates both Rust and TS. Generic codegen fights the hand-tuned serde enum
  representations (`Extent`/`UiNode`/`ImageSource`) and discards the explanatory prose.
- **Do not make TS authoritative** (zod/typia → Rust). Charter is the producer.
- **Do not touch the DB-schema types** - Kysely already owns those with full inference.
- **Do not force-share the `UiNode` enum** across Charter/Vellum - share leaves only.

---

## Verification per phase

- **Phase 0:** the round-trip test *fails* when a Charter wire field is deliberately
  renamed, passes on the real structs; `npm run check` green after the `ResolvedView`
  dedup; rebuild+copy Charter/Vellum wasm and confirm the viewport is unchanged (the
  `'fontavious'` reroute must not change font loading).
- **Phase 1:** `cargo test` in both crates; rebuild+copy **both** wasm artifacts (they
  share the crate now - deploy pitfall applies); confirm a box/text/image + Oklab view
  renders identically.
- **Phase 2:** run the generator, confirm `PLUGINS.md` + `InputType` regenerate with no
  manual diff; add a new `inputType` in Charter and confirm the CI `git diff` gate fails
  until the generator is re-run.
