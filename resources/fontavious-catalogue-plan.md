# Fontavious Catalogue Expansion — a plan

> Status: **BUILT & merged to main** (2026-07-17). All phases below shipped —
> the catalogue is now **146 families** (was ~19), generated with italics +
> categories (`generate-catalogue.mjs`), spanning Google (OFL) + Fontshare
> (free-proprietary), with trademark-safe exact `aliases` + visual `looksLike`
> name resolution and a persistent IndexedDB byte cache. Per-phase status is
> marked in §6. This doc is kept as the design record + rerun guide; where a
> phase says ✅ SHIPPED, the code is the source of truth
> (`plugins/fontavious/src/lib.rs`, `catalogue.json`, `generate-catalogue.mjs`).
> Background, licensing, and delivery-API detail live in
> `resources/nature-of-fonts.md`.

---

## 1. The core idea — two layers that grow at different rates

The catalogue splits into two layers. Everything expensive lives in the small
one; everything a _user can type_ lives in the cheap one.

| Layer                | What it is                                                                    | Cost to add one                  | How fast it should grow         |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------- | ------------------------------- |
| **Renderable roots** | Families we actually fetch bytes for (one variable WOFF2 each where possible) | A URL + a fetch/cache slot       | **Slowly** — curated, ~200–250  |
| **Names / aliases**  | Recognized font names that _render via_ a root — proprietary names included   | ~one JSON line, no URL, no fetch | **Freely** — hundreds are ~free |

The renderable roots are the only thing that grows the fetch surface, the
`§7`-cache (see `nature-of-fonts.md`), the download payload, and the
per-family fetch cost of search. The alias layer grows the **namespace** a
user can type — every proprietary name a designer arrives expecting — at
roughly one JSON line each. A user who types "Helvetica," "SF Pro,"
"Calibri," or "Times New Roman" gets a hit, and we ship **zero** new font
files for any of them.

**Growth is bounded by the number of distinct _designs_, not by the number of
_names users expect_.** That is the whole strategy.

---

## 2. Formalizing "some fonts are identical to several others"

Two distinct relationships, both of which collapse many names onto one file.

### 2.1 Metric-compatible clones (layout-safe)

Fonts engineered to share _identical_ advance widths and line metrics — swap
one for another and text does not reflow. There is a free OFL clone for every
core Microsoft/system font, so the **entire system-font namespace costs 6
renderable files**:

| User types                                     | Rendered via (OFL root) | Metric fidelity                    |
| ---------------------------------------------- | ----------------------- | ---------------------------------- |
| Arial, Helvetica, Liberation Sans, Nimbus Sans | **Arimo**               | exact                              |
| Times New Roman, Times, Liberation Serif       | **Tinos**               | exact                              |
| Courier New, Consolas\*                        | **Cousine**             | exact (Courier), approx (Consolas) |
| Calibri                                        | **Carlito**             | exact                              |
| Cambria                                        | **Caladea**             | exact                              |
| Georgia                                        | **Gelasio**             | exact                              |

Arimo/Tinos/Cousine/Carlito/Caladea/Gelasio become OFL **roots** (real files);
every proprietary name above is a cheap **alias** onto one of them. This is
the single highest value-per-byte move in the whole plan: it covers the names
Figma/Webflow docs reference constantly, for six files.

### 2.2 Visual look-alikes (approximate — may reflow)

Popular proprietary display/brand fonts with a strong free cousin that is
_not_ metric-identical. These render, but layout can shift, so they are badged
approximate rather than leaned on:

| User types                       | Rendered via              |                                   |
| -------------------------------- | ------------------------- | --------------------------------- |
| SF Pro, Helvetica Neue, Segoe UI | Inter (Selawik for Segoe) | ≈ visual                          |
| Gotham, Proxima Nova             | Montserrat                | ≈ visual                          |
| Futura, Avenir                   | Jost / Nunito             | ≈ visual                          |
| Myriad Pro                       | Source Sans 3             | ≈ visual (designed as a relative) |
| Circular, DIN                    | Manrope / Saira           | ≈ visual                          |

The **metric vs. visual** distinction matters: metric aliases are layout-safe;
visual ones can reflow. It is modelled as **two flat lists** on the root (§4) —
`aliases` (exact/metric, noted "matches X") and `looksLike` (visual, noted
"approximates X" with a caution tone). Both shipped.

### 2.3 The judgment call: don't over-collapse

Metric-clones and proprietary look-alikes fold aggressively. **Genuinely
distinct OFL designs stay separate even when similar** — a user wants _both_
Inter and Roboto even though they rhyme. Dedup targets clones and
substitutes; it never collapses distinct choices a designer would pick between.

---

## 3. Two separate legal questions — copyright AND trademark

There are **two** distinct exposures, and they need different answers.

**Copyright / redistribution** — handled by shipping no proprietary bytes.
`licenseTier` on each **root** governs this:

| Tier                                  | Fetch bytes?   | Bundle in export?    |
| ------------------------------------- | -------------- | -------------------- |
| `ofl`                                 | yes            | yes (+ license file) |
| `free-proprietary` (Fontshare closed) | yes (cache OK) | **no** — link only   |
| `upload`                              | user supplies  | user's call          |

**Trademark** — a font _name_ like "Arial", "Times New Roman", "Calibri" is a
registered mark (Monotype, Microsoft, …). This is **not** covered by "we don't
ship the bytes." Naming a catalogue _product_ "Arial" — presenting it as a font
we offer — risks trading on the mark, even with a substitution badge. Nobody
legitimate does this: Google Fonts ships **Arimo**, never "Arial," and only
_describes_ it as "metric-compatible with Arial."

So proprietary names are **not catalogue entries and not a `licenseTier`**.
They are **aliases attached to the OFL root** — search/import keys only:

- The catalogue _product_ is always the OFL font. The picker shows **"Arimo"**,
  never a row titled "Arial."
- Typing "Arial" _finds_ Arimo (alias match), labelled "Arimo" with a
  referential **"matches Arial"** note. A design that references
  `font-family: Arial` _resolves_ to Arimo. Pure interoperability.
- The trademark appears **only referentially** ("matches Arial"), never as our
  product's identity — the same nominative use OS font substitution
  (fontconfig `Arial → Liberation Sans`) and Google Fonts' own descriptions
  rely on.

This keeps the two-layer value (a Figma refugee typing "Arial" gets a hit,
imports resolve) while staying in the nominative-use lane. Real bytes for an
actual proprietary font only ever arrive via **user upload** of a file they
license (`nature-of-fonts.md` §3.2 lane 2 / §6.5).

> **Not legal advice.** Monotype in particular enforces aggressively around
> Arial/Helvetica. The alias-only framing matches industry practice, but a
> commercial launch should get a quick IP-counsel pass on the name list.

---

## 4. Schema extension

There is only ever **one** record type — the renderable root — plus tags and
**two** alias lists. No separate alias/proprietary record exists; a trademarked
name never becomes a `family`.

```jsonc
// renderable root — licenseTier + category + aliases (+ optional looksLike)
{
	"family": "Montserrat",
	"vendor": "google",
	"licenseTier": "ofl",
	"category": "sans",
	"aliases": [], // exact / metric-compatible names (e.g. Arimo: ["Arial", "Helvetica"])
	"looksLike": ["Gotham", "Proxima Nova"], // visual / approximate look-alikes
	"variants": [{ "weightMin": 400, "weightMax": 700, "style": "normal", "url": "..." }]
}
```

- `aliases: string[]` — **exact / metric-compatible** alternative names.
  Surfaced as "matches X". Arimo carries `["Arial", "Helvetica", …]`.
- `looksLike: string[]` — **visual / approximate** look-alikes (Phase 5, §2.2).
  Not metric-identical (text can reflow), so surfaced as "approximates X" with
  a caution tone. Both lists are search + import-match keys, used referentially
  only (§3); the picker always labels the row with `family`, never an alias.
- Two flat lists rather than one `(string | {name, reason})[]` union: simpler
  JSON, simpler parsing, and the exact/visual split IS the only distinction
  that mattered. (Supersedes the earlier "per-alias `reason`" sketch.)
- `licenseTier` (default `ofl`), `category` — on the **root**. The ~13
  pre-existing entries omit them and default correctly; new roots set them.

Preserve the existing invariants: `weightMin..weightMax` still models
variable-range vs. static-discrete correctly per root (getting it wrong
refights the bug Charter's `resolve_font_weight` papers over), and every
`style` variant still needs its own entry — **italics are a first-class gap
to close**, the current catalogue is normal-only.

---

## 5. Resolution behavior — alias matching stays inside Fontavious

The catalogue owner resolves aliases; callers only ever deal in the OFL root.

- **`find_entry`** matches the query against a `family`, an exact `aliases`
  name, OR a visual `looksLike` name — precedence family > alias > looksLike, so
  a real name always wins and an exact clone beats an approximate. It returns
  the root that owns the file. `find_matching_variant` / `variant_url` /
  `family_facts` all go through it, so Charter and the editor's scan ask for
  "Arial" (or "Gotham") and transparently get the root's URL/bytes/facts. A
  visual match resolves for rendering identically to an exact one — the
  approximate-ness is only a _disclosure_, never a resolution difference.
  The cache keys on the _root's_ URL, so "Arial",
  "Liberation Sans", and "Arimo" share one cached file — free dedup, same as
  variable-weight dedup.
- **`search_catalogue`** matches family + `aliases` + `looksLike`, but always
  emits the root's own name as `value`/`label` ("Montserrat"). An exact-alias
  match adds **`note: "matches Arial"`**; a visual match adds
  **`note: "approximates Gotham"` + `tone: "warn"`** (the picker tints it as a
  caution); a direct family match has no note. Nothing in the results is ever
  titled with a trademark.
- **`family_facts`** reports the **root's** real weight ranges, so Charter's
  weight-snapping is correct for what actually renders.

Everything above is additive to the existing exports; no caller outside
Fontavious changes shape. Badges (`badge`/`tone`) remain wired for the future
`free-proprietary` (Fontshare) tier; §5.1 covers why the slots are generic.

### 5.1 Two shapes — keep the editor contract plugin-agnostic

There are two distinct shapes here, and only one is a cross-plugin contract.
This matters because a future provider plugin (e.g. a **Font Awesome** icon
plugin) must be able to feed the same editor UI without inheriting any of
Fontavious's font-specific vocabulary (VISION.md 1st Principle; the
`feedback-editor-plugin-agnosticism` memory).

- **Fontavious's internal catalogue shape** (`licenseTier`, `aliases`,
  `category`, `weightMin/Max`, `variants`, `url` — §4) is the plugin's
  **private data**. The editor never reads `catalogue.json`; it only ever
  sees the _outputs_ of `search_fonts`/`fetch_font`/`variant_url`. A Font
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
slots the editor defines**, which each plugin _projects into_ — never
font-specific fields on the shared type:

```ts
// editor-owned, plugin-agnostic (SuggestField.svelte)
type SuggestionEntry = {
	value: string;
	label?: string;
	badge?: string; // "PROPRIETARY", "BRANDS", "PRO"… — a short opaque tag
	tone?: 'neutral' | 'info' | 'warn'; // generic emphasis, no domain meaning
	note?: string; // "matches Arial", "≈ approximate"
};
```

Fontavious maps an alias match → `{ note: "matches Arial" }`, and (future) a
`free-proprietary` root → `{ badge: "free", tone: "info" }`. A Font Awesome
plugin maps `style: "brands"` → `{ badge: "brands" }`. **The editor renders
`badge`/`tone`/`note` without knowing what a font, a license, or an icon is**
— the words `licenseTier`/`alias`/`font` never appear in the generic contract.
(This corrects an earlier draft that put a font-specific `tier` field directly
on `SuggestionEntry` — `tier` is a font word and does not belong on the shared
type.)

---

## 6. Build phases

1. **Schema + alias matching (Phase 0). ✅ SHIPPED** (branch
   `feat/fontavious-catalogue-aliases`). Added `licenseTier`/`category`/
   `aliases` to `CatalogueEntry`; `find_entry` matches family + aliases;
   `search_catalogue` surfaces the OFL root with a "matches X" note; the
   editor's `SuggestionEntry` gained generic `badge`/`tone`/`note` slots.
   Shipped **together with Phase 3's 6 clone roots** as one vertical slice.
2. **Generated OFL core.** Run the `nature-of-fonts.md` §6.2 pipeline
   (`google-font-metadata` + CSS2 UA URL resolution) to produce ~200 genuinely
   distinct families — variable files where they exist, **italics included**,
   `category` tagged, `licenseTier: ofl`. This is the real renderable set;
   replaces hand-authoring.
3. **Metric-clone roots + aliases (§2.1). ✅ SHIPPED with Phase 0.** The 6 clone
   roots (Arimo/Tinos/Cousine/Carlito/Caladea/Gelasio) carry the proprietary
   system-font names as `aliases`. Entire MS/system namespace, 0 files beyond
   the 6 roots, no trademarked product names.
4. **Fontshare premium-free tier. ✅ SHIPPED.** 12 headliners (Satoshi, General
   Sans, Clash Display/Grotesk, Cabinet Grotesk, Switzer, Sentient, Zodiak,
   Chillax, Supreme, Melodrama, Ranade) — `free-proprietary`,
   `vendor: "fontshare"`, `cdn.fontshare.com` added to `allowedHosts`
   (plugins-bootstrap.ts). The generator's `resolveFontshare` uses Fontshare's
   no-weights CSS form (whole family incl. italics in one request); badged
   `free`/`info` in the picker. The Framer/Webflow flavor Google lacks.
5. **Visual look-alike aliases (§2.2). ✅ SHIPPED.** A `looksLike` list on 7
   roots maps the proprietary display/brand names (SF Pro, Helvetica Neue,
   Segoe UI → Inter; Gotham, Proxima Nova → Montserrat; Futura → Jost; Avenir →
   Nunito Sans; Myriad Pro → Source Sans 3; Circular → Manrope; DIN → Saira),
   surfaced as "approximates X" with a caution tone. Two-field design, not the
   per-alias `reason` union originally sketched.

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
