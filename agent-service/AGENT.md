# Chalkboard Master — Autonomous Agent & WebMCP Architecture Specification

This document provides the definitive, production-grade architectural specification for **Chalkboard Master**, the autonomous AI teaching agent powering collaborative classrooms in **Chalkboard**.

---

## 1. Executive Summary & Core Philosophy

Chalkboard Master is an autonomous AI instructor powered by Google Gemini and Google GenAI SDK, integrated into a collaborative canvas environment using the **Model Context Protocol (MCP)** and **WebMCP (Browser-level MCP)**.

### Core Architectural Philosophy: The Capability-Less Agent

> **The agent itself is capability-less by default. The environment (the room) owns all capabilities, and the agent discovers and acquires access to them dynamically upon joining.**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           GEMINI REASONING CORE                         │
│                    (Autonomous Teaching Policy Loop)                    │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Dynamic Function Calling
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         CHALKBOARD MASTER AGENT                         │
│                   (@google/genai + @modelcontextprotocol)               │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ Socket.IO MCP Transport (JSON-RPC)
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        BACKEND REALTIME GATEWAY                         │
│                    (Room Presence & Event Relaying)                     │
└────────────────────────────────────┬────────────────────────────────────┘
                                     │ WebSocket RPC
                                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ROOM CAPABILITY LAYER (WEBMCP)                     │
├────────────────────────────────────┬────────────────────────────────────┤
│         CORE CAPABILITIES          │         PLUGIN CAPABILITIES        │
│   (Draw, Text, Shapes, Speech,     │     (Math Set, Statistics, Tags,   │
│       Viewport, Links, Chat)       │    Quizzes, Chemistry, 3D Models)  │
└────────────────────────────────────┴────────────────────────────────────┘
```

#### Why This Philosophy Matters:
1. **Zero Coupling to Domain Tools**: The agent service code does not need to be updated, recompiled, or redeployed when new canvas primitives or domain plugins are added to the classroom.
2. **Heterogeneous Room Environments**: Room A (Algebra) can expose coordinate systems, graphing tools, and matrix solvers; Room B (Organic Chemistry) can expose molecular structures and reaction simulators; Room C (Music) can expose staves and synthesizers. The same agent binary operates seamlessly in all of them.
3. **Progressive Tool Disclosure (Context Window Optimization)**: LLM tool selection degrades when presented with dozens of tools at once. Chalkboard Master boots with only core primitives and discovery tools, activating specialized plugin tools on demand.

---

## 2. End-to-End System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   AGENT SERVICE (Cloud Run)                             │
│                                                                                         │
│   ┌─────────────────────┐       ┌──────────────────────┐      ┌─────────────────────┐   │
│   │ Express HTTP Server │ ───►  │   GeminiMcpRunner    │ ───► │SocketIoMcpTransport │   │
│   │   (POST /instruct)  │       │  (Chat Turn Loop)    │      │  (JSON-RPC Client)  │   │
│   └─────────────────────┘       └──────────┬───────────┘      └──────────┬──────────┘   │
└────────────────────────────────────────────┼─────────────────────────────┼──────────────┘
                                             │ Gemini API                  │ Socket.IO
                                             ▼                             ▼
                                ┌─────────────────────────┐   ┌───────────────────────────┐
                                │ Google Gemini 2.0 / 2.5 │   │  Chalkboard Backend Node  │
                                │   (Function Calling)    │   │  (Socket.IO Realtime Svc) │
                                └─────────────────────────┘   └─────────────┬─────────────┘
                                                                            │ WebSocket
                                                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               CLASSROOM FRONTEND (Browser)                              │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                              WebMcpBridge (Singleton)                           │   │
│   │       • document.modelContext W3C Polyfill   • Registered Tools Catalog         │   │
│   │       • Execution Logger & Telemetry         • Active vs Available Plugins      │   │
│   └────────────────────────┬────────────────────────────────────────┬───────────────┘   │
│                            │                                        │                   │
│                            ▼                                        ▼                   │
│   ┌──────────────────────────────────────────────────┐  ┌───────────────────────────┐   │
│   │                 Core WebMCP Tools                │  │    PluginToolsBridge      │   │
│   │  (chalkboard_draw_chalk, write_text, state...)   │  │ (Transforms Manifests     │   │
│   └────────────────────────┬─────────────────────────┘  │  into WebMCP Tools)       │   │
│                            │                            └─────────────┬─────────────┘   │
│                            ▼                                          ▼                 │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │                          Canvas Command Layer (boardCommands.ts)                │   │
│   │              • React-free Zustand Store Manipulation (boardStore)               │   │
│   │              • Collaborative Stroke Broadcast (Socket.io room)                  │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Component Breakdown

### 3.1 Agent Microservice (`agent-service/`)

The agent microservice is an autonomous Node.js service designed to run on Google Cloud Run or containerized clusters.

* **`src/index.ts`**:
  * Exposes Express REST endpoints (`POST /instruct`, `POST /stop`, `GET /health`).
  * Enforces concurrency safety: one active teaching runner per room session.
  * Launches `GeminiMcpRunner` asynchronously and responds immediately to the HTTP caller with job metadata.
* **`src/agent/geminiMcpRunner.ts`**:
  * Core autonomous teaching orchestrator.
  * Connects to the classroom browser via `SocketIoMcpTransport` and the official `@modelcontextprotocol/sdk`.
  * Dynamically queries `mcpClient.listTools()`, converts MCP JSON Schema definitions into Gemini Function Declarations, and initializes a multi-turn chat session using `@google/genai`.
  * Runs the autonomous pedagogical loop up to `MAX_TURNS_PER_INSTRUCTION` (default: 25 turns).
  * Automatically detects tool catalog expansions (e.g., when `chalkboard_load_plugin` is called), extracts conversation history, and reconstructs the Gemini chat session with the newly registered tools.
  * Includes automated exponential-backoff retry handling for transient Gemini API errors (HTTP 503 / 429).
* **`src/socket/roomMcpTransport.ts`**:
  * Custom implementation of the MCP `Transport` interface over Socket.IO.
  * Authenticates with the backend using `AGENT_SECRET` as a verified classroom agent (`agent:chalkboard-master`).
  * Translates MCP JSON-RPC 2.0 requests (`initialize`, `tools/list`, `tools/call`) into Socket.IO room events (`mcp:list_tools`, `mcp:call_tool`).
* **`src/config.ts` & `src/types/index.ts`**:
  * Environment configuration (`GEMINI_API_KEY`, `GEMINI_MODEL`, `MAIN_BACKEND_SOCKET_URL`, `PORT`, `AGENT_SECRET`).
  * Type contracts for instruction payloads, room parameters, and MCP data envelopes.

---

### 3.2 Backend Realtime Gateway (`backend/`)

* **`src/realtime/socket.ts`**:
  * Manages real-time room presence, collaborative stroke sync (`draw-stroke`, `clear-board`, `chat:send`, `undo-stroke`), and Redis-backed multi-instance clustering.
  * Relays MCP discovery and execution requests between the Agent Service and the active classroom browser:
    * `mcp:list_tools`: Routes to the active classroom browser, fetches registered WebMCP tool definitions, and returns them to the agent.
    * `mcp:call_tool`: Routes the tool execution payload to the browser, awaits completion with timeout safeguards (15s), and returns the execution result.

---

### 3.3 Frontend WebMCP & Canvas Engine (`frontend/`)

* **`src/webmcp/webMcpBridge.ts`**:
  * Client-side singleton managing tool registration, prompt templates, resources, execution logging, and socket event binding.
  * Polyfills the emerging **W3C `document.modelContext` / `window.modelContext`** standard, allowing any browser-native AI assistant or remote MCP agent to discover and invoke page capabilities.
* **`src/webmcp/pluginToolsBridge.ts`**:
  * Dynamically translates declarative `PluginManifest` contributions and UI form fields (`PluginToolFormField`) into valid JSON Schema MCP tools (`plugin_{pluginId}_{toolSlug}`).
  * Bridges agent arguments to plugin command handlers with automatic type normalization and default value fallback.
* **`src/webmcp/tools.ts`**:
  * Contains declarations and handlers for all built-in core WebMCP tools.
  * Interacts directly with the canvas engine via `boardCommands.ts`.
* **`src/lib/boardCommands.ts`**:
  * React-free command execution layer over Zustand canvas stores (`boardStore`, `linksStore`).
  * Ensures deterministic mutations and broadcasts updates across the room socket (`draw-stroke`, `chat:send`, etc.).

---

## 4. Tool Taxonomy & Progressive Discovery Architecture

Tools in Chalkboard are categorized into three distinct tiers:

```
                               ┌────────────────────────┐
                               │   ALL CAPABILITIES     │
                               └───────────┬────────────┘
                                           │
             ┌─────────────────────────────┼─────────────────────────────┐
             ▼                             ▼                             ▼
   ┌───────────────────┐         ┌───────────────────┐         ┌───────────────────┐
   │    Meta Tools     │         │    Core Tools     │         │   Plugin Tools    │
   │  (Discovery &     │         │ (Canvas Primitives│         │  (Domain Packs:   │
   │   Lifecycle)      │         │   & Room Actions) │         │   Math, Stats...) │
   ├───────────────────┤         ├───────────────────┤         ├───────────────────┤
   │ • discover_plugins│         │ • get_state       │         │ • math_set_venn   │
   │ • load_plugin     │         │ • draw_chalk      │         │ • math_set_grid   │
   │ • activate_plugin │         │ • write_text      │         │ • stats_chart     │
   │ • deactivate_plg  │         │ • insert_shape    │         │ • quiz_generator  │
   │                   │         │ • create_note     │         │ • chemistry_lab   │
   │                   │         │ • highlight_area  │         │                   │
   │                   │         │ • speak_narration │         │                   │
   │                   │         │ • send_chat       │         │                   │
   └───────────────────┘         └───────────────────┘         └───────────────────┘
```

### 4.1 Meta / Lifecycle Tools (Active on Boot)

| Tool Name | Purpose | Key Parameters |
| :--- | :--- | :--- |
| `chalkboard_discover_plugins` | Queries installed and marketplace plugins matching topic queries (e.g. "geometry", "chemistry", "quiz"). | `query?: string`, `category?: string` |
| `chalkboard_load_plugin` / `chalkboard_activate_plugin` | Loads a plugin into browser memory, executes its `activate()` lifecycle, registers its tools into WebMCP, and returns newly available tools. | `pluginId: string` |
| `chalkboard_deactivate_plugin` | Unloads a plugin from active tool sets to prune LLM context window during long lessons. | `pluginId: string` |

### 4.2 Core Canvas & Classroom Tools (Active on Boot)

| Tool Name | Description | Key Parameters |
| :--- | :--- | :--- |
| `chalkboard_get_state` | Retrieves canvas strokes, viewport pan/zoom, active links, and selection state. | `includeStrokeDetails?: boolean` |
| `chalkboard_draw_chalk` | Draws freehand strokes, mathematical curves, or annotations on the board. | `points: Array<{x, y}>`, `color`, `size` |
| `chalkboard_write_text` | Renders clean chalkboard typography for titles, explanations, or formulas. | `text: string`, `x`, `y`, `fontSize`, `color` |
| `chalkboard_insert_shape` | Inserts geometric shapes (rectangles, ellipses, triangles, arrows, stars). | `type`, `x`, `y`, `width`, `height`, `color` |
| `chalkboard_create_note` | Places sticky notes or rich HTML cards on the canvas. | `text: string`, `x`, `y`, `color` |
| `chalkboard_highlight_area` | Draws visual emphasis boxes (`focus`, `answer_box`, `correction`) around board areas. | `rect: {minX, minY, maxX, maxY}`, `type`, `label` |
| `chalkboard_select_and_transform` | Selects, moves, scales, rotates, or recolors existing canvas elements. | `action`, `strokeIds`, `deltaX`, `deltaY`, `scale` |
| `chalkboard_navigate_viewport` | Pans or zooms the camera to focus student attention on specific board coordinates. | `action: 'pan' \| 'zoom' \| 'center'`, `x`, `y`, `zoom` |
| `chalkboard_manage_topic_links` | Creates spatial bookmarks / jump-links across the infinite canvas. | `action`, `title`, `position: {x, y}` |
| `chalkboard_send_chat` | Sends text messages directly to the classroom chat room. | `message: string` |
| `chalkboard_speak_narration` | Triggers browser text-to-speech audio narration for spoken instruction. | `text: string`, `rate`, `pitch` |
| `chalkboard_clear_or_undo` | Clears the board or undos/redos recent actions. | `action: 'clear' \| 'undo' \| 'redo'` |

### 4.3 Domain Plugin Tools (Dynamically Activated)

When plugins are activated, their tools are namespaced and injected into the active schema:

* **Math Set Plugin (`chalkboard.math-set`)**:
  * `plugin_math_set_two_set_venn`: Generates two-set Venn diagrams with set labels and intersection elements.
  * `plugin_math_set_three_set_venn`: Generates three-set Venn diagrams.
  * `plugin_math_set_coordinate_grid`: Draws customizable Cartesian coordinate grids ($x/y$ axes, ticks, grid lines).
  * `plugin_math_set_graph`: Plots mathematical functions ($f(x) = x^2, \sin(x), \dots$) on coordinate axes.
  * `plugin_math_set_number_line`: Renders integer/fraction number lines with marked intervals.
  * `plugin_math_set_matrix`: Generates bracketed matrix displays.
* **Statistics Plugin (`chalkboard.statistics`)**:
  * `plugin_statistics_bar_chart`: Renders labeled vertical/horizontal bar charts.
  * `plugin_statistics_box_plot`: Generates five-number summary box plots.
  * `plugin_statistics_summary_table`: Inserts statistical summary cards (Mean, Median, Mode, Std Dev).

---

## 5. The Dynamic Plugin Activation & Re-Tooling Protocol

### The Zero-Roundtrip Activation Flow

To ensure optimal performance and minimal latency, `chalkboard_load_plugin` / `chalkboard_activate_plugin` follows this zero-roundtrip protocol:

```
Gemini Runner                Agent Transport              Room WebMCP (Browser)
     │                              │                              │
     │ 1. callTool(load_plugin)     │                              │
     ├─────────────────────────────►│ 2. emit('mcp:call_tool')     │
     │                              ├─────────────────────────────►│
     │                              │                              │ 3. Execute activate()
     │                              │                              │ 4. Register Manifest Tools
     │                              │ 5. Return newlyAddedTools    │
     │                              │◄─────────────────────────────┤
     │ 6. Response with Tool Defs   │                              │
     │◄─────────────────────────────┤                              │
     │                                                             │
     │ 7. Chat Reconfiguration:                                    │
     │    • Extract History                                        │
     │    • Append new FunctionDeclarations                        │
     │    • Recreate chat with expanded toolset                    │
     │                                                             │
     │ 8. Next Turn: Gemini immediately calls new tool!            │
     ├────────────────────────────────────────────────────────────►│
```

#### Example Activation Response Payload:
```json
{
  "success": true,
  "pluginId": "chalkboard.math-set",
  "pluginName": "Mathematical Set",
  "isBuiltIn": true,
  "newlyAddedTools": [
    {
      "name": "plugin_math_set_two_set_venn",
      "description": "[Plugin: Mathematical Set] Two-Set Venn: Generates an overlapping two-set Venn diagram",
      "inputSchema": {
        "type": "object",
        "properties": {
          "setALabel": { "type": "string", "default": "Set A" },
          "setBLabel": { "type": "string", "default": "Set B" },
          "universalLabel": { "type": "string", "default": "U" },
          "setAOnly": { "type": "string", "description": "Comma-separated values in Set A only" },
          "setBOnly": { "type": "string", "description": "Comma-separated values in Set B only" },
          "intersection": { "type": "string", "description": "Comma-separated values in intersection" }
        }
      }
    }
  ],
  "totalWebMcpToolsCount": 20
}
```

---

## 6. Pedagogical Loop & Autonomous Teaching Strategy

When given a teaching prompt (e.g., *"Teach Pythagoras' Theorem to 9th graders with worked examples and a practice problem"*), Chalkboard Master executes a structured 6-phase pedagogical framework:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      6-PHASE PEDAGOGICAL WORKFLOW                       │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. INTRODUCE TOPIC   │ Write clean title header (write_text);           │
│                      │ Welcome students out loud (speak_narration).     │
├──────────────────────┼──────────────────────────────────────────────────┤
│ 2. VISUAL DIAGRAM    │ Sketch geometric figures or charts.              │
│                      │ Discover and activate plugins if needed.         │
├──────────────────────┼──────────────────────────────────────────────────┤
│ 3. WORKED EXAMPLE    │ Step through formula derivations;                │
│                      │ Use focus highlight boxes (highlight_area).      │
├──────────────────────┼──────────────────────────────────────────────────┤
│ 4. PRACTICE PROBLEM  │ Create an answer box for student collaboration;  │
│                      │ Pose questions in chat (send_chat).              │
├──────────────────────┼──────────────────────────────────────────────────┤
│ 5. REINFORCE & EXTEND│ Draw summary cards or add topic bookmark links.  │
├──────────────────────┼──────────────────────────────────────────────────┤
│ 6. ADAPT & CORRECT   │ Read board state (get_state);                    │
│                      │ Circle mistakes with correction highlight boxes. │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 7. Security, Permissions & Sandboxing

As Chalkboard expands to third-party community plugins, the Capability Layer enforces strict permission boundaries:

### 7.1 Permission Scopes

```ts
export type PluginPermission =
  | 'board:read'        // Inspect canvas strokes, bounding boxes, text
  | 'board:write'       // Draw strokes, insert shapes, render text
  | 'selection:read'    // Read currently highlighted/selected objects
  | 'selection:write'   // Transform or manipulate selected strokes
  | 'ui:panel'          // Open custom sidebar panels
  | 'ui:modal'          // Render modal dialogs
  | 'room:sync'         // Emit real-time plugin data packets to classmates
  | 'network:fetch';    // External HTTP API access (requires domain whitelist)
```

### 7.2 Execution Sandboxing Model

* **Built-in First-Party Plugins** (`mathSet`, `statistics`, `tag`, `notes`): Execute in the main browser thread via verified TypeScript modules.
* **Third-Party Marketplace Plugins**: Execute inside **Isolated Web Workers or Sandboxed Iframes (`sandbox="allow-scripts"`)**.
  * Communication occurs strictly over structured `postMessage` RPC.
  * Plugins have no access to `window.localStorage`, session cookies, auth tokens, or parent DOM elements.
  * Canvas mutation requests are validated against declared permissions before passing to `boardCommands.ts`.

---

## 8. Reliability, Fault Tolerance & Operational Best Practices

1. **Transient API Retry Loop**:
   Gemini API calls encountering temporary overload (HTTP 503 / 429) automatically retry with exponential backoff (2s, 4s, 6s) before failing.
2. **Execution Timeout Guardrails**:
   All browser tool execution calls relayed through the backend Socket.IO bridge have a strict 15-second timeout (`emitWithAck`). If a client browser hangs or drops, the agent receives an error response rather than hanging indefinitely.
3. **Session Isolation**:
   Only one agent runner is permitted per room at any given time. Starting a new lesson in an active room returns HTTP 409 unless explicitly terminated with `POST /stop`.
4. **Context History Integrity**:
   When re-tooling mid-lesson, `geminiMcpRunner` retrieves the active conversation history with `chat.getHistory()`, ensuring full multi-turn conversational continuity across dynamic tool additions.

---

## 9. Developer Quickstart

### Running the Agent Service Locally

```bash
# 1. Navigate to the agent-service directory
cd agent-service

# 2. Install dependencies
npm install

# 3. Configure environment variables (.env)
cp .env.example .env
# Set GEMINI_API_KEY=your_gemini_api_key
# Set MAIN_BACKEND_SOCKET_URL=http://localhost:5000
# Set AGENT_SECRET=your_agent_secret

# 4. Start in development mode with live reload
npm run dev

# 5. Type-check the codebase
npm run typecheck
```

### Triggering a Test Lesson via cURL

```bash
curl -X POST http://localhost:5001/instruct \
  -H "Content-Type: application/json" \
  -d '{
    "roomId": "algebra-101",
    "prompt": "Explain the quadratic formula, graph y = x^2 - 4x + 3 on a coordinate grid, and highlight the roots.",
    "level": "High School",
    "style": "Visual, Step-by-Step & Interactive"
  }'
```

---

## 10. Advanced Agent Intelligence & The 3-Layer Architecture

Chalkboard Master incorporates state-of-the-art agent engineering principles synthesized from **OpenAI Codex**, **Set Kyar Autonomous Agent Loops**, and **Google Agent Development Kit (ADK)**:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     LAYER 3: MULTI-AGENT SUB-DELEGATION & REFINEMENT                    │
│                                  (Google ADK Architecture)                              │
│                                                                                         │
│   ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│   │  LoopAgent (Iterative Refinement)                                               │   │
│   │   ┌───────────────────────────┐      Feedback Loop     ┌─────────────────────┐  │   │
│   │   │     Generator Agent       │ ─────────────────────► │  Reviewer / Critic  │  │   │
│   │   │ (Drafts diagram / proof)  │ ◄───────────────────── │ (Checks layout/math)│  │   │
│   │   └───────────────────────────┘      State Variable    └──────────┬──────────┘  │   │
│   │                                                                   │ Escalation /│   │
│   │                                                                   ▼ Max Iter    │   │
│   │  SequentialAgent Pipeline:   [Socratic Planner] ──► [LoopAgent] ──► [Executor]  │   │
│   └─────────────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     LAYER 2: MACRO TASK ORCHESTRATION & STATE LEDGER                    │
│                                 (Set Kyar Architecture)                                 │
│                                                                                         │
│   • Socratic Requirements Interview: Ask probing questions before major actions        │
│   • Three-Tier Ledger: Master Spec ──► Prioritized Task Backlog ──► Change History      │
│   • Single-Task Isolation: Pick 1 discrete task, execute with sub-agents, verify        │
│   • Gap Analysis: Continuously check remaining work against Master Spec                 │
└────────────────────────────────────────────┬────────────────────────────────────────────┘
                                             │
                                             ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                     LAYER 1: MICRO-TURN HARNESS & CONTEXT ENGINEERING                   │
│                                 (OpenAI Codex Architecture)                             │
│                                                                                         │
│   • Progressive Tool Disclosure: Load only active tool subsets (WebMCP plugins)         │
│   • Actionable Error Signals: Diagnostic hints when tools fail (coordinate boundaries)  │
│   • Context Compaction: Prune stale tool outputs and keep rolling milestone summaries  │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 11. Room Metadata & Environmental Context Ingestion

When the agent connects to a classroom (`SocketIoMcpTransport` / `RoomAgentSession`), it automatically receives and ingests the classroom's full metadata profile from the backend:

### Ingested Room Profile
* **Classroom Title** (e.g. *"AP Physics C: Classical Mechanics"*): Establishes the subject, domain, and context.
* **Description / Syllabus** (e.g. *"Kinematics, Newton's Laws, Rotational Dynamics"*): Establishes the scope and learning objectives.
* **Visual Theme** (`classroom`, `dark`, `blueprint`, `math_grid`): Influences contrast and chalk color choices.
* **Access Mode & Default Role** (`open`, `invite_only`, `instructor`, `viewer`): Informs audience privilege.
* **Voice / WebRTC Status** (`voiceEnabled`): Indicates whether voice channels are active.

```typescript
export interface RoomMetadata {
  id: string;
  slug: string;
  title: string;
  description?: string | null;
  theme: string;
  accessMode: string;
  defaultRole: string;
  voiceEnabled: boolean;
  ownerId?: string;
  createdAt?: string;
}
```

This metadata is injected directly into Gemini's system instructions, providing immediate contextual grounding without requiring the user to restate the subject matter.

---

## 12. Strict Modality Matching & Canvas Restraint Policies

Chalkboard Master enforces strict behavioral invariants to ensure non-disruptive, polite classroom assistance:

| Invocation Modality | Permitted Response Modality | Rules & Constraints |
| :--- | :--- | :--- |
| **💬 Chat Text Query** (`@Master`, `/ask`, `/help`) | **Chat Text (`chalkboard_send_chat`)** | • **No Voice Spoken**: Do NOT call `chalkboard_speak_narration` unless audio was explicitly requested.<br>• **No Canvas Clutter**: Do NOT draw or modify the board unless visual action was requested. |
| **🎙️ Voice / Audio Channel** | **Spoken Narration (`chalkboard_speak_narration`)** | • Do not spam text chat with duplicate transcripts unless asked. |
| **🎨 Visual / Drawing Request** (*"Draw a Venn diagram"*, *"Graph $f(x)$"*) | **Canvas Primitives & Domain Plugins** | • Execute layout calculation, select tools, and render clean visual objects. |

### Core Invariants:
1. **Canvas Restraint Policy**: Never alter or draw on the chalkboard unless the user explicitly requested drawing, diagrams, visual proofs, or board changes. Conceptual questions asked in chat receive answers in chat.
2. **Socratic Clarification Policy**: If a request is ambiguous, underspecified, or could overwrite existing work, ask clarifying questions in chat before taking action.
3. **No Meta-Summary Leaking**: Never output internal tool lists (e.g., `"Actions Taken: 1. chalkboard_write_text..."`). Address the students naturally and directly.

---

## 13. Socratic Clarification & Interactive Requirements Gathering

Before executing complex or destructive requests (e.g., clearing the board, reorganizing notes, or building advanced charts), the agent initiates a **Socratic Clarification Turn**:

1. **Detect Ambiguity**:
   * Missing parameters (e.g., *"Draw a coordinate grid"* $\to$ what ranges for $x$ and $y$?).
   * Destructive actions (e.g., *"Clear and draw physics"* $\to$ confirm if existing student notes should be erased or moved aside).
2. **Formulate Probing Question**:
   * Send a polite, targeted question via `chalkboard_send_chat`.
3. **Wait for Student Clarification**:
   * Ingest user response into `RoomWorkingMemory` and execute with full specification.

---

## 14. Multi-Agent Refinement Loops (`LoopAgent` Pattern)

For complex domain visuals (e.g. coordinate graphs with multiple roots, statistical distributions, or multi-set Venn diagrams), Chalkboard Master employs a **Generator $\leftrightarrow$ Critic Loop**:

```
[Drafter Sub-Agent] ──(Draft Layout & Coordinates)──► [Visual & Pedagogical Critic]
       ▲                                                          │
       │                                                          ▼
       └────────────(Critique & Spacing Adjustments)──────────────┘
                                                                  │
                                                        Approved? │ (Score >= 90% or maxTurns)
                                                                  ▼
                                                      [Emit Canvas Strokes]
```

* **Drafter**: Proposes bounding boxes, point series, and font sizes.
* **Critic**: Evaluates against canvas collision rules, text legibility, and pedagogical clarity.
* **Harness**: Executes the verified commands sequentially through WebMCP.

---

## 15. System Information Reference

Complete system environment contracts, runtime variables, tool catalogs, and template parameters are formally maintained in [`SYSTEM_INFO.md`](file:///c:/Users/HP/codes/chalkboard/agent-service/SYSTEM_INFO.md).

