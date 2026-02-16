# Smaragda UI Architecture

## Core Principles

### No Scrolling

The UI has zero tolerance for scrolling. Every view is a fixed-frame page that fits
entirely on screen. This forces ruthless prioritization, creates spatial memory
(items have stable positions), and makes navigation predictable. Content that exceeds
one frame is paginated, not scrolled.

### The Desktop Metaphor

The primary UI surface is a **desktop** — a fixed-size canvas (always full screen) with
draggable cards on it. Instead of windows, applications, or scrollable lists, the user
works with cards arranged spatially on desktops. Desktops can be nested: double-clicking
a card that represents a desktop navigates *into* it, revealing another full-screen
canvas. Navigation is spatial and hierarchical, like nested rooms rather than stacked
windows.

This is similar to Figma's canvas model but with a critical difference: instead of one
infinite scrollable canvas, there are infinite nested *finite* canvases, each exactly
screen-sized.

### Everything is a Card

Cards are the universal unit. They can represent:

- **Entity references** — named icons representing kernel entities (Issues, Persons, etc.)
- **Text notes** — freeform text cards, like sticky notes
- **Images/screenshots** — visual cards
- **Typed attribute cards** — cards matching specific data types
- **Nested desktops** — cards that contain their own canvas of cards
- **Hyperlink icons** — cards that navigate to other locations

A card is not a *copy* of an entity — it's a **reference**. The same entity can appear
as a card on many desktops simultaneously. This allows the user to build curated
workspaces by placing references to relevant entities together, without duplicating data.

Every card/file can also act as a folder — any card can potentially contain internal
depth (see Inner Navigation below).

### Cards Have Internal Depth

A card can have its own internal structure. An epub book is a single card in the global
index, but internally it contains chapters, pages, sentences. A document card might
contain multiple pages of text. A nested desktop card contains a full canvas of other
cards.

When you navigate *into* a card, its internal content fills the screen. Your position
within the card is remembered — if you navigate away and come back, you return to where
you were inside it (e.g., chapter 7, paragraph 3 of the epub).

This creates two dimensions of state per card: its **external identity** (index in the
global stack, position on a desktop) and its **internal state** (where you are inside it).


## Navigation Model

### Five Navigation Modes

All navigation results in fixed-frame views. No mode involves scrolling.

**1. Spatial** — drag cards around on a desktop to arrange, cluster, and organize them.
Card positions are persistent and meaningful. This is thinking with your hands — the
spatial arrangement is a form of reasoning and information that doesn't exist in the
underlying data.

**2. Hierarchical** — double-click a card to navigate *into* it (a nested desktop, an
entity's detail view, an epub's content). Press back to navigate *out* to the parent
context. This creates depth without breadth.

**3. Sequential** — every item in the system gets a monotonically increasing index number
when created. You can always press next/previous to walk through everything linearly,
like flipping through a deck of cards. This is the universal escape hatch — if you can't
find something spatially, scan through sequentially.

**4. Linked** — `#123` anywhere in text is a clickable link to the item at that index.
Universal addressing — any item can reference any other item by number.

**5. Circular (tag rings)** — `#tagname` in text navigates to the *next* item tagged with
that tag. Clicking again goes to the next, and so on, looping back to the start. Tags
are not categories viewed in a list — they are *circuits* you travel. An item can be on
multiple tag rings simultaneously.

### The Back Stack

Context switches (entering a card, following a `#123` link) push to a navigation back
stack. The back button walks this stack. However, sequential next/previous within the
global index and inner navigation within a card do NOT push to the back stack — these
are browsing, not context switches.

### Inner vs. Outer Navigation

**Outer navigation** moves between top-level items in the global index. Page 110
(an epub), page 111 (a note), page 112 (a desktop).

**Inner navigation** moves within a single item. Paging through sentences in the epub
at index 110. The inner position is remembered per card.

Going "next" at the outer level moves from page 110 to 111. Going "next" at the inner
level moves to the next sentence within page 110.


## Screen Structure

### Two-Page Spread

The base display unit is two side-by-side pages, like an open book. This is the only
layout — the app is always full screen, never responsive, never resizable.

When viewing a desktop, it fills both pages (or each page could be an independent
desktop/pane). When reading a document or epub, the two pages show facing pages of
content. The transition between desktop view and reading view is a full context switch,
not an overlay.

### Independent Panes

Each page in the spread can operate somewhat independently, like tmux panes. The left
pane might show a desktop with Issue cards while the right pane shows a specific Issue's
content. Each pane has its own navigation history.

### Multiple Screens

Multiple screens can be open simultaneously, switchable via tabs or keyboard shortcuts
(like tmux windows or spreadsheet sheets). Each screen has its own two-pane spread.
Examples: an "Editorial" screen, an "Infrastructure" screen, a "Tasks" screen.

Screens are persistent — they restore on app launch with the same panes, same content,
same state.


## Text Conventions

All text in the system — notes, descriptions, annotations, messages — supports four
interactive conventions:

### `#123` — Index Links
Links to the item at that global index number. Clickable anywhere. Universal addressing.

### `#tagname` — Tag Circuits
Navigates to the next item with that tag, forming a circular linked list. Clicking
repeatedly orbits through all tagged items. Useful for workflows: `#todo`, `#review`,
`#blocked`.

### `$command` — Executable Commands
Triggers an action. Like a shell command embedded in context. Examples:
- `$new-desktop` — create a new desktop
- `$approve` — approve the current entity
- `$this-month` — navigate to calendar view
- `$assign-to:Maria` — parameterized command

Similar to Acme's "any text can be a command" philosophy, but with `$` as the
convention. Commands can appear in notes, annotations, sticky notes from Claude —
giving the user shell-like power in any context.

### `<xml>` — Structured Commands
For complex operations that need structured arguments. Escape hatch when `$command`
isn't expressive enough:

```
<assign person="Maria" role="artist" deadline="2026-03-01">
  Chapter 3
</assign>
```

Also supports literate programming — code blocks within cards that are executable
within the environment.


## Entity Interiors vs. Workspace Desktops

There are two kinds of desktops, and the distinction matters:

### Workspace Desktops

Curated surfaces the user (or Claude) creates for a particular workflow or context.
"My editorial sprint," "Chapter 3 review," "Today's tasks." These are their own res.
They contain **placements** — references to entities at specific positions. The same
entity can appear on many workspace desktops.

Workspace desktops are personal (or explicitly shared). My arrangement of cards for my
workflow doesn't affect anyone else's workspace.

### Entity Interiors

When you double-click a card to navigate *into* an entity, you see that entity's own
internal desktop. This interior belongs to the entity, not to the placement or the
workspace you came from. If order-123 has an internal desktop with notes and sub-cards
arranged on it, **every reference to order-123 opens the same interior** regardless of
which workspace you navigated from.

This means:
- Notes placed inside an entity are visible to anyone who opens that entity
- Claude adding annotations inside an entity's desktop is shared context
- Arranging cards inside an entity organizes the entity itself, not a personal view

### The Distinction

My workspace desktop = my personal organization of references.
An entity's interior desktop = shared context intrinsic to the entity.

When Claude sets up a workspace for you, it creates a new workspace desktop with
references to relevant entities. When Claude adds notes *inside* an entity (e.g.,
review annotations on Chapter 3), those are part of the entity's interior and visible
to everyone who opens it.

Both are res in the kernel and both use the same desktop/card rendering. The difference
is ownership and scope, not mechanism.


## Persistence and State

### Three Tiers of UI State

**Persistent state** — which screens are open, what's in each pane, card positions on
desktops, which entity is selected, inner navigation position within cards, pagination
state. Restored on app launch. Stored as kernel res (Workspace genus) so it benefits
from tessella history, sync, and potentially branching.

**Session state** — modals open, search filters active, partially filled forms,
expanded/collapsed sections. Survives app backgrounding but resets on quit. Held in
client memory or lightweight local store outside the kernel.

**Ephemeral state** — animation progress, hover states, drag preview positions. Exists
only in the render loop.

**The test:** Would I be confused if this were different when I reopened the app? If
yes → persistent. If no → session or ephemeral.

### Workspace as Kernel Res

Desktops, card placements, and positions are stored as res in the smaragda kernel. This
means:

- Workspace state syncs across devices
- Claude can read and create workspaces through MCP
- Tessella history provides a record of workspace evolution
- Branching could allow experimental workspace layouts

A **placement** is a reference linking an entity to a position on a desktop. The same
entity can have placements on many desktops. Each placement may carry display
preferences (compact icon vs. expanded card, card type override).

### Compression Considerations

UI state changes frequently (every drag, every navigation). Options for managing
tessella volume:

- **Snapshot approach** — write a single state tessella on quit or periodically,
  not on every mutation
- **Compression policies** — compact old UI tessellae into snapshots after a time
  threshold (e.g., monthly)
- **Client-local option** — workspace res exists in local SQLite but doesn't sync
  (each device has its own layout)

The right approach likely varies per state type. Desktop card positions: snapshot on
quit. Screen/pane configuration: persistent per-device.


## LLM Integration

### Claude as Workspace Author

Claude has full access to the kernel through MCP, including workspace state. It can:

- Create desktops pre-populated with relevant entity cards
- Arrange cards spatially based on relationships and context
- Add sticky notes with annotations, `$commands`, and `#links`
- Observe how the user has arranged cards (clustering as a signal)
- Generate guided workflows as a series of annotated desktops

**Example flow:** User says "I need to work on the Chapter 3 publication." Claude
creates a desktop with the Chapter 3 Issue card, Page cards arranged in order, the
assigned artist's Person card nearby, open tasks, and sticky notes explaining what
needs attention. The user opens it and has a ready-made workspace.

### Task-Driven Guidance

Tasks (from the kernel's Task genus) become guided experiences:

1. User receives a task from Claude
2. Opening/accepting the task navigates to a prepared workspace
3. Sticky notes annotate specific elements: "I flagged this paragraph because..."
4. `$commands` in annotations let the user act inline: `$approve` or `$request-revision`
5. Completing actions advances the task; next task appears if chained

### Sticky Notes as Bidirectional Communication

- **Claude → User:** Annotations on entities with context, concerns, suggestions.
  Targeted at specific attributes or features.
- **User → Claude:** Dropping a sticky note on a card: "this doesn't feel right" or
  "can you find a better reference?" The note's placement gives Claude full context
  without the user having to explain what they're looking at.

### Tutorial System

Tutorials are not a special mode — they are desktops with instructional cards,
`#links` to relevant entities, and `$commands` for guided actions. The branch system
allows tutorials to run in a sandbox with pre-seeded data. Achievement tracking uses
the existing Feature genus on a User entity.


## UI IR Architecture

### Server-Driven UI

The kernel controls what the UI looks like across all clients by emitting a component
tree (UI IR), not just data. Clients render ~15-20 primitives mapped to native
equivalents. New genus types can have completely custom layouts without client code
changes.

### Three-Tier Component Vocabulary

**High-level (semantic compounds)** — opinionated components with smart defaults.
Cover 90% of cases without the kernel specifying layout details.
Examples: `entity_header`, `attribute_section`, `feature_list`, `action_bar`,
`desktop_surface`, `card`.

**Mid-level (structural)** — layout control without going fully atomic.
Examples: `card`, `section`, `collapsible`, `key_value`, `list`, `grid`, `spread`.

**Low-level (primitives)** — full control over rendering.
- Layout: `stack`, `row`, `spacer`
- Text: `heading`, `text`, `label`
- Data: `badge`, `health_dot`
- Interactive: `button`, `link`, `text_input`, `select`
- Utility: `divider`

The `generateIR` function defaults to high-level components. Genus presentation hints
can override specific sections with mid or low-level trees. Optimization passes can
rewrite high-level nodes into low-level ones for custom layouts.

### IR-Aware Text Rendering

The text rendering primitive must understand the four text conventions (`#index`,
`#tag`, `$command`, `<xml>`) and make them interactive. This is a fundamental primitive,
not an add-on.

### Space Budgets

Since every view is fixed-frame, the IR knows exactly how much space is available.
High-level components can negotiate space allocation. If an entity has 40 features,
the `feature_list` component knows to show a summary ("40 pages · 12 approved · 3
draft") with a link to drill in, rather than trying to list them all.

### Optimization Passes

Pure transformations on the IR tree before rendering:

1. **Prune** — remove elements not relevant to current context
2. **Prioritize** — sort by importance, promote primary actions
3. **Simplify** — collapse single-option choices, highlight anomalies
4. **Collapse** — if entity is incomplete, replace full detail view with a "setup"
   view showing only what's needed
5. **Budget** — enforce space constraints, switch to compact representations when needed


## Implementation Roadmap

- **Demo 14:** UI IR system, presentation hints on genera, `generateIR` function,
  optimization passes, generic HTML renderer at `GET /ui/:res_id`
- **Demo 15:** Swift kernel library, SwiftUI IR renderer, native macOS app with
  desktop/pane/screen structure
- **Post-demo:** iOS app, advanced desktop metaphor (drag/drop, spatial persistence),
  full text convention system, tutorial/achievement framework
