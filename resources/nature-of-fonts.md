# The Nature of Fonts — formats, licensing, delivery, and the future of Fontavious

> Research doc. Grounds KIT•10's font strategy (Fontavious + Vellum's
> `load_font`) in how fonts actually work, what the licenses actually say,
> and where fonts sit in a _build pipeline_ once KIT•10 exports to real
> frameworks. Written to answer three practical questions: **(1)** can we
> legally render a given font, **(2)** where do we get its bytes reliably,
> and **(3)** how does Fontavious grow from ~40 families to something a
> Figma/Framer/Webflow refugee feels at home in. See also
> `resources/text-affordances.md` (the weight/leading/align work) and
> CLAUDE.md's Fontavious + Vellum sections for the code that exists today.

---

## 1. What a font actually is

A font file is a container of **glyph outlines** plus the tables that map
characters to those outlines and describe how to lay them out. The pieces
that matter to us:

- **Outline format.** Two dialects live inside the OpenType wrapper:
  - `glyf` — TrueType quadratic Bézier outlines (`.ttf`).
  - `CFF`/`CFF2` — PostScript cubic Bézier outlines (`.otf`).
    Both are "OpenType" (`.otf`/`.ttf` are historical extensions, not a hard
    format boundary). Vellum doesn't care which — `swash`/`cosmic-text` rasterize
    either to a coverage bitmap for the glyph atlas.

- **Web containers.** `WOFF` and `WOFF2` are not new outline formats — they
  wrap an OpenType font with compression. WOFF2 uses Brotli tuned for font
  data and is dramatically smaller (a subset Lato-Regular is ~11 KB as WOFF2
  vs ~120 KB as raw TTF). **WOFF2 is what every web vendor serves and what
  Fontavious fetches** — it is universally supported and the smallest wire
  form. Vellum's font loader takes the decompressed OpenType bytes; the JS
  side hands WOFF2 straight to `vellum.load_font()`, which decompresses
  internally (swash/ttf-parser handle WOFF2 unwrapping).

- **Character map (`cmap`).** Unicode codepoint → glyph id. This is what a
  subset trims.

- **Variable fonts.** A single file carrying one or more continuous **axes**
  (`wght`, `wdth`, `opsz`, `slnt`, `ital`, plus custom axes) interpolated
  from named masters. One variable file at `wght 400..700` replaces what used
  to be four static weight files — _this is the fact Fontavious's
  `weightMin`/`weightMax` range models_ (CLAUDE.md's catalogue note). A true
  variable font serves **any** weight in its range from **one URL**; a
  static-only family (Lato, Poppins from Google) is the degenerate case:
  one file per discrete weight, `weightMin == weightMax`.

- **Hinting / metrics.** `post`, `OS/2`, `hhea` carry the ascent/descent,
  underline/strikethrough offset+thickness (which cosmic-text reads back for
  our text-decoration rendering — see text-affordances Phase 3), and the
  weight-class metadata the CSS font-matching algorithm snaps against.

### How KIT•10 renders differently from a browser

This distinction drives everything downstream. A browser is handed a
`@font-face` URL and does its own fetch + shaping + rasterization inside a
sandbox the user never touches. **KIT•10 fetches the raw font bytes into
memory and rasterizes them itself** (Vellum's GPU glyph atlas via
swash/cosmic-text). We hold the actual font file, however briefly. That is a
materially different act from a browser's `@font-face` load, and it is the
crux of the licensing analysis in §3 — we are closer to an _application
embedding a font_ than to a _website linking one_.

---

## 2. Font licensing — the landscape

Font licenses split into a small number of families. The axis that matters
for us is **"may I redistribute the file, and does rendering/embedding count
as redistribution?"**

### 2.1 Open licenses (the safe zone)

- **SIL Open Font License (OFL 1.1)** — the dominant open font license
  (most of Google Fonts, all of Fontshare's open tier). Key facts:
  - Free to use, study, modify, embed, bundle, and **redistribute** —
    including in commercial products and _sold_ software.
  - The one real restriction: you may **not sell the fonts by themselves**,
    and derivatives may not use the original's **Reserved Font Name**.
  - Crucially, **the OFL explicitly does not treat embedding a font in a
    document/file as "distribution"** — so a KIT•10 project that embeds an
    OFL font, or a browser rendering it via `@font-face`, is unambiguously
    fine. Bundling the WOFF2 into an exported build is _also_ fine (that's
    the sanctioned case), as long as we don't ship it as a standalone
    "download this font" product and we carry the OFL text alongside.
  - OFL fonts are **license-perpetual**: an OFL font can't be relicensed
    under anything else, so its terms never rug-pull.

- **Apache 2.0 / Ubuntu Font License** — a handful of families (older Roboto
  was Apache). Even more permissive than OFL for redistribution; no reserved
  name mechanic. Same practical bottom line: bundle freely, keep the notice.

**Bottom line for open fonts:** we may fetch them, cache them, render them,
_and_ bake them into an exported build. The only obligations are attribution
(ship the license file) and not selling the font in isolation. This covers
~100% of Google Fonts and Fontshare's catalogue.

### 2.2 "Free" proprietary (Fontshare's closed tier, many foundry freebies)

Fontshare's **closed-source** fonts are proprietary freeware under ITF's
**Free Font License (FFL)**: free for commercial and personal use, but the
foundry retains ownership and the file is _not_ OFL — modification and
standalone redistribution are constrained even though _use_ is free. For our
purposes these behave like open fonts **for rendering and web delivery** but
you should not assume the right to modify/subset-and-republish them; fetch
from the vendor, don't fork.

### 2.3 Commercial proprietary (the actual minefield)

Real commercial type (Monotype, Hoefler&Co, Klim, Commercial Type, most of
what a Framer/Webflow pro pays for) is licensed **per use-type**, and the
use-types are _separately priced and separately restricted_:

- **Desktop license** — install on N machines, create artwork. Does **not**
  grant web embedding.
- **Webfont license** — serve via `@font-face` from your own domain (or the
  foundry's CDN), usually metered by **pageviews/domains**. Does **not**
  grant app embedding.
- **App / embedding license** — bake the font into a native/desktop app
  binary. Separate, often bespoke, negotiation.
- **Self-hosting vs. hosted** — many commercial webfont deals only let you
  serve via the foundry's own CDN + embed token (see Adobe Fonts below), not
  a file you hold.

The redistribution clause is the sharp edge: **a commercial EULA almost
always forbids handing the font file to a third party.** If KIT•10 fetches a
commercial font's bytes and then _serves them onward_ to a user's browser, or
bakes them into an exported project the user redistributes, we've likely
redistributed — the thing the EULA forbids.

### 2.4 Adobe Fonts / Typekit — the instructive special case

Adobe Fonts is worth calling out because it defines the boundary precisely:
you **cannot download, extract, convert, or self-host** an Adobe Font. Web use
is _only_ via Adobe's embed code (a `<link>` to Adobe's CDN + a project token
that meters usage against your Creative Cloud subscription). Any attempt to
pull the file out violates the ToS. So Adobe Fonts is architecturally
**incompatible with Fontavious's fetch-the-bytes model** — there is no legal
URL that returns the raw WOFF2. If a user wants an Adobe font in KIT•10, the
only lawful paths are (a) they buy a self-hosting license from the underlying
foundry and _upload_ the file (the deferred upload path in CLAUDE.md), or
(b) we never touch it. **Do not add Adobe/Typekit families to the catalogue.**

---

## 3. Using proprietary fonts for rendering without violating licenses

This is the heart of the question. The Fontavious model already encodes the
right instinct (`plugins/fontavious/src/lib.rs`, top comment): **never bundle
or redistribute the font file — only fetch it at runtime from the vendor's own
CDN.** Why that specific shape is defensible, and where its edges are:

### 3.1 The principle: fetch, render, don't rehost

The one operation that is broadly safe across _both_ open and free-proprietary
fonts is: **pull the bytes from the vendor's authorized delivery endpoint at
the moment of rendering, hold them only in memory, and never re-serve them to
anyone else.** This is close to what a browser does with `@font-face`, and it
sidesteps the redistribution clause that kills the "bundle the file in our
repo/app" approach:

- We don't ship the font in the KIT•10 repo (the catalogue holds **URLs**,
  never files — enforced by the `every_variant_has_a_gstatic_url` test).
- We don't re-serve it from a KIT•10 server (the client fetches gstatic
  directly via Extism's HTTP capability, host-allowlisted per vendor).
- The bytes live in the WASM renderer's memory for the session and die with
  the tab.

For **OFL/Apache** fonts this is belt-and-suspenders — we'd be allowed to
bundle them outright. For **free-proprietary** (Fontshare FFL) fonts it's the
_correct_ posture: use is free, redistribution is not, so we use-without-
rehosting. For **paid commercial** fonts it is **still not enough on its own**
— fetching a commercial WOFF2 you have no license for, even without rehosting,
is unlicensed use. The fetch model is necessary but not sufficient for the
commercial tier; that tier needs an actual license the _user_ holds.

### 3.2 The three lawful lanes for KIT•10, concretely

1. **Catalogue fonts (OFL + free-proprietary).** Fetch from the vendor CDN at
   runtime, exactly as today. Safe to also _bundle into an exported build_
   for the OFL/Apache subset (ship the license file); for the free-proprietary
   subset, prefer keeping them as a CDN `@font-face` link in the export rather
   than a bundled file, to stay clear of the redistribution clause.

2. **User-uploaded fonts (any license the user legally holds).** The deferred
   upload path. The user supplies the file; KIT•10 renders it. The license
   obligation is the user's, and we should surface (not enforce) that — a
   small "you must have the right to use this font" affirmation, the same
   posture Figma/Framer take. This is the _only_ lawful route for commercial
   type, and it's why the Vellum `font_facts`-from-loaded-bytes oracle is on
   the roadmap (CLAUDE.md): an uploaded font has no catalogue entry, so its
   weight/axis facts must be read from the bytes.

3. **Foundry-hosted, token-metered (Adobe-style).** Not fetch-the-bytes at
   all — embed the foundry's own delivery in the _exported_ project as a
   `<link>`, never in the KIT•10 preview canvas (Vellum can't render from a
   token'd CDN link it can't fetch as raw bytes). This is a pure export-time
   concern, likely never a preview-time one. Low priority until a user asks.

### 3.3 Subsetting and "anti-extraction" — mostly not our problem, but know it

- **Subsetting** (fontTools `pyftsubset`, `glyphhanger`, unicode-range splits)
  trims glyphs to shrink the file. Google serves _pre-subset_ WOFF2 keyed by
  `unicode-range` (Latin / Latin-ext / Cyrillic / Greek as separate faces).
  Fontavious today fetches whole faces; if catalogue growth makes payloads
  heavy, subsetting to the Latin range is the obvious lever. It is also a
  **rendering-correctness** concern: a subset that drops a codepoint the
  design uses renders tofu. For a general design tool we want _full_ faces,
  not aggressive subsets — accept the bytes.
- **"Webfont-only" anti-extraction** (scrambling font tables so the OTF can't
  be reverse-engineered from the WOFF2) is a thing some commercial foundries
  do. It's a red flag, not a tool for us — it signals a license that forbids
  exactly the byte-holding Vellum does. If a URL serves a scrambled/protected
  face, that's a "don't catalogue it" signal.

---

## 4. Reliable font-delivery APIs (where the bytes actually come from)

Ranked by reliability + fit for the Fontavious fetch-a-URL model.

### 4.1 Google Fonts — three distinct surfaces (know which is which)

Google Fonts is not one API; it's three, and Fontavious quietly depends on the
relationship between them.

- **`fonts.gstatic.com` (the file CDN).** The actual WOFF2 files. Stable,
  fast, globally cached, no key. **This is what the catalogue URLs point at**
  and what `fetch_font` hits. The catch: gstatic URLs contain an **opaque,
  versioned hash** (`.../inter/v20/UcC73...woff2`) that Google mints — you
  can't construct one by hand, and it _changes_ when Google reissues the font
  (note the `v20`/`v51` version segments in the current catalogue). So the
  catalogue is a **cache of resolved URLs that can go stale** if Google bumps
  a version. A dead URL is a hard 404 in `fetch_font`. This is the single
  biggest fragility in the current design (see §6.4).
- **CSS2 API (`fonts.googleapis.com/css2?family=...`).** The _resolver_.
  Request `css2?family=Inter:wght@400..700` **with a modern-browser
  User-Agent** and it returns `@font-face` blocks whose `src: url(...)` point
  at the current gstatic WOFF2 for that exact query. Change the UA and it
  serves TTF/WOFF instead — the UA is how it picks the format. **This is the
  mechanism that produced every URL in the catalogue**, and it's the
  mechanism to _regenerate_ the catalogue programmatically (§6). Keyless,
  rate-limited-but-generous, extremely stable API shape.
- **Developer API (`www.googleapis.com/webfonts/v1`).** JSON metadata for the
  entire library — every family, its variants, subsets, category, and
  (with `capability=WOFF2` / `&capability=VF`) direct file URLs + variable
  axis ranges. **Requires a free API key.** This is the right source for
  _discovery_ (what families exist, what axes each has) — it's how
  fontsource's `google-font-metadata` builds its dataset.

**Reliability verdict:** gstatic is the most reliable file host on the
planet; the _fragility is our cached URLs_, not Google's uptime. Use CSS2 (UA
trick) or the Developer API to (re)generate URLs; never hand-author them.

### 4.2 Bunny Fonts — the GDPR-clean drop-in

`fonts.bunny.net` is a **1:1 drop-in for the Google Fonts v1 API** — same
family names, same query grammar; you literally swap `fonts.googleapis.com`
→ `fonts.bunny.net` and `fonts.gstatic.com` → `fonts.bunny.net`. Zero logging,
no IP retention, EU-hosted, GDPR-compliant. Same open-licensed catalogue as
Google (it re-serves the OFL corpus). **Strong candidate for a
privacy-default vendor** in Fontavious (`vendor: "bunny"`), or as the
recommended CDN in _exported_ projects for EU-facing users — Google Fonts'
IP-transfer-to-US is a real GDPR liability (German courts have fined sites for
it), and Bunny removes it with no code change beyond the host. The catalogue's
`vendor` field already anticipates multi-vendor; Bunny is the easiest second
one.

### 4.3 Fontshare — the Figma-refugee's "premium free" tier

ITF's `api.fontshare.com` serves high-quality display/text families
(Satoshi, General Sans, Clash Display, Cabinet Grotesk, Switzer — fonts that
read as _paid_ type but are free) via a CSS embed API **and** downloadable
offline kits (OTF/WOFF/WOFF2). Both open (OFL) and closed (FFL, free-for-
commercial) tiers, all free for commercial use. **This is the highest-value
catalogue expansion for "feels like Framer/Webflow"** — these are exactly the
trendy geometric/grotesque families that dominate 2024–2026 startup design
and that Google Fonts _doesn't_ have. Add as `vendor: "fontshare"` with its
own host in the allowlist. Caveat: the closed-tier FFL means fetch-and-render,
don't-rehost (§3.1), and don't bundle-into-export as a raw file.

### 4.4 Fontsource — npm packages, not a runtime API

`@fontsource/*` packages self-host the OFL corpus as **npm modules bundled at
build time**. This is _not_ a runtime fetch API and doesn't fit Fontavious's
model directly — but it is exactly the right model for **KIT•10's future
export plugins** (§5), and its underlying `google-font-metadata` package is
the best tool for regenerating Fontavious's catalogue (§6). Think of Fontsource
as "the answer for the exported build," not "the answer for the live canvas."

### 4.5 Quick reference

| Source               | Runtime fetch of raw bytes? | Key needed | License scope          | Best use in KIT•10            |
| -------------------- | --------------------------- | ---------- | ---------------------- | ----------------------------- |
| gstatic (Google)     | Yes                         | No         | OFL/Apache             | Canvas fetch (today)          |
| Google CSS2 API      | Resolves→gstatic            | No         | OFL/Apache             | Regenerate catalogue URLs     |
| Google Developer API | Metadata (+URLs)            | Yes (free) | OFL/Apache             | Discover families/axes        |
| Bunny Fonts          | Yes (drop-in)               | No         | OFL/Apache             | GDPR default / EU export      |
| Fontshare            | Yes (+kits)                 | No         | OFL + free-proprietary | Premium-free expansion        |
| Fontsource (npm)     | No (build-time)             | No         | OFL/Apache             | **Export builds**, not canvas |
| Adobe Fonts          | **No (forbidden)**          | —          | Commercial             | Never catalogue               |

---

## 5. Fonts in the build process — where they belong when KIT•10 exports code

CLAUDE.md frames Vellum as preview-only and CSS/export as "a separate plugin's
concern." When that export plugin exists (React/Vue/Svelte/HTML output), font
handling is a _first-class build concern_, and the ecosystem has converged on
a clear answer that KIT•10 should emit.

### 5.1 The modern consensus: self-host at build time, don't hotlink, don't commit binaries

The industry has moved decisively **away** from `<link
href="fonts.googleapis.com">` hotlinking, for three reasons: (1) GDPR
(IP leak to Google/US), (2) performance (extra DNS + TCP + render-blocking
round-trip; measurable LCP hit), (3) version drift (Google silently updates a
font under you). The replacement is **download the font at build time and
self-host it from your own origin**, version-locked:

- **`next/font`** (Next.js) — you name a Google font in code; at _build time_
  it downloads the WOFF2, self-hosts it with your static assets, and generates
  a zero-layout-shift `@font-face`. No request ever reaches Google from the
  browser. This is the reference UX.
- **`unplugin-fonts` / `vite-plugin-fonts`** — the Vite/Nuxt/SvelteKit/Astro
  equivalent: declare fonts, plugin fetches + inlines `@font-face` + adds
  preload hints at build.
- **Fontsource** — `npm i @fontsource/inter`, `import`, done; the font is a
  versioned dependency bundled into your output.

The common thread and the rule KIT•10's export plugin should follow:
**fonts are a build artifact, resolved and self-hosted at build time —
neither hotlinked at runtime nor committed as binaries to the source repo.**
The repo declares _which_ fonts (a manifest/dependency); the build _materializes_
them. This is the same "declare the fact, materialize downstream" shape KIT•10
already uses between Charter (declares `font_requests`) and the editor's fetch
scan.

### 5.2 What a KIT•10 export plugin should emit

Given a resolved design that names, say, Inter 400/700 and Satoshi 500, the
export plugin has a menu, in rough order of preference:

1. **Fontsource dependency** (`@fontsource/inter`) for anything in the
   Fontsource/Google corpus — cleanest, version-locked, self-hosted, GDPR-safe,
   framework-agnostic. Emit an `import` (or `next/font` call for Next targets).
2. **Bunny `@font-face` link** as a zero-build fallback for plain-HTML export
   where there's no bundler — GDPR-clean without a build step.
3. **Bundled WOFF2 + generated `@font-face`** for fonts not on any npm registry
   (Fontshare's premium tier via its offline kit, or user uploads) — ship the
   file _plus its license file_, OFL/FFL permitting.
4. **Foundry embed code** (Adobe-style) for commercial fonts the user licenses
   through a hosted service — a `<link>` the user pastes their token into; we
   never touch the bytes.

The export plugin should **carry the license obligation forward**: emit the
OFL/FFL license file alongside any bundled font, and a `// font: Inter (OFL)`
provenance comment. This is cheap and keeps downstream users compliant.

### 5.3 The KIT•10-specific subtlety

Fontavious resolves fonts to _specific gstatic URLs_ for the **canvas**. The
export plugin must **not** reuse those opaque hashed URLs in generated code —
they're a private caching detail that can 404 on version bump. Export should
name the font by **family + weight + style** and let the target's own font
mechanism (Fontsource/next/font/Bunny) resolve delivery. Same family/weight/
style triple Charter's `font_requests` already emits — the export plugin
consumes that, not the URL cache. One more instance of the CLAUDE.md rule:
the URL cache is the canvas's supply chain, not a portable fact.

---

## 6. Expanding Fontavious's catalogue

> The concrete, phased expansion plan — including the two-layer
> roots-vs-aliases model, proprietary-name handling, and the
> metric-clone/visual-substitute dedup strategy — now lives in
> `resources/fontavious-catalogue-plan.md`. This section is the background
> that plan builds on.

> **Update:** this section motivated the expansion; it has since **shipped** —
> the catalogue is now **146 families**, generated (`generate-catalogue.mjs`),
> with italics, categories, aliases, and the Fontshare tier. The reasoning below
> is preserved as the rationale; the concrete plan + per-phase status is
> `resources/fontavious-catalogue-plan.md`.

The catalogue _was_ ~40 families (95 lines of hand-maintained JSON) — far too
small for a designer arriving from Figma (~1000+ Google fonts one click away),
Framer, or Webflow (Google Fonts + Adobe + uploads). Here's how it grew without
hand-authoring URLs or breaking the schema.

### 6.1 The schema is already right — don't change it, feed it

`CatalogueEntry { family, vendor, variants: [{ weightMin, weightMax, style,
url }] }` is a good shape and multi-vendor-ready. Growth is a _data_ problem,
not a schema problem. Two constraints to preserve:

- The `weightMin..weightMax` range **must** reflect reality per family
  (variable → true range from one URL; static-only → one entry per discrete
  weight, min==max). Getting this wrong reintroduces the exact bug the
  Charter weight-snapping (`resolve_font_weight`) exists to paper over —
  it'll try to fetch a weight that has no file.
- Every `style` variant (`normal`, `italic`) needs its **own** entry. The
  current catalogue is **normal-only** — a real gap. Figma/Framer users expect
  italics; adding the `ital` faces is a concrete, high-value first expansion.

### 6.2 Generate, don't hand-write — the pipeline

Hand-authoring gstatic URLs is the current bottleneck and the source of
staleness. Replace it with a **generation script** (`plugins/fontavious/`
build step, not shipped in the WASM):

1. **Discover** families + axes from the **Google Developer API**
   (`webfonts/v1?capability=WOFF2&capability=VF&key=...`) — gives every
   family, its variants, its variable axes + ranges, and category (serif/
   sans/display/mono/handwriting). Or lean on **`google-font-metadata`**
   (fontsource's npm tool: `npx gfm generate && npx gfm parse`) which already
   fetches + parses this into clean JSON including variable-axis ranges and
   WOFF2 URLs — it's the exact tool that built Fontsource's dataset.
2. **Resolve URLs** via the **CSS2 API with a modern-browser User-Agent** for
   each `family:wght@min..max` (variable) or each discrete weight (static),
   scraping the `src: url(...)`. This yields the current WOFF2 URL for each
   variant.
3. **Model the range correctly**: if the CSS2 response for `wght@400..700`
   comes back as a _single_ `@font-face` with `font-weight: 400 700;`, it's a
   variable face → one entry, `weightMin:400, weightMax:700`. If it comes back
   as discrete single-weight faces, it's static-only → one entry per weight.
   (This is exactly the manual determination the current catalogue comments
   describe — automate it.)
4. **Emit `catalogue.json`** in the existing shape. Keep the same tests
   (`every_variant_has_a_gstatic_url` generalizes to "URL host ∈ allowed
   vendor hosts").

This makes catalogue growth a _rerun_, not a research project, and fixes
staleness (rerun on a schedule; a version bump just changes URLs).

### 6.3 Which families to add (the "feels like home" set)

Prioritize by what designers actually reach for. Concretely:

- **Complete the Google top tier** the catalogue is missing: Manrope, Raleway,
  Rubik, Karla, Mulish, Figtree, Space Grotesk, Sora, Outfit, Plus Jakarta
  Sans, Archivo, Libre Franklin, IBM Plex Sans/Serif/Mono, Noto Sans, PT Sans,
  Barlow, Oswald, Bebas Neue, Josefin Sans, Quicksand, Comfortaa.
- **Serifs / editorial**: Lora, EB Garamond, Fraunces (variable, expressive
  `opsz`), Cormorant, Bitter, Crimson Pro, Spectral, Newsreader, Libre
  Baskerville, Source Serif 4.
- **Mono** (designers expect these for code/UI): JetBrains Mono, Fira Code,
  IBM Plex Mono, Space Mono, Roboto Mono, Source Code Pro.
- **Fontshare premium-free** (the Framer/Webflow flavor Google lacks):
  Satoshi, General Sans, Clash Display, Clash Grotesk, Cabinet Grotesk,
  Switzer, Ranade, Sentient, Chillax, Zodiak. **These are the differentiator**
  — they're why a Framer user feels the catalogue is "current."
- **Italics** for the core families (see §6.1).

Rough target: a few hundred Google families (the full "popular" slice, not all
1000+) + Fontshare's ~150. That's a rerun of the generator with a family
allowlist, not manual work.

### 6.4 Robustness the bigger catalogue forces

- **Stale-URL handling.** A larger, generated catalogue makes 404s a _when_,
  not _if_ (Google version bumps). `fetch_font` already errors cleanly and the
  editor logs it as non-fatal (`console.warn`, per CLAUDE.md's font-error
  note). Consider a fallback: on a gstatic 404, re-resolve that one family via
  the CSS2 API live and retry — turns a permanent tofu into a self-heal.
  Alternatively, adopt **Bunny as a mirror vendor** and fall back host-to-host
  (Bunny mirrors the same OFL corpus, drop-in).
- **Payload weight.** Whole-face WOFF2 is fine at 40 families; at 300+ with
  italics, consider fetching the **Latin `unicode-range` subset** face (what
  CSS2 already offers per-range) instead of the full multi-script face.
- **Vendor allowlist.** Adding Fontshare/Bunny means their hosts join the
  Extism `allowedHosts` in `loadUtilityPlugin` (CLAUDE.md's Fontavious note) —
  `fonts.gstatic.com`, `fonts.bunny.net`, `api.fontshare.com`/`cdn.fontshare.com`.
- **Search UX at scale.** `search_fonts` is a linear substring scan — fine at
  40, still fine at a few hundred, but a large catalogue wants **category
  faceting** (serif/sans/mono/display) surfaced to `SuggestField.svelte`. The
  Developer API already carries `category`; add it to `CatalogueEntry` and let
  the picker filter. This is also the natural home for "recommended/popular"
  ordering so the first screen isn't alphabetical noise.

### 6.5 The upload escape hatch closes the last gap

No catalogue, however large, covers commercial type or a client's bespoke
brand font. The **user-upload path** (deferred, but architecturally sketched
in CLAUDE.md — the Vellum `font_facts`-from-loaded-bytes oracle) is what makes
Fontavious _complete_ rather than merely _large_: catalogue for the 95% case,
upload for the long tail, and the licensing obligation for uploads sits with
the user who holds the license (§3.2, lane 2). Catalogue breadth reduces how
often upload is needed; it never eliminates the need.

---

## 7. Caching — persisting fetched fonts without exposing proprietary ones

> **Status: SHIPPED** (branch `feat/fontavious-catalogue-aliases`). Realized as
> two host functions — `kit10_font_cache_get(url) → bytes` and
> `kit10_font_cache_put(metaJson, bytes)` (`src/lib/plugins/manager.svelte.ts`)
> — backed by `src/lib/plugins/font-cache.ts` (the IDB store below). Fontavious's
> `fetch_font` checks the cache before the network and stores after a miss, so
> the editor scan is unchanged and benefits transparently. The plugin owns "get
> me these bytes cheaply"; the host owns the storage.

Today the fetched WOFF2 bytes live only in Vellum's session memory and the
editor's in-memory URL `Set` (CLAUDE.md); a reload drops both, so every
family re-fetches from scratch. We want to persist the _bytes_ across
reloads **without** turning that cache into a redistribution/exposure vector
for the proprietary tier. The two acts are genuinely different under every
license tier, and the design leans on that difference:

- **Caching** = storing bytes _the same user's own browser already fetched_,
  on _their own machine_, private to _them_. This is the exact category as
  the browser's built-in HTTP cache — which already caches these files. No
  OFL/FFL/commercial term forbids it; it is "use," not "distribution."
- **Exposure / redistribution** = serving those bytes to _someone else_ (a
  KIT•10-hosted shared mirror) or _materializing them into an artifact the
  user ships_ (bundled into an export). That is the forbidden act — and a
  private client cache never performs it.

**Therefore a per-user, client-side, private cache is licensing-safe for all
tiers, proprietary included.** The proprietary-exposure risk lives entirely
at two _other_ points — server rehost and export bundling (§5.2, §3) — and
neither is touched by adding a cache. What follows is the design that keeps
it that way _by construction_, not by convention.

### 7.1 A dedicated IndexedDB object store, keyed by resolved URL

Persistence belongs **host-side** (editor / plugin-manager), not in
Fontavious's Extism KV store — that store is in-memory (CLAUDE.md host-fn
table) and dies on reload, the very problem we're solving. Use a dedicated
IndexedDB object store rather than the Cache Storage API: Cache Storage only
holds `Request`/`Response` pairs, whereas an IDB record can carry the
**metadata** that makes the exposure guard enforceable by data (see §7.3).

```
db 'kit10-fonts', objectStore 'font-bytes', keyPath 'url'   // plugin-agnostic host store, not named for any one plugin
{
  url:         'https://fonts.gstatic.com/.../inter....woff2', // primary key = the resolve dedup key
  bytes:       ArrayBuffer,        // the raw WOFF2, exactly what vellum.load_font() eats
  family:      'Inter',
  weightMin:   400, weightMax: 700, style: 'normal',
  vendor:      'google',
  licenseTier: 'ofl',             // 'ofl' | 'free-proprietary' | 'upload'  (see §7.3)
  lastUsed:    <timestamp>        // for LRU eviction
}
```

Keying by URL means variable-font weights **dedup for free** — Inter
400/550/700 all resolve (via `variant_url`) to one URL, so one record covers
the whole range — matching the URL-dedup the resolve-time scan already does.
Add a `family` index for management/eviction, and call
`navigator.storage.persist()` so the browser doesn't evict the font cache
under storage pressure.

### 7.2 It feeds the per-session GPU load, not a persisted GPU state

The critical nuance: **a GPU font upload cannot survive a reload** (GPU memory
is gone), so `vellum.load_font()` must rerun every session regardless. The
cache does **not** persist the loaded/GPU state — it persists the _bytes that
reconstruct it_, and feeds them to the load step locally:

```
session start → editor scan → fetch_font(family,weight,style)          [Fontavious]
  → kit10_font_cache_get(url)?  hit  → bytes → vellum.load_font()       (instant, offline)
                                miss → HTTP fetch → kit10_font_cache_put(meta, bytes) → bytes
```

As shipped, the cache check lives **inside `fetch_font`** (via the host
functions), not in the editor scan — so the editor's own in-memory `Set` still
avoids redundant `fetch_font` calls _within_ a session, and the IDB cache makes
the first fetch _of each session_ network-free. The win is scoped and honest:
the per-session GPU (re)load gets an instant, offline, deterministic byte source
instead of a network round-trip that otherwise depends on the vendor's cache
headers. The GPU upload cost itself is unavoidable and cheap; the network cost
and the reload flicker are what the cache removes.

### 7.3 The `licenseTier` field makes the export guard structural

The one place a cached _proprietary_ font could leak is a future export plugin
reading bytes out of this store to bundle them (§5.2 forbids bundling the
free-proprietary/commercial tiers as raw files). Tagging every record with
`licenseTier` turns that from _a convention someone could break_ into a
**data-level filter**:

- The canvas font loader queries the store freely — all tiers, because
  rendering-from-a-private-cache is safe for all tiers.
- **An export path may only ever query `licenseTier === 'ofl'`** (the one tier
  whose license grants bundling). Everything else is _invisible_ to it. The
  proprietary bytes physically live in the store (safe) but the export lane
  cannot see them, so it cannot accidentally materialize them.

This requires the tier to be _known at fetch time_, which means the
**catalogue must carry it** — a `licenseTier` (or `category` + `license`)
field per `CatalogueEntry`, not present today. It's a natural companion to the
`category` faceting §6.4 already wants for search, and the generator (§6.2) can
populate both from the Developer API's `category` + the vendor's known license
(Google/Bunny → `ofl`, Fontshare open tier → `ofl`, Fontshare closed tier →
`free-proprietary`, uploads → `upload`).

### 7.4 What this does _not_ change

- **No new exposure surface.** The bytes were already on the user's machine
  (browser HTTP cache, devtools-reachable); IDB doesn't make a proprietary
  font _more_ extractable than it already is. Exposure is still exactly:
  server rehost + export bundling — both unchanged, both guarded elsewhere.
- **No shared cache.** IDB is per-origin, per-user; every browser has its own.
  It is never a cross-user mirror (which _would_ be redistribution).
- **Fontavious's fetch model is untouched.** `fetch_font`/`variant_url` stay as
  they are; the cache is a host-side layer _in front of_ the fetch, not a
  change to the plugin. `variant_url` remains the pure resolver that produces
  the cache key.

---

## 8. Summary — the decisions this doc supports

1. **Rendering-by-fetching is the right, defensible model** for the open and
   free-proprietary tiers: hold bytes transiently, never rehost, never commit
   font files to the repo. It's belt-and-suspenders for OFL, correct for FFL,
   and _insufficient alone_ for paid commercial (which needs a user-held
   license via upload or a foundry embed).
2. **gstatic is reliable; our cached URLs are the fragility.** Generate them
   from the CSS2 API / Developer API, never hand-author; consider a live
   re-resolve or Bunny mirror as 404 insurance.
3. **Bunny Fonts** is a near-free GDPR win (drop-in), and **Fontshare** is the
   single highest-value catalogue expansion for design-tool refugees.
4. **Exported builds** should self-host at build time (Fontsource/next/font/
   unplugin-fonts), carry license files, and name fonts by family/weight/style
   — never reuse the canvas's opaque gstatic URLs.
5. **Grow the catalogue by generation, not by hand**: `google-font-metadata` +
   CSS2 UA resolution → the existing schema, plus italics, categories, and a
   few hundred families including Fontshare's premium-free set. Upload closes
   the commercial/bespoke long tail.
6. **Persist fetched fonts in a dedicated IndexedDB store keyed by resolved
   URL** (§7) so reloads are network-free and offline — a private per-user
   cache is licensing-safe for _all_ tiers. Tag each record with `licenseTier`
   so the export lane can only ever read the OFL tier, keeping proprietary
   bytes cached-but-unexposed _by construction_. Requires adding a
   `licenseTier`/`category` field to the catalogue.

---

## Sources

- [Google Fonts Developer API](https://developers.google.com/fonts/docs/developer_api) · [CSS2 API](https://developers.google.com/fonts/docs/css2)
- [fontsource/google-font-metadata](https://github.com/fontsource/google-font-metadata) · [Fontsource](https://github.com/fontsource/fontsource) · [Fontsource docs](https://fontsource.org/docs)
- [Bunny Fonts (about)](https://fonts.bunny.net/about) · [Bunny Fonts launch](https://bunny.net/blog/bringing-privacy-back-into-your-own-hands-introducing-bunny-fonts/)
- [Fontshare](https://www.fontshare.com/) · [Fontshare FAQ](https://www.fontshare.com/faq) · [ITF Free Font License](https://www.fontshare.com/licenses/itf-ffl)
- [SIL Open Font License](https://openfontlicense.org/) · [OFL FAQ](https://openfontlicense.org/ofl-faq/) · [Using OFL fonts](https://openfontlicense.org/how-to-use-ofl-fonts/) · [OFL on Wikipedia](https://en.wikipedia.org/wiki/SIL_Open_Font_License)
- [Adobe Fonts webfont licensing](https://helpx.adobe.com/fonts/using/webfont-licensing.html) · [Adobe font licensing](https://helpx.adobe.com/fonts/using/font-licensing.html)
- [next/font (Next.js)](https://nextjs.org/docs/app/api-reference/components/font) · [unplugin-fonts](https://github.com/cssninjaStudio/unplugin-fonts)
- [fontTools subset docs](https://fonttools.readthedocs.io/en/latest/subset/) · [Subsetting web fonts (Walter Ebert)](https://walterebert.com/blog/subsetting-web-fonts/)
- [Typewolf: 40 Best Google Fonts](https://www.typewolf.com/google-fonts) · [Google Fonts GDPR (Usercentrics)](https://usercentrics.com/knowledge-hub/google-fonts-gdpr-compliant/)
