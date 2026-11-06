# Landing page (doriterm.com)

The design system for the one public page at `doriterm.com`. It extends [DESIGN.md](../../../DESIGN.md) and adds nothing to the app: the same Night and Day palettes supply every colour, and this file adds the marketing type ladder, the section rhythm, the page's components, and the page brief the build is checked against. The source is `apps/landing/src` (HTML and CSS, no JavaScript); the build hashes the assets into `apps/landing/dist`.

The page carries no screenshot (owner order, 2026-11-06: show the product with its real components, not captures). `apps/landing/src/mock/` composes the app's own components from `@doriface/ui` (`SidebarSection`, `SpaceRow`, `AgentRow`, `MachineHeader`, `IconButton`, `TabBar`, `StatusBar`, `ExtraKeysBar`) with fixture data, and the build renders them to static markup with `react-dom/server`. Tailwind compiles their classes over `@doriface/ui/styles/tokens.css`, so the mocks take the app's Day and Night roles verbatim. Each mock is rendered once per theme and the page shows the one `prefers-color-scheme` asks for. A mock is `role="img"` with a label and `inert`: a picture of the product drawn in HTML, never focusable. A pane's terminal text is plain text in the app's `--font-term` and `--term-fg`, not the wasm terminal.

## 0. Research log

The owner's brief named two references for tone; two more in the same category were read to make sure the first two were a convention rather than a single product's habit.

| Reference                           | Read                                                                                                                                       | Taken                                                                                                                                                                                 | Not taken                                                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| [ghostty.org](https://ghostty.org/) | The page ships as a client-rendered shell, so the text extraction returned only the title; the shape was read from what the shell requests | One claim, one product image, nothing between the visitor and the download                                                                                                            | Its near-absence of navigation; the page needs anchors for a product this young                             |
| [herdr.dev](https://herdr.dev/)     | Full text of the page                                                                                                                      | The hero shape (claim, one paragraph, primary download, secondary browse), plain-statement section headings, real commands beside the claim they prove, a closing open-source section | Its counters ("180 layouts", "359 mods"): Doriterm has no such numbers and the brief forbids inventing them |
| [warp.dev](https://warp.dev/)       | Full text of the landing page                                                                                                              | A product screenshot as the hero's second beat, a status vocabulary shown as a legend, code blocks carrying the weight of prose                                                       | Its density (five products, a demo CTA and a testimonial row above the fold); one product, one action       |
| [tabby.sh](https://tabby.sh/)       | Client-rendered shell; title only                                                                                                          | The category's convention of naming the platform matrix in the hero's meta line                                                                                                       | —                                                                                                           |

The convention the four share: a claim first, the product itself as the proof, and a download as the only primary action. The page follows that and adds the one thing this product has that the others do not — the relay that carries ciphertext — as a first-class section rather than a footnote.

## 1. Page brief

**Primary action.** _Open the app_ (`https://app.doriterm.com`), solid ink, first in the hero. Its peers differ by style only: _Download_ and _GitHub_, both bordered buttons in the same row. The header carries the same destination as a bordered button, never a second filled one. In the install section each card leads with its own action: the desktop card's filled _Download the latest release_, and the browser card's bordered _Open the app_.

**Information priorities.**

1. What it is and where it runs — the hero's headline and paragraph.
2. That the network path is end-to-end encrypted and the relay sees ciphertext — the hero's last sentence, the relay feature, and the security section.
3. That it is installable now, on every platform — the hero's actions and the install section.

**Left out on purpose.** Pricing (there is none), testimonials or customer logos (none exist and none may be invented), counters and benchmarks (the page has no measurement to cite), a newsletter form (no list), a theme toggle (the page follows `prefers-color-scheme` in both directions, so a toggle would be a second source of truth), and a cookie/analytics banner (the page loads no third-party script and sets no cookie).

**Required content.** Header with the mark, the name, four anchors and the app link; hero with the mark, the name in the headline, the one-line pitch, _Open the app_, _Download_, _GitHub_, the platform meta line and two live mocks (a desktop window and a phone); five feature blocks (every screen, the agent list's states, many machines, the ciphertext relay, pairing and mesh join); the three-step _How it works_ with the client → relay → host diagram; the security section with the three facts and a link to `docs/architecture.md` §12; install for desktop and browser with the `doriface-host pair` command; a footer with GitHub, the AGPL-3.0 license, and the herdr-core and Ghostty credits.

**Layout line.**

`Layout: doriterm.com landing - one long document whose sections each own one decision -> scroll-body-shell (https://github.com/changeroa/StyleGallery/blob/main/patterns/viewport-shell/scroll-body-shell.md); scroll owner: document; anti-patterns: a sticky header covering an anchor target, a second nested scroller inside a feature, a hero that overflows at 1280.`

**Data shape.** No tables or lists of records: the page is a document. The one comparison (client, relay, host) is a three-node diagram, not a table, because the reader needs the relationship rather than the values.

## 2. Colour

Every value is a token from DESIGN.md §2. The page uses these roles and no others.

| Landing token              | Day         | Night       | Role                                                                                    |
| -------------------------- | ----------- | ----------- | --------------------------------------------------------------------------------------- |
| `--bg`                     | `#f7f6f3`   | `#121210`   | page background (`--background` / `--canvas`)                                           |
| `--surface`                | `#fbfaf7`   | `#161513`   | screenshot frames, cards (`--surface`)                                                  |
| `--chrome`                 | `#f0efea`   | `#0f0e0d`   | code blocks, footer (`--chrome`)                                                        |
| `--ink`                    | `#1b1b1e`   | `#eeeeef`   | body and heading text (`--foreground`)                                                  |
| `--ink-soft`               | `#626264`   | `#a09f9f`   | secondary text (`--muted-foreground`; 4.52 / 4.50 measured in DESIGN.md §2)             |
| `--ink-dim`                | `#949393`   | `#686767`   | decorative separators only, never text (`--dim`)                                        |
| `--brand`                  | `#2e5dbf`   | `#9fb4e6`   | links and the diagram's link labels (`--brand`)                                         |
| `--primary`                | `#1b1b1e`   | `#eeeeef`   | the primary button's fill (`--primary`)                                                 |
| `--line` / `--line-strong` | `#00000017` | `#ffffff18` | hairlines (`--border`; the two names are one role)                                      |
| `--selection-bg`           | `#d6e0f5`   | `#3a3e4c`   | text selection (`--selection`)                                                          |
| `--focus`                  | `#2f5fc4`   | `#9fb4e6`   | focus ring (`--ring`)                                                                   |
| `--status-needs`           | `#983328`   | `#ef9d90`   | the relay row in the trace, where "needs care" is the meaning (`--status-blocked-text`) |

No gradient, glow or tinted surface stands in for a shadow: depth is one hairline plus one soft shadow with a y-offset, as DESIGN.md §7 requires.

## 3. Type

The app's scale stops at 28 px because it is an application; a landing page needs a display step. The ladder keeps the craft floor's 1.25x rule at both ends of every clamp.

| Role               | Token                                       | At 390 px | At 1440 px | Ratio to the next step                      |
| ------------------ | ------------------------------------------- | --------- | ---------- | ------------------------------------------- |
| Display (h1)       | `clamp(2.4rem, 1.5rem + 3.2vw, 4rem)`       | 38 px     | 64 px      | 1.37x at 390, 1.55x at 1440                 |
| Section title (h2) | `clamp(1.75rem, 1.45rem + 1.25vw, 2.75rem)` | 28 px     | 41 px      | 1.40x, 1.73x                                |
| Subsection (h3)    | `clamp(1.25rem, 1.16rem + 0.36vw, 1.5rem)`  | 20 px     | 24 px      | 1.25x, 1.39x to body                        |
| Body               | `clamp(1rem, 0.97rem + 0.14vw, 1.0625rem)`  | 16 px     | 17 px      | —                                           |
| Small / secondary  | `0.9375rem`                                 | 15 px     | 15 px      | weight and colour carry the step            |
| Mono label         | `0.8125rem`                                 | 13 px     | 13 px      | code, commands, the meta line, step numbers |

The family is the app's own system stack (DESIGN.md §3) with monospace only for code, commands, identifiers and the meta line. Body copy is capped at `32rem` and the lede at `34rem`: 66-72 rendered characters per line at 1440, spaces included. Display tracking is `-0.035em`, above the floor's `-0.04em`.

## 4. Spacing, radius and motion

Base unit 4 px. Section rhythm: `clamp(72px, 9vw, 128px)` above and below each section, with the heading block at most 56 px below itself, so the space above a heading stays at least 1.5x the space below it. Feature rows are `clamp(28px, 4vw, 44px)` apart; groups inside a row are 12-14 px.

Radius: 16 px for a frame or card, 12 px for a button, 9 px for an image inside a frame. Shadows: `0 1px 2px` for a card, `0 2px 4px / 0 28px 60px -32px` for the hero frame.

Motion tokens are the app's: `--ease-out` as `cubic-bezier(0.23, 1, 0.32, 1)`, 160 ms on hover and press (transform and colour only), and one scroll-driven arrival (`animation-timeline: view()`, opacity and a 12 px rise) that exists only inside `prefers-reduced-motion: no-preference` and only where the browser supports it. Nothing loops.

## 5. Components

Each component ships its states: hover, focus-visible (2 px `--focus` outline, 2 px offset), and pressed (1 px settle). Hit areas are at least 44 px on coarse pointers and 32 px on fine ones.

| Component        | Parts                                                                             | Notes                                                                                                               |
| ---------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Header           | mark + name, four anchors, bordered app button                                    | sticky, solid `--bg` (no blur), one hairline below; anchors hidden below 720 px, where the app button takes the row |
| Button           | primary (filled `--primary`), secondary (bordered), quiet (bordered, transparent) | one filled button per view; the label never changes width between states                                            |
| Text link        | `--brand`, 1 px underline at 0.22em offset                                        | underline colour strengthens on hover                                                                               |
| Hero             | mark, h1, lede, action row, meta line, stage                                      | centred above 720 px, start-aligned below                                                                           |
| Desktop frame    | one hairline, 7 px padding, 16 px radius, soft shadow, 16:10                      | holds the workspace mock; a grid column, so it shrinks beside the phone                                             |
| Phone frame      | 5 px bezel, 26 px radius                                                          | holds the phone mock drawn at 390x844 and scaled to 260 or 240 px; the hero's only picture below 720 px             |
| Feature row      | copy column + media column, alternating sides                                     | stacks to one column below 900 px with the media second                                                             |
| Trace            | three mono rows (client, relay, host)                                             | the relay's row carries `--status-needs`; its text is the fact, the colour is a second cue                          |
| Terminal snippet | `--chrome` block, mono, dim comments                                              | real commands only, never sample output                                                                             |
| Steps            | three columns with a mono number and a top rule                                   | stacks below 900 px                                                                                                 |
| Diagram          | three nodes joined by labelled rules                                              | labels are "Noise"; the rules become vertical and labelled to the side below 900 px                                 |
| Fact             | h3 with a top rule and a paragraph                                                | three across, stacked below 900 px                                                                                  |
| Install card     | h3, paragraph, platform list, action                                              | two across, stacked below 900 px                                                                                    |
| Footer           | brand + tagline, three link columns, a bottom line                                | four columns above 900 px, two below                                                                                |

### Detect waivers

The render lint runs clean on the page with three waivers, each on a mock and each for a rule the app's own components answer to in `DESIGN.md` rather than here:

- `low-contrast` on the space lists: the coloured space avatar carries a white initial that `DESIGN.md` §2 declares decorative ("the initial needs no text contrast"); the row's name and counts pass on their own.
- `tight-leading` on every mock: the app's chips and badges set `leading-none` inside their pills, as the app ships them.
- `nested-cards` on every mock: the desktop frame is a device, and the panes inside it are the app's own pane cards.

## 6. Verification

Visual QA captures live in this directory (`375`, `768`, `1280`, `1440`, light and dark) with the social card beside them. The audit is Lighthouse on the production build through a real Chrome, mobile and desktop, all four categories.
