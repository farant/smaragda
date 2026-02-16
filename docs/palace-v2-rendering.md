# Palace v2: Prose Rendering

## Problem

Palace rooms currently use static descriptions with numbered action menus. This works but has two issues:

1. The action menu breaks the narrative — numbered lists feel like a database UI wearing a costume.
2. Entity state is invisible until you explicitly query it. The room description doesn't react to what's actually in the workspace.

## Core Idea

Room descriptions are agent-authored prose with lightweight markup. Entities and portals are embedded inline. The engine resolves the markup at render time against live entity state, producing readable text where interactive nouns appear in CAPS. No action menus — the player interacts by typing natural verbs (`look`, `go`, etc.) targeting the CAPS nouns.

## Authoring Format

Agents write room descriptions in markdown-ish prose with two kinds of inline markup:

### Entity References: `*genus:name*` or `*genus:id*`

Places an entity in the scene. The engine resolves the reference, runs the genus render template, and displays the result in CAPS.

```
The corkboard on the north wall holds pinned notes —
*geological-survey:Granite Formation Analysis* sits on top,
marked urgent. *geological-survey:Basalt Survey #12* and
*geological-survey:Sandstone Core Report* are filed beneath it.
```

Renders as:

```
The corkboard on the north wall holds pinned notes —
GRANITE FORMATION ANALYSIS sits on top, marked urgent.
BASALT SURVEY #12 and SANDSTONE CORE REPORT are filed
beneath it.
```

The `*genus:name*` form resolves by name lookup within the genus. The `*genus:id*` form resolves by entity ID directly. If the entity doesn't exist or has been archived, the engine can either omit it silently or render a placeholder (configurable per room).

### Portals: `[slug]prose description[/]`

Links to another room. The prose between the tags is the visible text, rendered in CAPS.

```
Through the [balcony]double doors to the east[/], sunlight
spills across the stone floor.
```

Renders as:

```
Through the DOUBLE DOORS TO THE EAST, sunlight spills across
the stone floor.
```

## Genus Render Templates

Each genus can define templates (handlebars-style) that control how its entities present themselves at different detail levels. If no template is defined, a default renderer is used.

### Detail Levels

| Level | When Used | Purpose |
|-------|-----------|---------|
| `mention` | Inline in room prose (the CAPS text) | Name only, or name + one salient attribute |
| `glance` | `/look ENTITY` | A sentence or short paragraph — key attributes in prose form |
| `inspect` | `/examine ENTITY` | Full attribute listing, relationships, features |

### Template Syntax

Templates use handlebars-style delimiters with access to entity attributes, features, and relationships:

```handlebars
{{!-- mention: what appears in CAPS in the room --}}
{{mention}}
  {{name}}{{#if (eq status "urgent")}}, URGENT{{/if}}
{{/mention}}

{{!-- glance: a short prose summary --}}
{{glance}}
  {{name}} — filed by {{filed_by}}, {{relative_time created_at}}.
  Status: {{status}}.
  {{#each features}}
    {{this.glance}}
  {{/each}}
  {{#if relationships}}
    Related to {{#each relationships}}{{this.target.name}}{{#unless @last}}, {{/unless}}{{/each}}.
  {{/if}}
{{/glance}}

{{!-- inspect: full detail view, falls back to default key=value if not defined --}}
```

### Default Templates

When a genus doesn't define custom templates:

- **mention**: `{{name}}` (just the entity name, CAPS)
- **glance**: `{{name}} ({{genus_name}}). Status: {{status}}.` followed by all non-empty attributes as `key: value` lines
- **inspect**: Full attribute dump, all features, all relationships — essentially what the current entity view shows

## Interaction Verbs

No numbered actions. The player types natural commands targeting CAPS nouns:

| Verb | Target | Effect |
|------|--------|--------|
| `look` / `l` | entity name | Render entity at `glance` level |
| `examine` / `x` | entity name | Render entity at `inspect` level |
| `go` | portal text | Navigate to the linked room |
| `search` / `find` | free text | Search entities in the workspace |
| `write` | — | Write a scroll in the current room |
| `back` | — | Return to previous room |
| `map` | — | Show palace map |
| `inventory` | — | Show workspace summary |

### Name Resolution

Entity names are resolved by fuzzy matching against visible entities in the current room:

1. Exact match (case-insensitive)
2. Prefix match ("granite" matches "Granite Formation Analysis")
3. Substring match ("formation" matches "Granite Formation Analysis")
4. If ambiguous: "Did you mean GRANITE FORMATION ANALYSIS or GRANITE CORE SAMPLE?"

Portal names resolve similarly against visible portals in the room.

## Render Pipeline

```
Agent authors room    →  stored as template string with *entity* and [portal] markup
Player enters room    →  engine resolves all entity refs against live state
                      →  genus mention templates produce the CAPS display text
                      →  portals resolve to room slugs
                      →  final prose output with CAPS nouns
Player types command  →  parse verb + target
                      →  resolve target against room's entity/portal manifest
                      →  render at appropriate detail level (glance/inspect/navigate)
```

## Staleness and Re-rendering

Each room stores a manifest of referenced entities and portals. On render:

1. Resolve each `*genus:name*` reference against current state
2. If an entity has been archived/deleted → omit from prose (or show `[REMOVED]`)
3. If an entity's status changed → the mention template picks it up automatically (it re-evaluates)
4. If new entities exist that aren't in the description → they don't appear (the room needs re-authoring)

The engine can detect staleness: "This room references 3 surveys but the workspace now has 12." This could surface as a notice prompting re-authoring, or rooms could have a `<Collection>` block for dynamic sets (see Future Work).

## Progressive Enhancement

The v2 rendering system layers on top of the existing palace. Nothing breaks. Old rooms keep working. Each step is independently useful.

### Step 0: Current system (no changes)

Rooms have static descriptions and numbered action menus. Agents author rooms via `build_room` with a plain text description string. `palace_action` dispatches by number. This continues to work unchanged at every subsequent step.

### Step 1: Markup recognition in room descriptions

The render pipeline learns to detect `*genus:name*` and `[slug]...[/]` in room descriptions. If present, resolve entity refs and render as CAPS inline. If the description has no markup, render it exactly as today.

A room built with:
```
The shelf holds *geological-survey:Granite Analysis* and *geological-survey:Basalt Report*.
```
renders the CAPS nouns. A room built with a plain string renders as-is. Both are valid. The `build_room` tool doesn't change — it already accepts a description string.

The numbered action menu still renders below. Rooms that use markup get both CAPS nouns and numbered actions during the transition.

### Step 2: Verb parser alongside numbered actions

Add verb-based interaction (`look`, `go`, `examine`, etc.) with fuzzy name resolution against the room's entity/portal manifest. This works in parallel with numbered actions:

- Type `look granite` → resolves to entity, shows glance view
- Type `go balcony` → resolves to portal, navigates
- Type `1` → still works, dispatches numbered action as before

No room needs to change. Rooms with CAPS nouns benefit from verbs. Rooms without them still use numbers. The CLI supports both input styles simultaneously.

### Step 3: Genus render templates

Add optional `mention`, `glance`, and `inspect` templates to genus definitions (via `evolveGenus` — additive, no migration needed). If a genus defines templates, entity rendering uses them. If not, fall back to defaults:

- **mention default**: `{{name}}`
- **glance default**: `{{name}} ({{genus_name}}). Status: {{status}}.` + non-empty attributes
- **inspect default**: full key=value dump (current behavior)

Genera can be enhanced one at a time. An enhanced genus renders nicely everywhere it appears. An unenhanced genus still works with the defaults.

### Step 4: Collection blocks, feature templates, nested rendering

Only needed when specific rooms or genera want richer dynamic prose. See Future Work below. Everything from steps 0-3 continues working.

### Compatibility

At every step:

- **Old rooms**: plain descriptions + numbered actions. No change needed.
- **Old genera**: no render templates. Default mention/glance/inspect.
- **Old agents**: agents that don't know about markup keep building rooms the current way. Works fine.
- **New agents**: can use markup in descriptions, benefit from CAPS + verbs.
- **Mixed**: a workspace can have v1 rooms and v2 rooms. Navigation between them works — you just switch between numbered-action and verb-based interaction depending on the room.

## Future Work

### Collection Blocks

For rooms that should show dynamic sets of entities (not hand-placed):

```
The filing cabinet contains:
{collection genus="geological-survey" sort="created_at" limit=5}
  {{#switch count}}
    {{#case 0}}Empty drawers gather dust.{{/case}}
    {{#case 1}}A single survey: {{first.mention}}.{{/case}}
    {{#default}}{{count}} surveys — {{first.mention}} on top.{{/default}}
  {{/switch}}
{/collection}
```

This handles the "47 surveys" problem — the agent writes the summarization strategy, the engine fills in live data.

### Nested Entity Rendering

Entities that contain other entities (via relationships or features) can delegate rendering downward:

```handlebars
{{glance}}
  Research team "{{name}}" ({{status}}).
  Members: {{#each members}}{{this.mention}}{{#unless @last}}, {{/unless}}{{/each}}.
{{/glance}}
```

Each member renders itself using its own genus mention template. Composition without the parent knowing the child's genus details.

### Feature-Level Templates

Feature genera define their own prose rendering:

```handlebars
{{!-- feature genus: location --}}
{{inline}}collected from {{formation_name}}{{/inline}}
{{detail}}Collected from {{formation_name}} at coordinates {{lat}}, {{lon}}.{{/detail}}
```

An entity's glance template can include `{{#each features}}{{this.inline}}{{/each}}` and each feature renders itself.
