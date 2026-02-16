Memory Palace v2
Design Document
February 2026
Builds on v1 field testing with 8-room Paradigm Survey palace
1. What v1 Got Right
The core architecture proved sound during field testing. Eight rooms were built across two investigation clusters (geological and dispersal), with real entity queries, cross-domain portals, text exhibits, and persistent scrolls all working as designed.
Validated Design Decisions
Room descriptions as mnemonic anchors (empty display cases, converging threads, banned plaques) genuinely aid navigation
Three action types (navigate, query, text) cover real usage patterns without gaps
Numbered action interface (1–7 room-specific, 8/9/0 global) is simple and unambiguous
Lazy room creation via navigate-to-nonexistent produces natural build-as-you-explore flow
Scrolls with relative timestamps work as inter-session breadcrumbs
Palace map (action 0) gives instant topological orientation
Session state tracking current room and resolving action numbers works reliably
Cross-domain portals (Cuvier’s Study bridging Geology, Biology, and Observatory of Science) create exactly the synthesis connections the system exists to enable
The 4-Tool Surface Was Right
set_workspace, palace_action, build_room, and write_scroll proved sufficient for all v1 operations. No missing tool was identified during testing. The question for v2 is not more tools but richer behavior within these four.
2. Bugs and Pain Points from Field Testing
2.1 Fixed: Query Actions Returned Unscoped Results
tool_params were not passed through to the underlying MCP call, causing query actions to return all entities system-wide instead of filtered by genus. Fixed in the second deployment. Verified working with genus-filtered Claim queries.
2.2 Open: Bootstrap and Unfinished Room Context Shows Global Genera
When set_workspace triggers a bootstrap (no palace exists) or when navigating to a nonexistent room, the workspace_summary.genera list shows every genus in the system with counts, including genera from completely different workspaces (Fil-C components, demo bookshop entities, etc.). Should only show genera that have entities in this workspace.
Impact: Claude sees irrelevant genera and makes confused room-building decisions. The Paradigm Survey bootstrap showed Server, Issue, Person, Device, Product, Book, and 20+ other unrelated genera alongside the actual Domain, Claim, and Lead genera.
Fix: Filter workspace_summary.genera to only include genera with entity_count > 0 within the current workspace.
2.3 Open: Query Results Are Raw JSON
When a query action executes, results come back as raw entity JSON. The action label (e.g., “Examine the fossil cabinet”) is not used to frame the results. A simple prepend of the action label as narrative intro would improve immersion.
Fix: Prepend action label to query results: “You open the fossil cabinet and find:” before the entity list. The label text is already in the action definition.
2.4 Open: Persistent Pending Tasks in Room Renders
Every room render shows “[3 pending tasks]” regardless of relevance. These appear to be stale tasks from earlier process testing, not related to the palace or current workspace. Room renders should either suppress task counts or filter to workspace-relevant tasks only.
2.5 Observation: Great Hall Action Slot Limit
The Great Hall points to 18 domain doorways but only has 7 room-specific action slots (1–7). Currently 5 navigate actions are defined, with 2 query actions. The remaining 13 domains route through unfinished rooms when their doorways are eventually built, but there’s no way to expose all 18 as first-class navigation options from one room.
This is by design, not a bug. The constraint forces hierarchical organization. But v2 should consider whether the 7-slot limit is the right number.
3. v2 Proposals
3.1 Room Editing (Non-Destructive Updates)
v1’s build_room is create-or-replace. To add a new action to an existing room, you must rebuild the entire room with all existing actions plus the new one. This is high-friction and error-prone, especially for rooms with many actions and a long description.
Proposal: edit_room Tool
A new tool or extension to build_room that allows incremental changes:
add_action: Append an action to the room’s action list
remove_action: Remove an action by label or index
replace_action: Replace an action by label or index
update_description: Replace or append to the room description
update_portals: Add or remove portal connections

Alternative: Keep build_room as the only mutation tool but make it smarter — if a room with the given slug already exists, merge the new definition with the existing one rather than replacing. Actions with matching labels are updated; new labels are appended; description is replaced only if provided.
Recommendation: The merge-on-rebuild approach is simpler and preserves the 4-tool surface. Add an optional “merge: true” parameter to build_room.
3.2 Workspace-Scoped Context
The bootstrap and unfinished-room contexts should only show genera and entity counts relevant to the current workspace. This requires the server to filter the genera list by workspace membership.
Specification
set_workspace bootstrap: workspace_summary.genera shows only genera with at least 1 entity in this workspace
Unfinished room context: same filtering
If a workspace has 0 entities, show an empty genera list with a note: “This workspace is empty. Create entities to begin.”
3.3 Query Result Wrapping
Query action results should be wrapped with the action’s label as a narrative prefix. This is cosmetic but meaningful — it maintains the palace atmosphere during data retrieval.
Specification
When palace_action executes a query action:
Execute the underlying MCP tool call with the action’s tool_params
Prepend the action label as a narrative line: “{label}:”
Return the combined result

Example: Action label “Examine the fossil cabinet” with tool list_entities genus=Claim returns: “You examine the fossil cabinet:” followed by the 9 Claim entities.
3.4 Action Slot Expansion
The current 7 room-specific + 3 global action layout works well for focused rooms but constrains hub rooms like the Great Hall. Two options:
Option A: Raise the limit to 12
Simple change. Room-specific actions 1–12, global actions on higher numbers (18/19/20 or similar). Risk: longer menus reduce clarity.
Option B: Sub-menus via text actions
Keep the 7-slot limit but allow text actions that list further options. A “More doorways” action could display the remaining domain doorways as a text list, with room slugs that Claude can then navigate to via a follow-up palace_action.
Recommendation: Option A (raise to 12) for v2. Revisit if 12 proves insufficient. The Paradigm Survey Great Hall has 18 domains but only 4–5 are built-out enough to warrant direct links; the rest can wait.
3.5 Stale Task Suppression
Room renders should not show task counts unless the tasks are relevant to the current workspace and palace. Options:
Suppress task counts entirely from room renders
Filter to tasks associated with entities in the current workspace
Only show tasks created by or for the palace system

Recommendation: Filter to workspace-scoped tasks. Tasks from other workspaces or process tests should not appear.
3.6 Cross-Workspace Portals
v1 palaces are strictly workspace-scoped. This means the Paradigm Survey palace cannot link to a future rhubarb development palace, even though the intellectual connections exist (e.g., the process-as-tensor model relates to both).
Proposal: Cross-Workspace Navigate Actions
Allow navigate actions to specify a target workspace alongside a target room slug. When executed, the server switches the active workspace and navigates to the target room in the new palace.
Schema: { type: "navigate", room: "computation-hall", workspace: "rhubarb" }

This preserves workspace scoping for entity queries while enabling synthesis navigation across knowledge domains.
Deferred question: Should cross-workspace navigation be reversible? i.e., should there be a “return to previous workspace” global action? Probably yes.
3.7 Server-Placed Objects
v1 only has LLM-placed content (actions, descriptions, scrolls). v2 should add server-placed objects — items the system appends to a room render without modifying the room definition.
Use Cases
Recent changes: “Since your last visit, 3 new Claims were added to this workspace”
Process notifications: “A Domain Deep Dive process is running on Geology”
Entity health alerts: “2 entities in this room have unacknowledged errors”
Fresh scrolls from another session that haven’t been read yet

Specification
Server-placed objects appear after the room description and LLM-placed actions, separated by a visual divider. They do not persist — they’re computed fresh on each room render based on current system state.
Format: A “Notices” section appended to the room render, after the action menu. Contains only informational items, not actions.
3.8 Palace Search
v1 has no search. Claude must navigate room-by-room or use raw MCP tools (search_entities) to find things. v2 should add palace-level search.
Proposal: search_palace as a Global Action
Add a new global action (e.g., action 7 or a new high number) that searches across room names, descriptions, action labels, and scroll titles/bodies. Returns matching rooms and scrolls with their locations.
This complements, not replaces, the entity-level search_entities tool. Palace search finds rooms and scrolls; entity search finds entities. Both are useful.
3.9 Room Versioning and Diff
When a palace is rebuilt or rooms are edited over multiple sessions, there’s no way to see what changed. Adding a simple version counter and “last modified” timestamp to rooms would let Claude (and the map) show which rooms were recently updated.
Specification
Each build_room call increments the room’s version counter
Room metadata includes created_at and updated_at timestamps
Palace map optionally shows last-modified indicators: “Hall of Geology [1 scroll, updated 2h ago]”
4. Deferred to v3 or Later
4.1 Generated vs Curated Rooms
v1 rooms are fully curated — Claude writes every description and action. At scale (hundreds of genera, thousands of entities), some rooms should be auto-generated from the entity graph. For example: one room per genus with auto-populated query actions for each status. v3 should explore hybrid rooms that have both generated and curated elements.
4.2 Level-of-Detail and Palace Scaling
The v1 Paradigm Survey has 33 entities across 8 rooms. What happens at 10,000 entities? Rooms need level-of-detail: hub rooms show summaries, deeper rooms show specifics. This might require dynamic room content that changes based on entity counts and query complexity. Needs real-world stress testing before designing.
4.3 Continuous Palace Maintenance
Claude doesn’t know when a conversation will end. Currently, scrolls serve as the continuity mechanism, but room updates require deliberate build_room calls. A future version might auto-prompt Claude to update rooms when significant entity changes occur within a session.
4.4 Palace Templates
When creating a new workspace, offer pre-built palace skeletons that match common taxonomy patterns. A “research project” template might include a Great Hall, a Literature Review wing, a Methods room, and a Findings gallery. Templates accelerate the cold-start case.
4.5 Inventory System
v1 defined global action 8 as “check inventory” but carrying objects between rooms was deferred. v2 maintains this deferral. The scroll system covers the primary use case (leaving notes). Carriable objects would add complexity without clear benefit yet.
5. Implementation Priority
Ordered by impact and effort:



Items 1–3 are bug fixes that should ship immediately. Items 4–5 are the core v2 features. Items 6–9 can be added incrementally based on usage patterns.
6. Open Problems: Status Update
The v1 design session generated 25 open Problem entities. Most were solved by the v1 implementation. Here is the disposition:



Summary: 19 of 25 problems solved. 3 partially addressed with v2 proposals. 3 deferred to v3.
7. Current Palace State (Reference)
The Paradigm Survey workspace has an 8-room palace built during v1 testing:

Geological Cluster
The Great Hall (entry) → Hall of Geology ↔ Hall of Biology ↔ Cuvier’s Study ↔ Observatory of Science
Dispersal Cluster
The Great Hall (entry) → Hall of Linguistics ↔ Maritime Archives ↔ Genetics Alcove

3 scrolls placed across 3 rooms. 33 entities accessible via palace queries (18 Domains, 9 Claims, 6 Leads). 12 domain doorways still lead to unfinished rooms.

This palace serves as the primary test bed for v2 features. It is small enough to be comprehensible but structured enough to exercise all v2 proposals.
