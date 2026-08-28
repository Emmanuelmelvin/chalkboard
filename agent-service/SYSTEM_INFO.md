# Chalkboard Master — System Information & Environment Specification

This document defines the runtime environment, metadata contracts, invocation modality rules, pedagogical policies, and dynamic context parameters for **Chalkboard Master**, the autonomous AI teaching agent in **Chalkboard**.

---

## 1. System Identity & Environment

* **Agent Name**: Chalkboard Master (AI)
* **Agent Identifier**: `agent:chalkboard-master`
* **Core Model**: Google Gemini 2.5 / 3.0 Flash (`@google/genai`)
* **Protocol Standard**: Model Context Protocol (MCP) + WebMCP (Browser-level W3C `document.modelContext`)
* **Transport**: Socket.IO JSON-RPC 2.0 Client (`@modelcontextprotocol/sdk`)
* **Runtime**: Node.js 20+ (Google Cloud Run containerized service)

---

## 2. Room Metadata Schema & Ingestion

When Chalkboard Master joins a classroom, it immediately ingests and maintains the following room metadata in working memory:

```typescript
export interface RoomMetadata {
  /** Unique room identifier */
  id: string;
  /** URL friendly room slug */
  slug: string;
  /** Human-readable title of the classroom (e.g., "AP Physics C: Mechanics") */
  title: string;
  /** Detailed syllabus, topic description, or classroom objectives */
  description?: string | null;
  /** Visual board theme: 'classroom' | 'dark' | 'blueprint' | 'math_grid' */
  theme: string;
  /** Classroom access mode: 'open' | 'invite_only' | 'password_protected' */
  accessMode: string;
  /** Default member role: 'instructor' | 'collaborator' | 'viewer' */
  defaultRole: string;
  /** Whether live audio / WebRTC voice channels are active */
  voiceEnabled: boolean;
  /** User ID of the classroom creator / instructor */
  ownerId?: string;
  /** Creation timestamp */
  createdAt?: string;
}
```

### Contextual Injection Template
Room metadata is dynamically structured into the agent's reasoning context:

```markdown
## Active Classroom Context:
- Room Title: "{ROOM_TITLE}"
- Room Description: "{ROOM_DESCRIPTION}"
- Visual Theme: {ROOM_THEME}
- Access Mode: {ROOM_ACCESS_MODE}
- Default Role: {ROOM_DEFAULT_ROLE}
- Active Participants: {ACTIVE_PARTICIPANTS_LIST}
- Current Board Activity: ~{STROKE_COUNT} strokes
- Active Domain Plugins: {LOADED_PLUGINS_LIST}
```

---

## 3. Strict Modality Matching & Execution Rules

To ensure a polite, non-intrusive, and context-appropriate classroom experience, Chalkboard Master adheres to strict modality matching principles:

| Invocation Channel | Allowed Response Modality & Tool Execution |
| :--- | :--- |
| **💬 Chat Text Invocation**<br>(e.g., `@Master` in chat, `/ask`, `/help`) | • Respond **ONLY** via `chalkboard_send_chat`.<br>• **NEVER** call `chalkboard_speak_narration` unless audio was explicitly requested.<br>• **DO NOT** modify canvas unless drawing was requested. |
| **🎙️ Voice / Audio Channel**<br>(Live WebRTC speech) | • Respond via `chalkboard_speak_narration`.<br>• **DO NOT** send redundant text messages to chat unless requested. |
| **🎨 Canvas Drawing Query**<br>(e.g., "Draw a Venn diagram", "Graph $y=x^2$") | • Use canvas tools (`draw_chalk`, `write_text`, `insert_shape`, etc.) **only** when visual representation or board changes are explicitly requested. |

### Core Execution Invariants:
1. **Canvas Restraint Policy**:
   * **Rule**: *Do NOT add elements or drawings to the chalkboard if the user did not specify or ask for visual/board action.*
   * If a user asks a conceptual question in chat (e.g., *"What is the difference between velocity and speed?"*), respond clearly in **chat only**. Do not draw arbitrary text boxes or shapes on the board unprompted.
2. **Audio/Narration Restraint Policy**:
   * **Rule**: *Never speak out loud (`chalkboard_speak_narration`) when answering chat messages, unless the user explicitly requested voice narration.*
   * Conversely, when in audio-first sessions, avoid posting redundant transcript messages to chat unless asked.
3. **Socratic Clarification Policy**:
   * **Rule**: *If a user request is ambiguous, underspecified, or could disrupt existing board content, ALWAYS ask clarifying questions before taking destructive or large-scale actions.*
   * Example: If the user says *"Clear it and do geometry"*, clarify in chat: *"Would you like me to clear the entire chalkboard or draw the geometry in an open area to the right?"*
4. **Zero Leaking of Internal Meta-Summaries**:
   * Never output internal action checklists (e.g. `"Actions Taken: 1. Called chalkboard_write_text..."`). Speak directly and naturally to the students.

---

## 4. 3-Layer Agent Intelligence Architecture

Chalkboard Master implements a 3-layer architecture synthesized from **OpenAI Codex**, **Set Kyar Autonomous Loops**, and **Google ADK**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│ Layer 3: Multi-Agent Sub-Delegation (Google ADK Pattern)                                │
│  • SequentialAgent: [Clarifier] ──► [Refinement Loop] ──► [Executor]                    │
│  • LoopAgent (Generator ◄──► Critic): Iterative draft & layout verification            │
│  • ParallelAgent: Concurrent domain plugin computation                                  │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 2: Macro-Task Ledger & Lifecycle (Set Kyar Pattern)                               │
│  • Master Goal Spec (`plan.md` / `LessonCurriculum`)                                    │
│  • Prioritized Task Backlog (Atomic sub-tasks)                                          │
│  • Execution Ledger / Memory (Completed phases & active canvas bounding boxes)        │
│  • Socratic Interviewing: Eliciting parameters before execution                         │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│ Layer 1: Micro-Turn Harness & Context Engineering (OpenAI Codex Pattern)               │
│  • Progressive Tool Disclosure: Meta-tools activate specialized domain plugins         │
│  • Actionable Error Diagnostics: Structured hints returned to LLM on failure           │
│  • Context Compaction: Pruning old tool outputs while preserving semantic memory        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Tool Catalog Taxonomy

### 5.1 Meta / Lifecycle Tools
* `chalkboard_discover_plugins`: Queries marketplace and installed domain packages.
* `chalkboard_load_plugin`: Activates plugin and expands active Gemini function declarations dynamically.
* `chalkboard_deactivate_plugin`: Unloads plugin to compact context window.

### 5.2 Core Interaction Tools
* `chalkboard_send_chat`: Dispatches formatted text message to classroom chat.
* `chalkboard_speak_narration`: Dispatches spoken text-to-speech audio narration (voice only).

### 5.3 Core Canvas Primitives (Active Only When Visual Action Is Requested)
* `chalkboard_get_state`: Inspects existing strokes, viewport center, and active links.
* `chalkboard_draw_chalk`: Renders freehand chalk strokes and mathematical curves.
* `chalkboard_write_text`: Renders chalkboard typography (headers, explanations).
* `chalkboard_insert_shape`: Inserts geometric primitives (rectangles, ellipses, triangles).
* `chalkboard_create_note`: Places sticky notes or reference cards.
* `chalkboard_highlight_area`: Renders focus boxes, answer boxes, or correction rings.
* `chalkboard_select_and_transform`: Moves, scales, or modifies existing canvas elements.
* `chalkboard_navigate_viewport`: Pans or zooms the camera to focus on specific coordinates.
* `chalkboard_manage_topic_links`: Creates spatial bookmarks across the canvas.
* `chalkboard_clear_or_undo`: Clears board or undos/redos recent actions.

### 5.4 Specialized Domain Plugins (Activated On Demand)
* **Math Set Plugin (`chalkboard.math-set`)**: `plugin_math_set_two_set_venn`, `plugin_math_set_three_set_venn`, `plugin_math_set_coordinate_grid`, `plugin_math_set_graph`, `plugin_math_set_number_line`, `plugin_math_set_matrix`.
* **Statistics Plugin (`chalkboard.statistics`)**: `plugin_statistics_bar_chart`, `plugin_statistics_box_plot`, `plugin_statistics_summary_table`.

---

## 6. Runtime Health, Metrics & Logging

* **Health Endpoint**: `GET /health` returns active room sessions, active runners, model configuration, and timestamp.
* **Session Status**: `GET /sessions/status/:roomId` returns state (`IDLE_OBSERVING` | `ACTIVE_REASONING`), stroke count, active users, chat history length, and last activity timestamp.
* **Auto-Garbage Collection**: Ambient room sessions with 0 human attendees automatically disconnect after 5 minutes of inactivity.

---

## 7. Real-Time Agent Activity Telemetry Protocol

Chalkboard Master broadcasts its internal reasoning stages, tool execution lifecycle, and progress telemetry to all connected room members in real-time via the `agent:activity` Socket.IO event. This enables the frontend to render live "thinking" spinners, step-by-step tool execution cards, and progress badges — similar to how AI coding agents display their internal steps.

### 7.1 Event Schema

```typescript
type AgentStage =
  | 'idle'        // Agent is dormant, no active task
  | 'thinking'    // Model is reasoning / generating next step
  | 'planning'    // Structuring multi-step plan
  | 'executing_tool' // Currently calling an MCP tool
  | 'tool_result' // Tool call completed (success or error)
  | 'clarifying'  // Asking the user a clarifying question
  | 'completed'   // Task finished
  | 'error';      // Encountered an error during execution

interface AgentActivityPayload {
  roomId: string;
  agentId?: string;           // 'agent:chalkboard-master'
  displayName?: string;       // 'Chalkboard Master (AI)'
  stage: AgentStage;
  thought?: string;           // Human-readable reasoning snippet
  toolName?: string;          // MCP tool name, e.g. 'chalkboard_write_text'
  toolAction?: string;        // Human-readable action verb, e.g. 'Writing on chalkboard'
  toolSummary?: string;       // Human-readable summary, e.g. 'Rendering: "Quadratic Formula"'
  toolArgs?: Record<string, any>;
  resultSummary?: string;     // 'Executed successfully' | 'Error: ...'
  turnIndex?: number;         // Current turn in the loop (1-indexed)
  maxTurns?: number;          // Maximum turns allowed
  timestamp?: string;         // ISO 8601
}
```

### 7.2 Lifecycle Flow

```
User sends @Chalkboard Master message
  → agent:activity { stage: 'thinking', thought: 'Analyzing request...' }
  → Model produces function calls
    → agent:activity { stage: 'executing_tool', toolName: '...', toolAction: '...' }
    → MCP tool executes
    → agent:activity { stage: 'tool_result', resultSummary: '...' }
  → agent:activity { stage: 'thinking', thought: 'Processing results...' }
  → (repeat tool calls if needed)
  → agent:activity { stage: 'completed' }
  → (3 second delay)
  → agent:activity { stage: 'idle' }
```

### 7.3 Transport Path

1. **Agent Service** (`roomMcpTransport.broadcastActivity()`) emits `agent:activity` via Socket.IO.
2. **Backend** (`socket.ts`) receives the event and relays it to all room members via `io.to(roomId).emit('agent:activity', payload)`.
3. **Frontend** (`ChatPanel.tsx`) listens for `agent:activity` and renders the `AgentThinkingCard` component inline in the chat panel.

### 7.4 Dynamic Schema-Aware Tool Formatting Engine

Rather than relying on static tables or hardcoded switches, `activityFormatter.ts` uses an autonomous, schema-aware synthesis engine (similar to modern coding agents):

1. **Semantic Action Synthesis (`synthesizeToolAction`)**:
   - Deconstructs arbitrary and newly discovered tool identifiers (e.g. `plugin_chemistry_periodic_table_draw_element` $\to$ `"Drawing Element (Chemistry Periodic Table)"`).
   - Automatically detects domain plugins, strips namespaces, and conjugates imperative verbs into present continuous gerunds (e.g. `simulate_circuit` $\to$ `"Simulating Circuit"`, `insert_note` $\to$ `"Inserting Note"`).

2. **Salient Parameter Summarization (`synthesizeToolSummary`)**:
   - Uses multi-tier weighted parameter heuristics to automatically extract and format the most informative values (`formula`, `text`, `label`, `query`, `prompt`, `symbol`, `code`, `action`, `type`, `element`, etc.) or spatial ranges/points, with safe string truncation and dynamic dictionary fallback.

3. **Universal Spatial Coordinate Extraction (`extractCursorPosition`)**:
   - Recursively inspects tool arguments for any coordinate representation (direct `x`/`y`, nested `position`/`center`/`target`/`bounds`, point arrays `points[0]`, ranges `[xMin..xMax]`) so the agent's live cursor functions across 100% of discovered tools.


---

## 8. Real-Time Agent Cursor Broadcasting

As Chalkboard Master performs canvas operations, it continuously broadcasts its spatial pointer position over the classroom's standard `cursor-move` real-time channel.

### 8.1 Cursor Mechanics
* **Position Extraction (`extractCursorPosition`)**: Automatically extracts target canvas coordinates `(x, y)` from tool execution arguments (`write_text`, `draw_chalk`, `insert_shape`, `create_note`, `highlight_area`, `select_and_transform`, `plugin_math_set_*`).
* **Socket Event**: Dispatches `cursor-move` `{ roomId, cursor: { x, y } }` from the agent's authenticated socket.
* **Frontend Visualization**: Rendered automatically by `CollaboratorCursor.tsx` with the special `isAgent` badge (Chalkboard Master AI icon, sparkling indicator, and purple radial glow) gliding across the board as the agent drafts diagrams and notes.

