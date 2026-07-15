# Charter Layout category — a long-term affordance plan

An opinion piece, sibling to [charter.md](./charter.md). It reads the current
`box_categories()` **`layout`** field set against the four-tool critique and proposes
a phased path from "mostly raw CSS knobs" to "a small vocabulary of outcome-named
layout *intents* that nudge users into the handful of patterns real UIs are actually
made of."

Grounding facts it builds on: Charter is an *opinionated translation layer*, not a
CSS pass-through (VISION 1st Principle); it already has exactly one earned layout
opinion — the Fixed/Hug/Fill **resize** control (`compile_resize`) — and the
established shape for earning another is "a Rust `compile_*` + an editor widget that
share one keyword contract" (the panel writes the same keywords the compiler reads).

---

## Where the `layout` category is today

```
width / height              → inputType "resize"  ✅ earned opinion (Fixed/Hug/Fill)
min-/max-width/height  (×4) → raw length fields    ⚠️ clutter, matter only sometimes
padding                     → raw text
flex-direction  "Direction" → raw
gap                         → raw text
align-items     "Align"     → raw   ┐
justify-content "Justify"   → raw   │ the arrangement knobs — Framer/Figma/Penpot
flex-wrap       "Wrap"      → raw   │ all name these for the CSS property, the exact
display                     → raw   ┘ literalism our VISION rejects
grid-template-columns/rows        ┐
grid-auto-columns/rows            │ the CSS-Grid sublanguage — Penpot's admitted
grid-column / grid-row  (span)    ┘ "too literal … steep cliff" failure, verbatim
```

So: **1 earned opinion, ~13 raw-CSS-named debts.** Per charter.md every raw-CSS field
is *debt* — "acceptable as a placeholder for a primitive that has no clearer opinion
*yet*, but the north star is to earn an opinion and replace it." The `layout` category
is where that debt is densest, and it's the category a user hits first for every box.

---

## The design premise: real UIs are ~6 patterns, not 30 knobs

The reason "expose `justify-content` + `align-items` + `flex-wrap` + `flex-direction`
+ grid tracks" is the wrong surface isn't only that the names are CSS — it's that they
make the user *assemble* a pattern out of orthogonal primitives every time, when the
patterns they want are a tiny, well-known set. Nearly every component-level layout is
one of:

| Pattern            | Where you see it                         | The intent, in words                |
| ------------------ | ---------------------------------------- | ----------------------------------- |
| **Stack** ↓ / →    | forms, lists, the default box            | flow children one direction, gap    |
| **Cluster**        | tag/chip rows, button groups, toolbars   | flow + wrap + gap, pack to start    |
| **Split**          | headers, nav bars, list rows w/ trailing | push ends apart, center cross-axis  |
| **Center**         | hero, empty states, badges, avatars      | center a thing both axes            |
| **Grid**           | galleries, card grids, dashboards        | equal responsive cells              |

That's the whole vocabulary for the overwhelming majority of screens. Stack + Cluster
+ Split alone cover most of what a design system's components need; Center and Grid
mop up most of the rest. Charter's opportunity is to make **choosing a named pattern**
the primary act, and reduce the orthogonal knobs to per-pattern follow-ons — the
Framer "Stack/Grid" instinct, but resolved to a slightly richer, still-tiny set, and
compiled down the way `compile_resize` already compiles Fixed/Hug/Fill.

This is the affordance the request is about: a user who opens the Layout panel should
*recognize their pattern by name* and pick it, not reverse-engineer it from flex
properties. The panel nudges toward the common case by making the common case a
first-class labeled choice.

---

## The core move: **Arrangement tabs** + inline submenus

Introduce `inputType: "arrange"` on a single new field (`arrange`, label
**"Arrangement"**), and **retire the raw arrangement knobs from the default surface**
— `flex-direction`, `align-items`, `justify-content`, `flex-wrap`, `display` — the
way the item-flex trio (`flex-grow`/`flex-shrink`/`align-self`) was retired when
`resize` landed: still parsed by `build_box_node`, no longer front-and-center (they
get a labeled UI home instead — see the Advanced rule below). Charter grows a
`compile_arrange` beside `compile_resize`, sharing one keyword contract with the
widget.

The editor renders `arrange` as a **tab row of five named intents** (real text
labels + icon, never icon-only — the accessibility fork in charter.md). The selected
tab swaps an **inline submenu region directly beneath the row** — ordinary panel
fields, never a context menu, popover, or unlabeled "…". Only the active intent's
follow-ons exist on screen, so the arrangement half of the category collapses from a
dozen raw fields to a tab row plus at most three follow-ons at first contact.

```
Arrangement   [ Stack ]  [ Cluster ]  [ Split ]  [ Center ]  [ Grid ]
              ──────────────────────────────────────────────────────
  Stack   ▸   Direction [↓|→]    Gap [12]           ▸ Advanced flex
  Cluster ▸   Gap [8]                               ▸ Advanced flex
  Split   ▸   Axis [↔|↕]                            ▸ Advanced flex
  Center  ▸   (no follow-ons)                       ▸ Advanced flex
  Grid    ▸   Cell min [180]     Gap [16]           ▸ Custom tracks
```

The tab row quietly *is* `display` plus most of the flex quartet, renamed for
outcomes. Direction lives inside **Stack** because that's the only intent where it's
a free choice — Cluster is row-flow-that-wraps by definition, Split gets its own ↔/↕
axis toggle (a sidebar with a pinned footer is a vertical Split), Center and Grid
are axis-free.

| Tab (follow-ons)           | Compiles to (BoxExtra)                                                                |
| -------------------------- | ------------------------------------------------------------------------------------- |
| **Stack** (direction, gap) | `flex_direction: Column/Row`, `gap`; row variant defaults `align_items: Center`       |
| **Cluster** (gap)          | `flex_direction: Row`, `flex_wrap: Wrap`, `gap`, `align_items: FlexStart`              |
| **Split** (axis)           | `flex_direction: Row/Column`, `justify_content: SpaceBetween`, `align_items: Center`  |
| **Center**                 | `justify_content: Center`, `align_items: Center`                                       |
| **Grid** (cell min, gap)   | `display: grid`, `grid-template-columns: repeat(auto-fit, minmax(<cell>,1fr))`, `gap` |

Note the direction-awareness already threaded for resize (`parent_main_horizontal`)
composes cleanly: the resize control's Fill/Hug still means "share / content-size on
the parent's main axis," and now the *parent's* main axis is whatever its Arrangement
tab chose. The two opinions interlock instead of fighting.

---

## Disclosure mechanics — why tabs are not Figma's mode trap

charter.md bans mode-overloaded widgets, and tab-swapped submenus done carelessly
would be exactly that. The distinction that keeps them honest: Figma's sin is **one
widget whose *meaning* changes with a mode you can't see** (its 3×3 grid means
different things in packed vs space-between). Tabs invert it — the mode selector is
the always-visible, labeled control, and switching it changes **which fields exist,
never what any visible field means**. Six rules hold that line:

1. **The tab row is the signifier.** The submenu changes only as the direct, visible
   consequence of picking a tab. No field ever appears or vanishes for a reason the
   panel doesn't show — the exact Figma failure ("options appear/disappear by context
   in the same physical location, so users can't tell *why* a control is missing").
2. **Submenus are inline panel content in a fixed region** under the tab row — never
   a context menu or popover. This is the grammar `resize` already shipped (picking
   Fixed reveals its length editor inline, in place); Arrangement scales it up, it
   doesn't invent a second style.
3. **Same field, same slot, same meaning.** A follow-on shared by several tabs (Gap)
   renders in the same position, with the same label and semantics, under each;
   per-tab fields come after the shared ones. Spatial stability is what makes
   tab-switching learnable instead of disorienting.
4. **Hidden means inert *and* preserved.** Follow-ons are ordinary render entries.
   Switching tabs neither deletes them nor lets them keep compiling —
   `compile_arrange` consults only the active intent's follow-on set, so an inactive
   tab's values can't leak into the render (Webflow's invisible consequences), and
   switching back restores them exactly (Figma's destructive unpreviewed reflow,
   made reversible).
5. **Advanced is a labeled, per-tab disclosure row** closing each submenu ("Advanced
   flex", "Custom tracks") — the UI home for the raw escape hatches, one deliberate
   click away rather than surfaced-by-default or parse-only. It should badge itself
   when a hidden field actually holds a value, so nothing set is ever invisible.
6. **Two levels, hard cap.** Tab → submenu → one labeled Advanced. If a control
   seems to need a third level, the intent vocabulary is wrong — fix the tabs, don't
   nest deeper.

Generalized, the panel has exactly **one progressive-disclosure grammar: a selector
reveals its own follow-ons, inline.** Resize's Fixed reveals a length editor
(shipped); an Arrangement tab reveals its submenu (Phase 1); Fill/`%` reveals its
min/max pair (Phase 4). Any future field either fits this grammar or stays a plain
always-visible field — no third disclosure style gets invented per feature.

---

## Phased roadmap

Each phase is independently shippable and follows the `compile_resize` template (Rust
`compile_*` + editor widget + shared keyword contract), so none is a big-bang rewrite.

### Phase 1 — Arrangement tabs (the flex knobs)
- Add `inputType: "arrange"`, `compile_arrange`, and the tab row + inline submenu.
  The **Grid tab can ship as a stub** whose submenu is simply today's raw grid fields
  — the user's literal "flex vs grid tabs" win lands immediately (grid fields stop
  cluttering flex boxes on day one) without waiting for Phase 3's grid opinion.
- Retire `flex-direction`/`align-items`/`justify-content`/`flex-wrap`/`display` from
  the default surface; keep them parsed, with their UI home in the per-tab
  **Advanced** row.
- Default a fresh box to **Stack ↓** with a sensible gap so the common case needs zero
  panel interaction (Framer "default hard").
- *Payoff:* the single densest cluster of raw-CSS debt becomes one outcome-named
  control, and the category's first impression shrinks from ~19 fields to a tab row
  plus a few follow-ons. This is the phase that most directly answers "nudge users
  toward common patterns."

### Phase 2 — Spacing (gap + padding)
- Replace raw `gap`/`padding` text with `inputType: "spacing"`: a numeric control that
  is **token-scale aware** (nudges toward the project's spacing scale rather than
  arbitrary px), and gives `padding` the 1-value ↔ 4-value affordance (Figma/Framer
  both get this right; keep it).
- Gap becomes a per-intent follow-on (revealed by Arrangement), not a standalone raw
  field.

### Phase 3 — Grid without the CSS-Grid cliff
- The `grid-template-*` / `grid-auto-*` / `grid-column`/`grid-row` sublanguage is the
  Penpot "too literal, steep cliff" failure imported verbatim. Replace the **Grid
  tab's stub submenu** with just **Cell min-size** + **Gap**, compiling to
  `repeat(auto-fit, minmax(min, 1fr))` — responsive-by-default, no track algebra.
- Explicit tracks / spans stay a real capability but move into the Grid tab's
  **Advanced row ("Custom tracks")** — never the default surface, never raw at first
  contact, still parseable for power users.
- *Payoff:* the highest-cliff part of the category becomes a two-knob common case.

### Phase 4 — Size limits (min/max) as contextual disclosure
- The four raw `min-/max-width/height` fields clutter every box while mattering only
  sometimes (notably the percent-of-auto-parent floor — see CLAUDE.md's `min_width`
  note). Fold them into the **resize** control: when a dimension is Fill or Fixed-`%`,
  reveal an optional, **labeled** "won't shrink below / grow past" pair, tied to
  exactly when it's meaningful.
- Same single disclosure grammar as Arrangement: the resize selector is the revealer,
  the min/max pair is its inline follow-on — no new disclosure style.
- *Payoff:* four permanent raw fields become contextual, and their purpose becomes
  legible at the moment they apply.

### Phase 5 — Cascade-scope on layout controls
- Arrangement now crosses into structural behavior that resolves across kits × axes ×
  layers. Per charter.md's Webflow lesson, keep the **color + shape source channel**
  (property hue = layer key-set, shape = kit icon) on these controls exactly as
  `StyleField` already does for paint properties — so a user sees a layout change's
  blast radius *before* committing. No layout control should mutate shared state with
  no cue to its scope.
- That includes the tab row itself: `arrange` is a resolved property like any other,
  so the active tab carries the source hue for *which layer chose this arrangement* —
  a structural change is the one you least want rippling invisibly.

---

## What stays raw (deliberately, for now)

Not everything must be earned at once. The honest thing (per charter.md: "raw-CSS
names are debt … acceptable as a placeholder") is to keep the escape hatches parsing
and only *surface* an opinion once it's genuinely settled. Until each phase lands, its
current raw fields keep working — the plan pays debt down, it doesn't strand layouts.

With the Advanced rows in place, "raw" splits into two tiers: **legitimate-but-rare**
fields (custom tracks, non-default wrap/justify variants) live one labeled click away
inside their tab's Advanced row, still real panel controls; **retired-opinion** fields
(`margin`, the item-flex trio — Charter's no-margins opinion; resize owns per-item
sizing) stay panel-absent entirely, parse-only. That existing precedent is the model
for how each phase's fields retire.

---

## Principles this plan commits to (the affordance contract)

1. **Name for the outcome, not the property.** *Stack, Cluster, Split, Center, Grid* —
   never `justify-content` / `flex-wrap` on the surface.
2. **Make the common pattern a first-class choice.** The user recognizes their pattern
   by name and picks it; they don't assemble it from orthogonal primitives.
3. **One field, one meaning.** Tabs change which fields *exist*, never what a visible
   field *means* — the inverse of Figma's mode-overloaded widgets.
4. **One disclosure grammar: a selector reveals its own follow-ons, inline.** Tab →
   submenu → one labeled Advanced, two levels max — never a context menu, popover, or
   unlabeled "…".
5. **Hidden is inert and preserved.** What the active tab doesn't show doesn't compile
   and doesn't get deleted; switching back restores.
6. **Default hard.** A fresh box is a Stack with a sensible gap; zero panel touches for
   the 80% case.
7. **Feed the DOM real semantics.** Every tab and follow-on is a labeled, focusable
   control (label + `inputType`), accessible by construction.
8. **Keep cascade scope visible.** Layout controls — the tab row included — carry the
   same source-color channel as paint controls, so blast radius is legible before
   commit.
9. **Every new control is a `compile_*` + widget sharing one keyword contract** — the
   `compile_resize` template, so panel and compiler can never drift.

---

## See also

- [charter.md](./charter.md) — the spectrum this sits on (Framer philosophy, DOM-control
  architecture, Webflow-grade cascade respect)
- [figma.md](./figma.md) · [framer.md](./framer.md) · [penpot.md](./penpot.md) · [webflow.md](./webflow.md)
- CLAUDE.md — Charter "opinionated translation layer" note, `compile_resize`, the
  retired item-flex precedent, and the `min_width` percent-floor rationale Phase 4 leans on
