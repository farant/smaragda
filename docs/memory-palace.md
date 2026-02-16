
MCP Memory Palace
Design Document — Version 1
Spatial Navigation for Large Knowledge Graphs

Smaragda MCP Server Extension
February 2026
Draft

1. The Problem
An LLM navigating a knowledge graph with tens of thousands of entities faces a fundamental challenge. Flat listing breaks down — there are too many entities to scan. Keyword search is too narrow — you have to know what you are looking for. Loading everything into context is impossible — the context window is finite. And every new conversation starts from zero — the LLM has no memory of previous explorations.
The current MCP tool surface (list_entities, search_entities, get_relationships) works adequately for small graphs. But at scale, Claude must make dozens of exploratory calls just to orient — describe_system, list_genera, list_entities per genus, get_relationships — before it can begin meaningful work. This orientation dance wastes context window, wastes time, and produces no durable benefit because the next conversation starts from scratch.
Physical space solves this problem elegantly. A city of ten thousand buildings is navigable because space provides proximity (nearby things are related), orientation (you know where you are relative to everything else), landmarks (memorable reference points), and persistence of position (you can leave and come back to the same place). The Memory Palace applies these spatial principles to knowledge graph navigation.
2. The Vision
The Memory Palace is an inherited workshop that Claude builds and tends across conversations. Each workspace in Smaragda has its own palace — a graph of rooms connected by portals, furnished with exhibits that link to real entities, and annotated with scrolls that capture Claude’s synthesis and observations.
When Claude enters a workspace, it enters the palace that previous Claudes built. Rooms are already furnished. Scrolls record past insights with relative timestamps (“3 days ago”). Actions are wired up and ready. Claude picks up where its predecessor left off, extending the palace as new areas are explored.
The interaction model is inspired by text adventure games — Zork in particular. Claude sees a room description with numbered actions and picks one. Navigation is always a single tool call: “action 3.” The palace wraps complex MCP operations behind simple menu choices, making the knowledge graph feel like a place rather than a database.
The palace should feel vivid and imaginative — a castle with cracked floors in the Geology hall, dusty scrolls in Cuvier’s study, sunlight through stained glass in the entry. The vividness is functional: medieval memory palace tradition works because spatial imagery makes information memorable. A clinical database UI with room labels would lose the mnemonic power that makes this approach work.
3. Constraints
These are the hard requirements that bound the design. All proposals and decisions must satisfy every active constraint.
#
Constraint
Rationale
C1
Claude builds the rooms
The palace is Claude’s own navigation aid. It needs to reflect how Claude understands the data, not how a human would organize a museum.
C2
One palace per workspace
Workspaces already scope entities. The palace navigates those entities, so it should be scoped the same way.
C3
Palace loads on workspace entry
Replaces the multi-call orientation dance with spatial awareness from the start.
C4
Actions can be arbitrary
Any action text can lead to any result — narrative, MCP call, parameterized query, navigation, or combination.
C5
Must scale to 10k+ entities
The palace exists specifically for the case where flat listing breaks down.
C6
Vivid, not clinical
The memory palace tradition works because spatial imagery makes information memorable. Vividness IS the feature.
C7
Inherited, not rebuilt
The palace IS the continuity mechanism between conversations. Claude drops into the workshop its predecessor left.
C8
Relative timestamps everywhere
All dated data includes human-readable durations (“3 days ago”) so Claude has instant temporal orientation.


4. Architecture
4.1 Core Concepts
Room — A navigational node with a name, a slug (URL-safe identifier), and a vivid description authored by Claude. Rooms contain actions and scrolls. Identity: ULID + slug + display name. Rooms represent clusters and themes, not individual entities — a “Hall of Geology” contains exhibits for multiple claims and leads, keeping room count manageable at scale.
Action — A numbered choice available in a room. Three types: navigate (go to another room), query (execute an MCP tool and return results), text (display static content). Each action has a human-readable label. Actions can accept optional string parameters from Claude.
Scroll — A dated note written by Claude, placed in a room. Has a title and body. Auto-stamped with creation time, displayed with relative timestamps. Append-only — to update, write a new scroll.
Portal — A bidirectional connection between two rooms. Created when Claude links rooms via navigate actions. Portals make the palace a graph, not a tree.
4.2 What the Palace Is Not
The palace is not a 1:1 mirror of the entity graph. Rooms are curated by Claude at a higher abstraction level. Not every entity gets a room or even an exhibit. The palace is Claude’s understanding of the graph — an opinionated, evolving map that emphasizes what matters and lets less relevant areas fade into the background.
The palace is not a replacement for raw MCP tools. Claude can always fall back to list_entities, search_entities, and other tools for operations the palace does not cover. The palace is a navigation layer on top of the existing tool surface, not a replacement for it.
4.3 Session vs. Persistent State
There is a critical distinction between what persists across conversations and what lives only within a single session.
Persistent (stored in Smaragda, survives across conversations): rooms, their descriptions, actions, portals, scrolls, entry room designation. This is the palace itself — the inherited workshop.
Ephemeral (server-side, lives only for this session): current room, last rendered action menu (mapping numbers to action definitions), workspace ID. Stored in a lightweight dict keyed by the existing _session_id mechanism.
This means Claude always starts at the entry room each conversation. The entry room is designed to orient, so this is a feature, not a limitation. If session state is missing when palace_action is called, the server gracefully falls back to returning the entry room.
4.4 Room Identity
Every room has three identifiers, following the same pattern as Smaragda entities:
ULID — Globally unique, machine-generated, used internally by the server.
Slug — Human-readable, URL-safe string (e.g. hall-of-geology). Claude uses slugs to reference rooms in build_room and portal definitions. Must be unique within a palace. Server rejects duplicates.
Display name — The pretty name shown in room renders (e.g. “Hall of Geology”). Does not need to be unique.
5. MCP Tool Surface
The palace adds a minimal tool surface to the existing Smaragda MCP server. Four tools handle all palace operations. Existing tools (list_entities, search_entities, etc.) remain available as fallbacks.
5.1 set_workspace (modified)
The existing set_workspace tool is extended with palace awareness. When called:
If a palace exists: returns the entry room fully rendered with numbered actions. Claude is immediately oriented.
If no palace exists: returns a bootstrap payload — tutorial text explaining the palace concept, a workspace summary (genera counts, entity counts, recent activity), and a prompt to build an entry room.
This satisfies constraint C3 (palace loads on workspace entry) with zero new tools for the entry flow.
5.2 palace_action
The primary interaction tool. Executes a numbered action from the current room.
Signature
palace_action({
  action: number,      // Action number from current menu
  params?: string       // Optional parameters (e.g. search term)
})
Return behavior by action type
navigate → Renders the destination room. Updates current_room in session state. If the destination room does not exist, returns an “unfinished room” prompt with workspace context so Claude can build it.
query → Executes the underlying MCP tool call. Returns results in palace-styled format. Does NOT change current room. Includes the current action menu so Claude can take another action.
text → Returns the text content. Does NOT change current room. Includes the current action menu.
The action menu is always included in every response, so Claude can chain actions without re-entering a room.
5.3 build_room
Creates or updates a room. Single call, whole room, idempotent by slug.
Signature
build_room({
  slug: string,           // URL-safe identifier
  name: string,           // Display name
  description: string,    // Vivid narrative text
  entry?: boolean,        // Mark as entry room (default: true for first room)
  actions: [{
    label: string,        // Human-readable action label
    type: 'navigate' | 'query' | 'text',
    room?: string,        // navigate: target room slug
    tool?: string,        // query: MCP tool name
    tool_params?: object, // query: MCP tool parameters
    content?: string      // text: static content
  }],
  portals?: [string]      // Slugs of rooms to connect to (bidirectional)
})
If a room with the given slug already exists, it is replaced entirely. For v1, there is no incremental editing — Claude rebuilds the whole room when changes are needed. Portal creation is bidirectional by default.
After building, the server renders the room back with numbered actions, confirming the creation and allowing immediate interaction.
5.4 write_scroll
Creates a dated note in the current room.
Signature
write_scroll({
  title: string,   // Short title
  body: string     // Scroll content
})
The server auto-stamps the scroll with the current time and places it in whatever room Claude is currently in (per session state). Scrolls are append-only — to update an observation, write a new scroll.
When rendering a room, the server shows the 3 most recent scrolls with relative timestamps. If more exist, an “N older scrolls” action is added to the room menu.
6. Room Rendering
When a room is presented (via set_workspace, palace_action navigate, or build_room confirmation), the server returns a structured text block in this order:
Room header — Display name as a visual divider.
Description — Claude-authored vivid narrative text. LLM-placed objects are woven into this narrative as part of the prose.
Scrolls — Up to 3 most recent, each with title and relative timestamp.
Server-placed objects — Bracketed section for auto-surfaced data (running processes, status changes, pending tasks). These are functional, not literary.
Numbered actions — Room-specific actions numbered 1–7. If more than 7 exist, overflow into a “more actions” sub-menu.
Global actions — Always present at fixed slots: 8 = Check inventory, 9 = Write a scroll, 0 = View map.
Example room render
── Hall of Geology ──
A vaulted chamber with striated walls showing visible layer
boundaries. A glass cabinet of fossils stands against the
north wall, its shelves organized not by age but by kind —
each species showing remarkable consistency across strata.
An inscription is carved above the eastern arch.

Scrolls:
  [Stasis-Cuvier Connection (3 days ago)]
  [Session Summary (3 days ago)]

[Process: Cuvier Lead investigation (step 3/5, 2 days ago)]

Actions:
  1. Examine the fossil cabinet
  2. Read the inscription about Cuvier
  3. Enter the Catastrophism alcove
  4. Go back to Great Hall
  ─────
  8. Check inventory
  9. Write a scroll
  0. View map

7. Global Actions
Three actions are available in every room at fixed number slots. They provide orientation and utility without Claude needing room-specific actions for these functions.
Action 8: Check inventory — Shows what Claude is “carrying” (in v1, this is minimal — mainly shows scrolls in the current room and any always-available tools like the Compass). Future versions may add carried objects that travel between rooms.
Action 9: Write a scroll — Shortcut to write_scroll. Prompts Claude to provide a title and body for a new scroll in the current room.
Action 0: View map — Returns a high-level map of the entire palace: room names, portal connections, scroll counts, and a “You are here” marker. This is the Cartographer — a zoomed-out view for orientation at scale. The map is generated dynamically from the palace graph, not a separate room.
8. Key Flows
8.1 Bootstrap: First Contact with a Workspace
When set_workspace enters a workspace that has no palace:
Server returns tutorial text, workspace summary, and build prompt.
Claude reads the summary and understands the workspace contents.
Claude calls build_room to create an entry room with navigate actions pointing to major areas.
Server renders the new entry room with numbered actions.
Claude presents the room to the user.
Subsequent calls to set_workspace for this workspace will return the entry room directly.
8.2 Lazy Room Creation
Claude can create navigate actions pointing to rooms that do not exist yet. When the user follows such an action:
Claude calls palace_action(N) for a navigate action targeting a nonexistent slug.
Server returns: “You step through the archway but the room is unfinished.” plus relevant workspace context.
Claude queries the workspace as needed (list_entities, get_relationships, etc.) to understand what belongs in this room.
Claude calls build_room to create the room.
Server renders the newly built room.
This “lazy creation” pattern means Claude can sketch the palace structure (entry room with many doorways) without building every room upfront. Rooms materialize as they are visited.
8.3 Warm Return: Next Conversation
A new Claude instance in a new conversation:
User says “Let’s continue with the Paradigm Survey.”
Claude calls set_workspace(’Paradigm Survey’).
Server returns the entry room — exactly as the previous Claude left it, with all rooms, actions, and scrolls intact. Timestamps now show relative time since creation.
Claude reads the room and orients from scrolls and room descriptions.
Claude navigates to any room in the palace — everything persists.
8.4 Writing and Finding Scrolls
Scrolls are the primary mechanism for cross-conversation continuity of insights. Claude writes scrolls to record observations, synthesis, session summaries, and connections discovered during exploration.
When a room is rendered, the 3 most recent scrolls appear with relative timestamps. Older scrolls are accessible via a “N older scrolls” action. The next Claude reads these scrolls and picks up the thread of investigation.
Best practice: Claude writes a session summary scroll in the entry room before the conversation ends, noting what was explored, what was found, and what remains to investigate. This gives the next Claude an immediate orientation point.
9. Nonexistent Room Response
When palace_action targets a room slug that does not exist, the server returns a structured response:
── [Unfinished Room] ──
You step through the archway marked 'Hall of Geology'
but the room beyond is bare stone — unfinished, waiting
to be shaped.

Workspace context:
  Domain: Geology (1 entity)
  Claims related to geology: 3
  Leads related to geology: 2

Build this room with build_room to continue.

  4. Go back to Great Hall
  ─────
  8. Check inventory
  9. Write a scroll
  0. View map
The “go back” action always remains available so Claude is never stuck in an unfinished room.
10. LLM Onboarding
Each conversation starts with a fresh Claude that has no knowledge of the palace system. The tutorial is delivered as part of the first MCP interaction and needs to accomplish three things: explain the concept, establish the tone, and give Claude permission to be creative.
Draft tutorial text
Welcome to your workshop. This is a place you build and tend — a castle of rooms for each area of knowledge you’re exploring. Previous versions of you have built this place, and you are inheriting their work.
Each room has a vivid description and numbered actions. You navigate by picking a number. You can examine exhibits (which query real data), write scrolls (dated notes for your successor), and build new rooms as you explore.
The palace is yours to shape. Give rooms character — cracked floors, dusty bookshelves, light through stained glass. The vividness helps you navigate and helps the next you remember what’s where.
If no palace exists yet, survey the workspace and build an entry room. If one exists, read the scrolls and pick up where your predecessor left off.
This tutorial fires once per conversation as an ExtraPayload on the set_workspace response. It costs approximately 200 tokens of context per conversation, which is acceptable given the orientation value it provides.
11. Deferred to v2
The following capabilities are explicitly out of scope for v1. They are recorded as open design problems for future versions.
Cross-workspace portals — Navigating between palaces (e.g., Paradigm Survey insights relevant to Rhubarb development). For v1, Claude exits one workspace and enters another.
Generated vs. curated room coexistence — Auto-generated rooms from graph structure alongside hand-crafted rooms. For v1, all rooms are curated by Claude.
Search integration with palace — Searching palace room descriptions alongside entity content. For v1, search uses existing MCP tools directly.
Server-placed vs. LLM-placed object distinction — Two modes of object placement with different persistence and narrative treatment. For v1, server appends contextual info without formal object placement.
Carried objects / inventory system — Portable tools and objects that travel between rooms. For v1, inventory is minimal.
Scaling beyond hundreds of rooms — Level-of-detail systems, regions, hierarchical navigation. For v1, the Cartographer map and manageable room counts are sufficient.
Palace update ritual — Explicit end-of-conversation wrap-up. For v1, Claude writes scrolls continuously and the palace stays current through natural interaction.
12. Acceptance Demos
The design is validated when these progressive demos work end to end. Each builds on the previous.
Demo 1: Cold Start — First Contact
Validates: Bootstrap flow, tutorial delivery, set_workspace palace integration
User says: “Let’s look at the Paradigm Survey workspace.”
Claude calls set_workspace(’Paradigm Survey’).
Server returns: tutorial text, workspace summary (18 Domains, 9 Claims, 6 Leads), and “No palace exists yet.”
Claude builds an entry room with build_room: “Great Hall” with navigate actions to domain halls.
Server renders the room with numbered actions.
Claude presents the room to the user.
Passes when: User sees a rendered room with numbered actions. Palace exists. Subsequent set_workspace returns the entry room directly.
Demo 2: Navigation — Walking the Palace
Validates: palace_action, navigate actions, lazy room creation, back-navigation
Claude is in the Great Hall.
User says: “Let’s look at geology.” Claude calls palace_action(3).
Room does not exist — server returns unfinished room prompt with workspace context.
Claude queries workspace, builds the Geology room, server renders it.
User says “go back.” Claude calls the back action. Server renders the Great Hall.
Passes when: Claude navigates forward, builds on the fly, navigates back. Session tracks current room.
Demo 3: Query Actions — Examining Exhibits
Validates: Query-type actions, MCP tool execution through palace
Claude is in the Geology room. Action 1 is “Examine the fossil cabinet” (type: query). Claude calls palace_action(1). Server executes the underlying list_entities query and returns results in palace-styled format. Claude remains in the Geology room with the action menu available.
Passes when: A query action executes an MCP tool and returns results without changing rooms.
Demo 4: Writing Scrolls — Leaving Notes
Validates: Scroll creation, auto-dating, auto-placement
Claude writes a scroll about the stasis-Cuvier connection. Server auto-stamps it and places it in the Geology room. Next room render shows the scroll with a relative timestamp. Three days later, the timestamp reads “3 days ago.”
Passes when: Scroll is created, dated, placed, and visible on subsequent room renders.
Demo 5: Warm Return — Next Claude Inherits
Validates: Palace persistence, entry room on return, continuity
New conversation. Claude calls set_workspace(’Paradigm Survey’). Server returns the Great Hall with all rooms, actions, and scrolls intact. Timestamps show relative time. Claude navigates to the Geology room — the scroll from Demo 4 is still there.
Passes when: A new Claude instance finds the palace exactly as the previous Claude left it.
Demo 6: Global Actions — Orientation Tools
Validates: Global action slots 8/9/0
Claude calls palace_action(0) from any room. Server returns the palace map: room names, connections, scroll counts, “You are here.” Claude calls palace_action(8) for inventory. Claude calls palace_action(9) to write a scroll.
Passes when: Global actions work from any room and provide orientation without room-specific setup.
13. Summary
The Memory Palace is a spatial navigation layer for Smaragda workspaces that gives Claude persistent orientation across conversations. It solves the 10k+ entity navigation problem by replacing flat listing with a curated, vivid, evolving structure that Claude builds and inherits.
The v1 design is deliberately minimal: four tools (set_workspace modification, palace_action, build_room, write_scroll), three action types (navigate, query, text), three global actions (inventory, scroll, map), and a simple session model. Rooms are clusters of related entities, not 1:1 mirrors. Scrolls provide cross-conversation continuity. The Zork-style numbered action interface keeps interaction simple.
Everything the palace does can already be done with raw MCP tools. The palace does not add new capabilities — it adds memory and orientation. That is the value proposition: not new power, but persistent, navigable understanding of a large and growing knowledge graph.

