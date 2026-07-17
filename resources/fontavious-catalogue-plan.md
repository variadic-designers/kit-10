# Fontavious Catalogue Expansion — a plan

> Status: **plan, not built.** The catalogue today is ~40 families, ~95 lines
> of hand-authored JSON (`plugins/fontavious/catalogue.json`), normal-style
> only, Google-only, and every URL hand-pasted. This doc is the strategy to
> grow it into something a Figma/Framer/Webflow refugee feels at home in —
> **including proprietary font names, clearly marked as such** — without
> growing the expensive part (font files, fetch surface, cache). Background,
> licensing, and delivery-API detail live in `resources/nature-of-fonts.md`;
> the schema/code that exists today is `plugins/fontavious/src/lib.rs` and
> CLAUDE.md's Fontavious section. This doc assumes both.

---

## 1. The core idea — two layers that grow at different rates

The catalogue splits into two layers. Everything expensive lives in the small
one; everything a *user can type* lives in the cheap one.

| Layer | What it is | Cost to add one | How fast it should grow |
|---|---|---|---|
| **Renderable roots** | Families we actually fetch bytes for (one variable WOFF2 each where possible) | A URL + a fetch/cache slot | **Slowly** — curated, ~200–250 |
| **Names / aliases** | Recognized font names that *render via* a root — proprietary names included | ~one JSON line, no URL, no fetch | **Freely** — hundreds are ~free |

The renderable roots are the only thing that grows the fetch surface, the
`§7`-cache (see `nature-of-fonts.md`), the download payload, and the
per-family fetch cost of search. The alias layer grows the **namespace** a
user can type — every proprietary name a designer arrives expecting — at
roughly one JSON line each. A user who types "Helvetica," "SF Pro,"
"Calibri," or "Times New Roman" gets a hit, and we ship **zero** new font
files for any of them.

**Growth is bounded by the number of distinct *designs*, not by the number of
*names users expect*.** That is the whole strategy.

---

## 2. Formalizing "some fonts are identical to several others"

Two distinct relationships, both of which collapse many names onto one file.

### 2.1 Metric-compatible clones (layout-safe)

Fonts engineered to share *identical* advance widths and line metrics — swap
one for another and text does not reflow. There is a free OFL clone for every
core Microsoft/system font, so the **entire system-font namespace costs 6
renderable files**:

| User types | Rendered via (OFL root) | Metric fidelity |
|---|---|---|
| Arial, Helvetica, Liberation Sans, Nimbus Sans | **Arimo** | exact |
| Times New Roman, Times, Liberation Serif | **Tinos** | exact |
| Courier New, Consolas* | **Cousine** | exact (Courier), approx (Consolas) |
| Calibri | **Carlito** | exact |
| Cambria | **Caladea** | exact |
| Georgia | **Gelasio** | exact |

Arimo/Tinos/Cousine/Carlito/Caladea/Gelasio become OFL **roots** (real files);
every proprietary name above is a cheap **alias** onto one of them. This is
the single highest value-per-byte move in the whole plan: it covers the names
Figma/Webflow docs reference constantly, for six files.

### 2.2 Visual look-alikes (approximate — may reflow)

Popular proprietary display/brand fonts with a strong free cousin that is
*not* metric-identical. These render, but layout can shift, so they are badged
approximate rather than leaned on:

| User types | Rendered via | |
|---|---|---|
| SF Pro, Helvetica Neue, Segoe UI | Inter (Selawik for Segoe) | ≈ visual |
| Gotham, Proxima Nova | Montserrat | ≈ visual |
| Futura, Avenir | Jost / Nunito | ≈ visual |
| Myriad Pro | Source Sans 3 | ≈ visual (designed as a relative) |
| Circular, DIN | Manrope / Saira | ≈ visual |

The **metric vs. visual** distinction is recorded per alias (`substitute.reason`)
and matters: metric substitutions are layout-safe; visual ones must be flagged
approximate in the UI because glyph widths differ.

### 2.3 The judgment call: don't over-collapse

Metric-clones and proprietary look-alikes fold aggressively. **Genuinely
distinct OFL designs stay separate even when similar** — a user wants *both*
Inter and Roboto even though they rhyme. Dedup targets clones and
substitutes; it never collapses distinct choices a designer would pick between.

---

## 3. License tiers — how proprietary is marked, and why it's safe

Four-tier `licenseTier`. The load-bearing rule: **proprietary entries are
name-only — no URL, we never fetch, cache, or ship their bytes.**

| Tier | Fetch bytes? | Bundle in export? | In catalogue as |
|---|---|---|---|
| `ofl` | yes | yes (+ license file) | renderable root |
| `free-proprietary` (Fontshare closed) | yes (cache OK) | **no** — link only | renderable root |
| `proprietary` | **no** | **no** | **name + `substitute` pointer only** |
| `upload` | user supplies | user's call | runtime, not catalogued |

So "Arial" lives in the catalogue as
`{ family: "Arial", licenseTier: "proprietary", aliasOf: "Arimo",
substitute: { reason: "metric" } }` — acknowledged, resolvable, clearly
flagged, with **no Arial bytes anywhere**. Real bytes for a proprietary font
only ever arrive when the *user uploads their own licensed file*
(`nature-of-fonts.md` §3.2 lane 2 / §6.5); until then we render the marked
substitute.

**Why listing proprietary names is fine.** We ship Arimo (OFL) and *label* the
user's intent — we do not ship Arial. Recognizing a font *name* as an input
and rendering a free substitute is interoperability / nominative use, exactly
what LibreOffice, ChromeOS, and Android do. Typeface *names* can be trademarks,
but acknowledging one as a recognized alias is not redistribution of the
*font*, which is the thing the licenses actually restrict.

This tier field is the same one `nature-of-fonts.md` §7.3 needs for the
cache export-guard and §6.4 wants for search faceting — one addition, three
consumers.

---

## 4. Schema extension

Renderable roots keep today's shape plus two tags; aliases are a new, cheap,
URL-less record shape.

```jsonc
// renderable root — today's shape + licenseTier + category
{ "family": "Arimo", "vendor": "google", "licenseTier": "ofl", "category": "sans",
  "variants": [
    { "weightMin": 400, "weightMax": 700, "style": "normal", "url": "https://fonts.gstatic.com/..." }
  ] }

// alias / proprietary name — no variants, no URL (a single cheap line)
{ "family": "Arial", "licenseTier": "proprietary", "category": "sans",
  "aliasOf": "Arimo", "substitute": { "reason": "metric" } }

// a same-license vendor rename is just an alias with no substitute
{ "family": "Liberation Sans", "licenseTier": "ofl", "aliasOf": "Arimo" }
```

- `aliasOf: string` — "render me via this root." Present ⇒ this entry has no
  bytes of its own; resolution follows it.
- `substitute: { reason: "metric" | "visual" }` — present on cross-family
  substitutions; drives the UI badge (metric = layout-safe, visual =
  approximate). Absent on a pure same-license rename.
- `licenseTier`, `category` — added to *every* entry (roots too).

Preserve the existing invariants: `weightMin..weightMax` still models
variable-range vs. static-discrete correctly per root (getting it wrong
refights the bug Charter's `resolve_font_weight` papers over), and every
`style` variant still needs its own entry — **italics are a first-class gap
to close**, the current catalogue is normal-only.

---

## 5. Resolution behavior — substitution stays inside Fontavious

The catalogue owner resolves aliases; callers never learn a substitution
happened.

- **`find_matching_variant` / `variant_url`** follow `aliasOf` to the root
  *before* range-matching. Charter and the editor's scan ask for "Arial" and
  get Arimo's URL/bytes. This keeps CLAUDE.md's "the scan asks Fontavious
  which URL" contract intact — the substitution is a catalogue detail, opaque
  to the scan's URL set and the cache key (the cache keys on the *root's* URL,
  so "Arial" and "Liberation Sans" and "Arimo" share one cached file — free
  dedup, same as variable-weight dedup).
- **`family_facts`** reports the **root's** real weight ranges, so Charter's
  weight-snapping is correct for what actually renders.
- **`search_fonts`** projects each alias's `licenseTier` + `substitute.reason`
  into the editor's **generic** suggestion contract so `SuggestField.svelte`
  can badge them ("proprietary · rendering Arimo", "≈ approximate"). This is
  the "marked as such" surface the user sees — see §5.1 for why it's generic.

Everything above is additive to the existing exports; no caller outside
Fontavious changes shape.

### 5.1 Two shapes — keep the editor contract plugin-agnostic

There are two distinct shapes here, and only one is a cross-plugin contract.
This matters because a future provider plugin (e.g. a **Font Awesome** icon
plugin) must be able to feed the same editor UI without inheriting any of
Fontavious's font-specific vocabulary (VISION.md 1st Principle; the
`feedback-editor-plugin-agnosticism` memory).

- **Fontavious's internal catalogue shape** (`licenseTier`, `aliasOf`,
  `substitute`, `weightMin/Max`, `variants`, `url` — §4) is the plugin's
  **private data**. The editor never reads `catalogue.json`; it only ever
  sees the *outputs* of `search_fonts`/`fetch_font`/`variant_url`. A Font
  Awesome plugin would have its own unrelated internal shape (icon names,
  `brands`/`solid`/`regular` styles). These never collide, because they are
  never a shared contract — so this half staying Fontavious-defined is
  correct, not a leak.

- **The editor-facing suggestion contract** (`SuggestionEntry`) is
  **editor-owned and must stay generic.** It already lives in
  `SuggestField.svelte` (`{ value, label? }`), and `resolveSuggestionSource`
  (the editor-owned `inputType → plugin` registry in
  `suggestion-providers.ts`) already dispatches agnostically — adding a Font
  Awesome provider is one line there (`icon: { plugin: 'fontAwesome', … }`),
  no editor recompile of anything else.

The badge/disclosure surface must therefore be expressed in **generic display
slots the editor defines**, which each plugin *projects into* — never
font-specific fields on the shared type:

```ts
// editor-owned, plugin-agnostic (SuggestField.svelte)
type SuggestionEntry = {
  value: string; label?: string;
  badge?: string;                        // "PROPRIETARY", "BRANDS", "PRO"… — a short opaque tag
  tone?: 'neutral' | 'info' | 'warn';    // generic emphasis, no domain meaning
  note?: string;                         // "rendering Arimo", "≈ approximate"
};
```

Fontavious maps `licenseTier: proprietary` + `substitute.reason: "metric"` →
`{ badge: "proprietary", tone: "warn", note: "rendering Arimo" }`. A Font
Awesome plugin maps `style: "brands"` → `{ badge: "brands" }`. **The editor
renders `badge`/`tone`/`note` without knowing what a font, a license, or an
icon is** — the words `licenseTier`/`substitute`/`font` never appear in the
generic contract. (This corrects an earlier draft of this plan that put a
`tier`/`note` pair directly on `SuggestionEntry` — `tier` is a font word and
does not belong on the shared type.)

---

## 6. Build phases

1. **Schema + resolver alias-following (Phase 0).** Add `licenseTier`,
   `category`, `aliasOf`, `substitute` to the types; teach
   `find_matching_variant` to follow `aliasOf`; thread `tier`/`note` through
   `search_fonts` → `SuggestField`. Small; unblocks everything else. Extend
   the existing catalogue tests (URL-host check generalizes to "roots have
   vendor URLs, aliases have none").
2. **Generated OFL core.** Run the `nature-of-fonts.md` §6.2 pipeline
   (`google-font-metadata` + CSS2 UA URL resolution) to produce ~200 genuinely
   distinct families — variable files where they exist, **italics included**,
   `category` tagged, `licenseTier: ofl`. This is the real renderable set;
   replaces hand-authoring.
3. **Metric-clone aliases (§2.1).** Add the 6 clone roots
   (Arimo/Tinos/Cousine/Carlito/Caladea/Gelasio) + the proprietary aliases
   onto them. Entire MS/system namespace, 0 files beyond the 6 roots.
4. **Fontshare premium-free tier.** Satoshi, General Sans, Clash Display/Grotesk,
   Cabinet Grotesk, Switzer, Ranade, Sentient, etc. — `free-proprietary`,
   `vendor: "fontshare"`, host added to the Extism `allowedHosts`. The
   Framer/Webflow flavor Google lacks.
5. **Visual-substitution aliases (§2.2).** The curated proprietary
   look-alike set, `substitute.reason: "visual"`, badged approximate.

**Target shape:** ~200–250 **renderable files** (the only thing that grows
fetch/cache/payload) backing **~500–600 typeable names** (the namespace, near
free). Regenerate the roots on a schedule (§6.4 of `nature-of-fonts.md`) so
gstatic version bumps don't rot the URLs.

---

## 7. What this deliberately defers

- **Per-glyph subsetting** for payload (fetch the Latin `unicode-range` face
  instead of the full multi-script face) — a lever for later if 250 variable
  files feels heavy; not needed to ship the plan.
- **Upload path** for real proprietary bytes — the long tail beyond any
  catalogue. Tracked in `nature-of-fonts.md` §6.5; catalogue breadth reduces
  how often it's needed, never eliminates it.
- **Non-Latin script coverage** — the substitution tables above are
  Latin-centric. A CJK/Arabic/Devanagari user needs Noto-family roots and
  their own substitution logic; out of scope for the first expansion.
