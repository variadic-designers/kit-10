# WebCodium export plan — naive → SCSS → Kit-basis

`VISION.md`'s 3rd Principle states the mandate in one line: *"WebCodium — a markup exporter driven by user-defined Export Profiles. First targets are HTML, CSS, Svelte, and SCSS... WebCodium understands variants as discrete or a dynamic thing."* This doc is the elaboration — the concrete mechanics behind that sentence, phased.

Only Phase 1 is built. Phases 2 and 3 are roadmap, not implementation — no code for either exists yet.

---

## Phase 1 — naive per-node export (shipped)

`export_html_css` (`plugins/webcodium/src/lib.rs`) walks Charter's resolved `UiNode` tree and emits one CSS class per **rendered node instance** — `.k10-39`, `.k10-40`, ... — with literal, already-resolved values (`width: 900px`, `background: oklab(...)`) baked directly into each rule. Output is a single HTML file with the CSS inlined in a `<style>` block (see the "for now" note in `CLAUDE.md`'s WebCodium paragraph — single-file to sidestep the two-file download quirk documented in `download.ts`).

This is a direct, unopinionated dump of whatever Charter resolved for the exported view(s). It has no concept of kits, axes, or variants — a node's class exists because that node was rendered, not because it represents a reusable design unit. It's the correct minimal v1 (proves the `kit10_get_interpreter_output` pipeline end to end), but it is explicitly **not** the intended end state — later phases replace this translation strategy, not just add options on top of it.

---

## Phase 2 — SCSS by default

SCSS is a strict superset of CSS — anything emitted as SCSS always transpiles losslessly to plain CSS, so switching the default output target costs nothing functionally. What it buys is brevity: SCSS's nesting syntax lets sibling/child relationships collapse instead of repeating fully-qualified selectors, which matters more as Phase 3's nested selectors (see below) make the output tree-shaped rather than flat.

Scope, as currently understood:
- Output format changes from plain CSS to SCSS syntax; still transpiled/valid CSS wherever a consumer doesn't care about the `.scss` extension specifically.
- Still a single exported file for now — this phase is about syntax brevity within the existing inline/single-file shape (Phase 1's decision), not a file-count change. Splitting CSS back into its own linked file remains a separate, independently-revisitable decision (see `CLAUDE.md`'s existing note on that).
- No axis/variant awareness yet — that's Phase 3. This phase is a pure syntax-target swap on top of Phase 1's existing per-node translation.

---

## Phase 3 — Kit-basis export

The larger architectural shift: export one class per **Kit** (e.g. `.button`), not one per rendered node instance. This requires WebCodium to reason about the axis/kit model itself for the first time — every prior phase only ever consumed Charter's already-resolved, axis-blind output.

Three mechanics, as described:

1. **Axis exclusion.** The designer chooses which axes actually get exported. Some axes exist purely for the designer's own exploration/prototyping and were never meant to leak into shipped code — excluding them means WebCodium collapses that dimension of variation rather than emitting a class per value. Likely surfaced as an Export Profile setting (extending the existing `hints.exportProfile` pattern already wired up in `src/lib/plugins/export-profile.ts` and the Export panel — namespaced project hints, no new DB migration needed, same shape as `hints.vellum`/`hints.charter`), though the exact configuration surface (per-project Export Profile vs. per-Kit) is still open.

2. **Static vs. dynamic variant classification.** For each axis that *is* exported, every variant needs to be classified as one of:
   - **Static** — a separate modifier class, BEM-style (`.button--primary`, `.button--large`). The variant is baked as an always-present alternative class the developer applies by hand or via whatever component logic they write.
   - **Dynamic** — a real runtime state, not a static class. Something like `:hover`/`:focus` (a browser pseudo-class) or a JS-toggled state class (`.is-active`) that changes at runtime rather than being picked once at build/author time.

   This is the concrete mechanism behind VISION.md's "WebCodium understands variants as discrete or a dynamic thing." How the classification is decided is still open — whether it's an explicit flag the designer sets per axis (or per axis-value), or something WebCodium infers from the axis's own semantics (e.g. a `state` axis with hover/focus/active values reads naturally as dynamic; a `theme` or `emphasis` axis reads naturally as static) — no decision made yet.

3. **Nesting homology.** A Kit's composed children become nested CSS selectors mirroring the DOM, derived automatically from the same View-composition structure Charter already understands (`composition_field_keys`/`viewRefs` — see `CLAUDE.md`'s "nesting split" note) — e.g. a Text child inside a Button Kit's Box becomes `.button .text { ... }`, not a numbered node class. This is the same composition graph the Views panel already walks host-side; Phase 3 is a second consumer of it, not a new graph-walking mechanism.

### Why this is a real architectural leap, not an incremental feature

Every phase before this one only ever consumed Charter's already-resolved output — `kit10_get_interpreter_output` hands back a flat, axis-blind `UiNode[]`, and WebCodium's whole job was translating that flat tree into markup. Kit-basis export needs the *unresolved* shape too — which axes exist on a Kit, what their variants are, which layers/conditions map to which variant — information that gets discarded during resolution today. This is the first WebCodium phase that needs axis-level input, not just resolved output; it likely means a new host-fn surface (something adjacent to `kit10_get_resolution`, which already returns pre-flatten `resolvedKits`, but WebCodium would need is closer to the axis/layer structure itself, not just resolved property values) rather than a bigger `export_html_css`.

None of this is designed yet — this section exists so a future session doesn't mistake "make the export smarter" for a small change once work actually starts.
