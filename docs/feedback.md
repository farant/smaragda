# Smaragda Suggested Improvements

Compiled from a full day of building and navigating the Bronze Age Trade Networks workspace. These fall into three categories: a new primitive (the historical timeline), token conservation across existing tools, and palace-specific fixes.

---

## 1. New Primitive: Historical / Temporal Entities

### 1.1 Temporal Anchor as First-Class Concept

**Problem:** Currently, dates live in text attributes like `date_range: "c. 1950-1719 BC"` or `period: "c. 1400-1200 BC"`. The system can't sort, filter, or reason about time. You can't ask "what happened between 1800 and 1700 BC" without string matching on the LLM side.

**Proposal:** Add a temporal primitive — either as a special genus kind (like `feature` or `relationship`) or as a universal feature that can be attached to any entity. Every temporal entity gets:

- `start_year` (number) — negative for BC, positive for AD
- `end_year` (number, optional) — for point events, same as start_year or null
- `precision` (enum: exact / approximate / century / millennium)
- `calendar_note` (text, optional) — for things like "regnal year 8 of Ramesses III"

**Key capability unlocked:** A `timeline` query that returns all temporally-anchored entities across all genera, sorted chronologically. This unifies the entire workspace graph along the time axis. You'd immediately see cascading patterns like:

```
c. 1836 BC  Kanesh Karum II destroyed (Event)
c. 1800 BC  Mari at peak (Civilization status: thriving)
c. 1761 BC  Hammurabi destroys Mari (Event)
c. 1757 BC  Eshnunna destroyed (Event)
c. 1750 BC  Babylonian empire fragments (Civilization status: disrupted)
c. 1719 BC  Karum Ib ends (Event)
c. 1600 BC  Cyprus rising (Civilization status: emerging)
...
```

The causation chain becomes visually self-evident in a way that browsing individual entities never achieves.

**Design consideration:** Whether temporal anchoring should be opt-in (a feature genus you attach) or built into every entity by default. Opt-in is more flexible but means remembering to attach it. Built-in means some entities have empty temporal fields. Probably opt-in is cleaner — not everything needs a date.

---

## 2. Token Conservation

### 2.1 `describe_system` — Compact by Default

**Problem:** Currently dumps every genus definition (all attributes, all states, all transitions), every relationship genus, every action, every process, every serialization target. For a mature workspace this is thousands of tokens. The caller usually just wants an overview.

**Proposal:** Default response should be a compact summary:

```
Taxonomies: 1 (Bronze Age Trade)
Entity genera: 7 — Civilization(14), Port(34), Commodity(8), Route(6), 
                    Vessel(1), Event(12), TinSource(7)
Relationship genera: 6 — Controls(8), Trades(12), ConnectsTo(10), ...
Feature genera: 0
Action genera: 0
Process genera: 1 — Publication
Workspaces: 1 — Bronze Age Trade Networks (82 entities)
Tasks: 1 pending
Errors: 6 unhealthy
```

Genus names + entity counts + relationship counts. No attribute definitions, no state machines, no transition lists. Add a `verbose: true` parameter for the full dump when actually needed.

### 2.2 `list_entities` — Summary Mode

**Problem:** Returns the complete materialized state for every matched entity, including long text attributes like `notes` and `description`. Listing 34 ports with full notes fields can easily be 5,000+ tokens.

**Proposal:** Add a `compact: true` parameter (or make it the default). Compact mode returns:

```json
{ "id": "01KH...", "genus": "Port", "status": "major_hub", 
  "name": "Enkomi (Alashiya)", "region": "Eastern Cyprus" }
```

Just id, genus, status, and the `name` attribute (or whichever attribute is marked `required`). The caller uses `get_entity` when they need the full record. This is the 90% use case — you're browsing, confirming, or picking an entity to inspect further.

### 2.3 `list_relationships` — Summary Mode

**Problem:** Same issue as `list_entities`. Returns full member entity details for every relationship.

**Proposal:** Compact mode returns just the relationship id, genus, status, and member entity names/ids — not the full materialized state of each member.

### 2.4 `get_history` — Diff Mode

**Problem:** Returns every tessella with full attribute snapshots. For an entity that's been edited ten times, you get ten complete copies of all attributes, when what you usually want is the *sequence of changes*.

**Proposal:** Add a `diff: true` parameter. Returns only the fields that changed in each tessella, plus the timestamp and action context. Full snapshots still available with `diff: false`.

### 2.5 `build_room` — Quiet Confirmation

**Problem:** Building or merging a room returns the full room rendering: description, all scrolls, all actions, all notices. Useful for verification, but when you're building multiple rooms in sequence you already know what you just sent.

**Proposal:** Add a `quiet: true` parameter. Returns just: room slug, name, action count, portal count, scroll count. The full rendering is still available via `palace_action` (teleport) when you want to verify.

### 2.6 `create_entity` / `create_entities` — Echo Control

**Problem:** Creating an entity returns the full materialized state, including the complete text of every attribute you just sent. When creating entities with long `notes` fields, you get your own text echoed back verbatim.

**Proposal:** Compact creation response: just id, genus, status, and name. The caller already knows what they sent. Full echo available with `verbose: true` if needed.

### 2.7 `palace_action` Query Results — Summary Mode

**Problem:** When a palace room fires a query action (e.g., `list_entities` for all Cypriot ports), the results include the full materialized state of every matched entity. This is the `list_entities` problem filtered through the palace layer.

**Proposal:** Palace query actions should use the compact form of their underlying tools by default. The room is for navigation and overview; deep inspection is what `get_entity` is for.

---

## 3. Palace-Specific Fixes

### 3.1 Navigate Actions Fail After Position 7

**Problem discovered during this session:** When a room has more than 7 actions (queries + navigates + text combined), `palace_action` calls to action numbers 8+ fail silently — they return the global action help text instead of executing. This forces a hard cap of 7 actions per room.

**Impact:** Limits room design. Rooms that are natural hubs (like our Counting House, which connects to 6+ other rooms plus has query actions) are forced to consolidate navigation links, losing navigational clarity.

**Proposal:** Either fix the indexing so higher action numbers work, or if the limit is intentional, document it clearly and perhaps increase it to 10-12.

### 3.2 `list_relationships` Unavailable in Palace Query Vocabulary

**Problem discovered during this session:** Palace query actions accept tool names like `list_entities` and `search_entities`, but `list_relationships` doesn't appear to be in the vocabulary of tools available to palace rooms.

**Proposal:** Add `list_relationships` (and any other query tools) to the palace action vocabulary.

### 3.3 Tool Name Prefix Confusion

**Problem discovered during this session:** Palace query actions require bare tool names (`list_entities`) not the MCP-prefixed names (`smaragda:list_entities`). This isn't documented and the error mode is silent failure.

**Proposal:** Either accept both forms, or document clearly that palace query actions use bare names.

### 3.4 Duplicate Room Accumulation

**Problem:** Building rooms with the same slug across different sessions creates visible duplicates on the palace map. Old versions persist alongside new ones. The map becomes cluttered with stale rooms.

**Proposal:** Either a `prune_rooms` command to remove orphaned/stale room versions, or have `build_room` (without `merge: true`) fully replace any existing room with the same slug rather than creating a parallel version.

---

## 4. Minor Quality-of-Life

### 4.1 `search_entities` Across Genera

Currently `search_entities` does case-insensitive substring matching across all string attributes, which is good. But there's no way to search across *relationship members* — e.g., "find all entities related to Cyprus" where Cyprus appears in a related entity's name, not in the entity's own attributes. This might be too complex for now but would be powerful for graph navigation.

### 4.2 Entity Count on Genus in `list_genera`

`list_genera` returns genus definitions but not how many entities exist for each. Adding a count would make it a lightweight alternative to `describe_system` for quick orientation.

### 4.3 `batch_update` Status Chaining

Currently you can chain status transitions in `batch_update` (e.g., known → active → major_hub as two operations on the same entity). This works but requires knowing the intermediate states. A `target_status` that auto-traverses the shortest valid path would save operations and tokens.

---

## Summary by Priority

| Priority | Item | Impact |
|----------|------|--------|
| **High** | 2.1 `describe_system` compact mode | Biggest single token saver — called frequently for orientation |
| **High** | 2.2 `list_entities` compact mode | Second biggest — called constantly for browsing |
| **High** | 1.1 Temporal primitive | New capability — unlocks timeline queries across entire workspace |
| **High** | 3.1 Fix action limit > 7 | Palace usability blocker |
| **Medium** | 2.6 Create entity echo control | Noticeable on batch creates with long text |
| **Medium** | 2.5 `build_room` quiet mode | Saves tokens during palace construction sessions |
| **Medium** | 2.7 Palace query summary mode | Inherits benefit from 2.2 |
| **Medium** | 3.4 Duplicate room cleanup | Palace map clarity |
| **Medium** | 3.2 `list_relationships` in palace | Missing capability |
| **Low** | 2.3 `list_relationships` compact | Less frequently called |
| **Low** | 2.4 `get_history` diff mode | Specialized use case |
| **Low** | 3.3 Tool name prefix docs | Documented workaround exists |
| **Low** | 4.1-4.3 Quality of life | Nice to have |
