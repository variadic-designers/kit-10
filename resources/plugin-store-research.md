# Plugin Boundaries & the Plugin Store — Research

Research to inform consolidating a **plugin store** (add plugins, configure them). This maps
the plugin architecture as it exists today, names every boundary and seam, then lays out the
gaps a store has to close and a recommended direction. Grounded in the current code; file
references are load-bearing.

Related: `PLUGINS.md` (the contract), `CLAUDE.md` §4/§5 (Plugin Manager + Charter), VISION.md
Principles 1 & 3 (which already anticipate this).

**Status (2026-07-26): §4 gaps 1–3 shipped.** The manifest is no longer just `{wasm}` — it now
carries `provides.exports/imports` (with `target`/`multiFile`), `capabilities.hostFns/hosts`
(enforced by `makeHostFunctions`'s grant filter), and `supports`. §3's provider-mapping seams
(export/import) are now runtime resolvers over `listPlugins()`, not hardcoded TS. An install path
exists (Plugins panel's form + `/store`'s hand-off). Export Profile (§5.4) is real. `plugins/webcodium/`
is the first real non-first-party plugin exercising all of it. **Still open**: gap 4 (config
schema/storage), gap 5 (capability *grant* UI — requests are declared and enforced, never shown
to the user before install), a real remote catalogue behind `/store` (its plugin list is still
100% invented), and all of §6's open questions (config scope, capability granularity, `kind` vs.
tags, descriptor source of truth, remote wasm trust, wire-format versioning). Read this doc for
the grounding/reasoning; treat §4/§5's checklist items above as done, not as remaining work.

---

## 1. The current model, precisely

### 1.1 Three categories, two mechanisms

| Category | Mechanism | Count | Lifecycle entry points | Example |
| --- | --- | --- | --- | --- |
| **Core renderer** | `wasm-bindgen` (not Extism) | 1, fixed | `initialize`/`set_data`/`render`/… direct calls | Vellum |
| **Interpreter** (viewport) | Extism, `loadPlugin` | 1 per project | `on_init`, `on_resolve`, `on_selection_change`, `on_field_update` | Charter |
| **Utility** | Extism, `loadUtilityPlugin` | many, install-level | `on_init` + arbitrary on-demand exports via `callUtilityPlugin(name, fn, payload)` | Fontavious (`eager`), Tenner (`lazy`) |

- **Vellum is deliberately not a plugin** (`PLUGINS.md` §"Core renderer"): it owns the WGPU
  canvas, loaded directly. Replaceable *in principle* (VISION 1st Principle) but not through the
  store — out of scope here.
- **Interpreter** occupies a single slot: `activePlugin` in `manager.svelte.ts`. `loadPlugin`
  overwrites it unconditionally (that's why utility plugins live in a separate `Map` — a second
  `loadPlugin` would evict Charter; see CLAUDE.md §4).
- **Utility** plugins never touch `activePlugin`/the resolve loop. Each has its own serial call
  chain keyed by name (`utilityQueues`) — Extism instances aren't re-entrant.

### 1.2 Where each boundary lives (responsibility map)

```
PGlite            persistent state + the `plugins` registry rows + projects.interpreter_plugin_id
  │
Manager           resolve/api; registerPlugin / listPlugins / get+setProjectInterpreter;
  │               exportProject / importProjectData (reached via host fns)
  │
Editor host       PluginManager (manager.svelte.ts): load/evict, host-fn impls, serial queues,
  │               debounce/generation guards; the "agnosticism seams" (§3)
  │
Extism plugins    sandboxed translation/data logic (Charter, Fontavious, Tenner)
  │
Vellum            UiNode[] → pixels
```

Invariants that keep these clean (all in CLAUDE.md, do not regress):
- Resolver is **name-neutral** about composition (`view-list` type, never the string `children`).
- Charter declares *opinions* (`composition_field_keys`, `ops`); host does generic graph math.
- Editor never names a provider plugin (§3); plugins never name each other.
- `hints.<plugin-name>` namespacing isolates per-plugin per-view metadata.

### 1.3 The registry (DB `plugins` table)

Defined in `manager/src/migrations/2026-04-21/index.ts`, typed in `manager/src/schema.ts`,
accessed via `QueryPlugin` in `manager/src/api/index.ts`:

```
plugins(
  id, name (unique), kind: 'interpreter'|'utility',
  activation: 'eager'|'lazy'|null,        -- only meaningful for utility
  manifest: jsonb  { wasm: [{ url }] },   -- that's the ENTIRE manifest shape today
  options:  jsonb  Record<string,unknown> -- passed straight to Extism createPlugin
  content_hash: text                       -- SHA-256 of the deployed wasm; set, never read yet
)
projects.interpreter_plugin_id → plugins.id   (the one per-project plugin choice)
```

- **`registerPlugin` is upsert-by-name** — re-registering refreshes manifest/options/hash in
  place. This is already the "install" primitive; it just isn't reachable from any UI.
- **Built-ins are registered in code**: `manager/src/plugins-bootstrap.ts`
  (`registerBuiltinPlugins`) hardcodes charter/fontavious/tenner manifests, options, activation,
  and computes `content_hash` via `hashUrl`. This runs at app bootstrap.
- **`options` today carries Extism runtime config only** — Fontavious's
  `{ allowedHosts: ['fonts.gstatic.com','cdn.fontshare.com'] }`. No plugin-domain/user config
  lives anywhere.

### 1.4 Load paths

- **Interpreter**: `Editor.svelte` `$effect` on `activeProjectId` → `getProjectInterpreter` →
  `loadPlugin(manifest, name)`. Skips if already loaded (`loadedInterpreterName`).
- **Eager utility**: `Editor.svelte` `onMount` → `listPlugins()` → for each
  `kind==='utility' && activation==='eager'` → `loadUtilityPlugin(manifest, name, options)`.
- **Lazy utility**: not loaded at boot; `callUtilityPlugin` → `ensureUtilityPluginLoaded` loads
  it from the catalogue on first actual call (Tenner, for Export/Import).

---

## 2. The capability surface (what a plugin can actually touch)

**This is the security/permission model, and right now it is all-or-nothing.**
`makeHostFunctions(pluginName)` (`manager.svelte.ts`) returns the *same complete set* to every
plugin regardless of kind. The full grantable surface:

| Host fn | Grants the ability to… | Sensitivity |
| --- | --- | --- |
| `kit10_log` | write to console | none |
| `kit10_kv_get`/`set` | in-memory per-plugin KV (per load, not persisted) | none |
| `kit10_font_cache_get`/`put` | read/write the shared IndexedDB font-byte cache | low |
| `kit10_get_resolution` | read the active view's resolved kits | reads design data |
| `kit10_get_project_export` | dump an **entire project** (views/kits/axes/layers/tokens) | reads everything |
| `kit10_import_project_data` | **create a new project** from a blob | writes everything |
| `kit10_write_render_entry_to_layer` | **mutate any layer's property** by id | writes design data |
| `kit10_set_viewport_data` | push arbitrary UiNode[] to the canvas | drives the renderer |
| `kit10_panel_publish` | publish a `PanelManifest` into editor `$state` (drives panels) | drives UI |
| `allowedHosts` (Extism option) | sandboxed HTTP to an explicit host allowlist | **network egress** |

Today a font-search utility can call `kit10_import_project_data` or overwrite layers. Fine for
three first-party plugins; a real liability the moment the store admits third-party wasm.
`allowedHosts` is the *only* capability that is currently scoped per plugin — and it's scoped
because Extism forces it to be, not by our design.

---

## 3. The agnosticism seams — where "which plugin does X" is decided

VISION 1st Principle: a plugin declares *what kind* of thing a field/target is; a **separate
editor/project mapping** decides *which plugin serves it*. These mapping points are the config
surface the store must own. Today they are **hardcoded TypeScript compiled into the editor**:

| Seam | File | Shape | To swap a provider today |
| --- | --- | --- | --- |
| Suggestions | `src/lib/plugins/suggestion-providers.ts` | `inputType → { plugin, searchFn, fetchFn }` | edit TS + redeploy |
| Export | `src/lib/plugins/project-export-providers.ts` | `{ id, label, fn, fileExtension, mimeType }[]` | edit TS + redeploy |
| Import | `src/lib/plugins/project-import-providers.ts` | `{ id, label, fn, accept }[]` | edit TS + redeploy |

Other, healthier seams already data-driven (keep these):
- **Panel manifests** (`kit10_panel_publish`): plugin ships `composition_field_keys`, per-item
  `ops`, `header_ops` — the editor's Views panel is a generic renderer over them.
- **`FieldDef.inputType`/`suggestionsFrom`**: Charter marks field *kind*; never a provider name.
- **`hints.<plugin>`**: per-view plugin metadata, namespaced by plugin name.

The export/import providers are gated by "is this plugin installed?" (`Project.svelte`
`availableExportProviders`/`availableImportProviders` filter `listPlugins()` by name). Note the
**UI already anticipates the store**: `Project.svelte` shows a disabled *"Check Store for
Options"* item when no provider is installed, and `Plugins.svelte`'s context menu has an
*"Import Plugin"* entry wired to a no-op `onClick`.

---

## 4. Gaps the store must close

Ordered roughly by how load-bearing they are for "add + configure plugins".

1. **No install/add path.** Rows only ever come from the hardcoded `registerBuiltinPlugins`.
   The primitive exists (`registerPlugin` upsert-by-name), and the manifest already supports a
   remote `{ url }`. Missing: a UI + a source (paste a URL / pick a `.wasm` + descriptor) that
   calls `registerPlugin`, plus a notion of an **available** (not-yet-installed) catalogue vs.
   the **installed** set (`listPlugins` only knows installed).

2. **Provider mappings are code, not data.** The three seams in §3 are compiled TS. To add a
   plugin that serves `icon` suggestions, or a new export target, *without recompiling the
   editor*, these mappings must be **derived from installed plugins' declared capabilities** in
   the registry — resolved at runtime. This is the single biggest contradiction between the
   current shape and the store goal. VISION 3rd Principle already frames the target ("Plugins
   declare export capabilities; users define an Export Profile specifying which plugin handles
   which target").

3. **`manifest` is `{ wasm: [{url}] }` and nothing else.** It carries no identity metadata
   (display name, version, author, description, icon), no declared capabilities, no config
   schema, no provider declarations, no compat range. Every one of those currently lives either
   in hardcoded editor TS or nowhere. The store needs a richer **plugin descriptor**.

4. **Configuration surface is ad hoc and conflated.** `options` is an untyped bag passed
   straight to Extism, mixing *host-controlled runtime options* (`allowedHosts`, `runInWorker`
   — security-sensitive, not user-editable) with what *would be* plugin-domain config (there is
   none yet). A store that "configures" plugins needs: (a) a plugin-declared **config schema**
   (typed fields the user sets), (b) **storage** for user-set values, (c) a clean split from
   Extism runtime options, (d) a settings UI, (e) a **reload-on-reconfigure** flow (Extism bakes
   options at `createPlugin` time — changing them means re-instantiating; `loadUtilityPlugin`
   already replaces-by-name so this is feasible).

5. **All-or-nothing capabilities (§2).** No declared/granted permission model. For third-party
   plugins the store should: have the descriptor **request** capabilities (host fns + hosts),
   surface them at install ("this plugin wants: network to X, write design data"), and have
   `makeHostFunctions` hand each plugin **only its granted subset**.

6. **Kind taxonomy is thin.** Only `interpreter`|`utility`. "Render target / export" plugins are
   really utility plugins (Tenner) whose role is only expressed by their presence in the
   hardcoded provider lists. Consider whether role should be **capability tags on the descriptor**
   (`serves: suggestions[font]`, `exports: [yaml]`, `interprets: viewport`) rather than a single
   `kind` enum — a plugin could then both interpret *and* export.

7. **No compat/versioning contract.** `content_hash` is computed but never *read*. The wire
   format has no version marker anywhere (CLAUDE.md's Oklab note: "shape is the only safety
   net"). A store distributing third-party wasm across host versions needs an explicit
   **wire-format version + min-host-version** in the descriptor, checked at install/load.

8. **Trust/provenance/integrity.** Built-ins are same-origin (`/charter.wasm`). Remote wasm
   from a store needs integrity (pin/verify against `content_hash`), origin trust signposting,
   and the awareness that the Extism sandbox + capability grants (§5) are the actual containment
   — `allowedHosts` and the host-fn set are the escape hatches to gate.

9. **`kit10_kv_*` is per-load, not persistent.** `localKV` is a fresh `Map` per
   `makeHostFunctions` call. Any plugin needing durable state across reloads (a store-installed
   plugin caching config/derived data) has only the font cache today. A general persistent,
   per-plugin KV (namespaced, like the font cache is) is likely needed.

---

## 5. Recommended direction

Keep everything in §1.2/§3 that's already data-driven; move the hardcoded seams into the
registry; add a capability model. Concretely:

### 5.1 A richer plugin **descriptor** (extend `manifest`)

Have the plugin ship (or the store index carry) a descriptor beyond `{ wasm }`:

```
{
  wasm: [{ url, integrity? }],
  identity: { displayName, version, author, description, icon? },
  compat:   { wireFormat: <n>, minHost: <semver> },
  capabilities: {                    // what it REQUESTS; install grants
    hostFns: ["kit10_write_render_entry_to_layer", ...],
    hosts:   ["fonts.gstatic.com", ...]   // becomes Extism allowedHosts if granted
  },
  provides: {                        // replaces the hardcoded provider TS (§3)
    interprets?: true,                       // an interpreter
    suggestions?: [{ inputType: "font", searchFn, fetchFn? }],
    exports?: [{ label, fn, fileExtension, mimeType }],
    imports?: [{ label, fn, accept }]
  },
  config?: <JSON-schema-ish>          // typed user-config fields
}
```

`suggestion-providers.ts` / `project-*-providers.ts` then become **runtime resolvers over
`listPlugins()`** (build the `inputType → provider` map, the export/import lists, from installed
descriptors' `provides`) — deleting the compile-time lists. The lookup functions
(`resolveSuggestionSource`) keep their signatures; only their source changes from a const to the
registry. This is *more* aligned with VISION 1st Principle, not less: the mapping becomes data.

### 5.2 Capability grants

`makeHostFunctions(pluginName)` becomes `makeHostFunctions(pluginName, grantedCaps)` and returns
only the granted subset. Install/config is where a user grants (with the descriptor's requests
pre-checked and the sensitive ones — network, project import/write — called out). `allowedHosts`
flows from `capabilities.hosts` ∩ granted, exactly as it does today, just declared not hardcoded.

### 5.3 Config storage + reconfigure

- Add a `config: jsonb` column to `plugins` (or a `plugin_config(plugin_id, project_id?, value)`
  table if config should be per-project). Keep it **separate** from `options` (Extism runtime).
- A settings UI renders the descriptor's `config` schema; saving writes `config` and triggers a
  **reload** (`loadUtilityPlugin` already replaces-by-name; interpreters reload via the existing
  `activeProjectId` effect path).
- `on_init` gains the resolved config in its input, or a `kit10_get_config` host fn is added.

### 5.4 Store surface (UI)

- **Installed** = `listPlugins()` (exists). **Available** = a remote index of descriptors
  (new). The store panel lists both; install = fetch descriptor → `registerPlugin`.
- Repurpose the existing placeholders: `Plugins.svelte`'s "Import Plugin" and `Project.svelte`'s
  "Check Store for Options" are the natural entry points already stubbed in.
- Export Profiles (VISION 3rd Principle) sit on top of §5.1's `exports` — a user mapping of
  target → plugin, stored per project.

### 5.5 What NOT to change

- The interpreter-single-slot + utility-on-demand split — it works and the eviction is
  understood.
- Panel manifests, `hints` namespacing, `inputType` indirection, `content_hash` groundwork,
  `registerPlugin` upsert-by-name — all already the right shape.
- Vellum staying out of the plugin system.

---

## 6. Open questions to settle before building

1. **Config scope** — per-install (global) or per-project? (Interpreter choice is per-project;
   Fontavious/Tenner are install-level. Config probably needs both scopes.)
2. **Capability granularity** — grant per host-fn (fine-grained, more prompts) or per bundled
   role (coarser, fewer prompts)? Leaning role-bundles surfaced *as* the requested host-fns.
3. **Does `kind` survive** or dissolve into capability tags (§4.6)? A plugin that both interprets
   and exports argues for tags.
4. **Descriptor source of truth** — embedded in the wasm (a `describe()` export the host calls
   once), a sidecar JSON in the manifest, or the store index? (A `describe()` export keeps the
   plugin self-describing and can't drift from the binary — analogous to how Charter already
   self-describes its field categories via `on_resolve`.)
5. **Remote wasm trust** — pin `content_hash` at install and verify on every load? Origin
   allowlist for wasm sources?
6. **Wire-format versioning** — introduce an explicit version now (the Oklab shape-only safety
   net won't scale to third-party authors on different host versions).
