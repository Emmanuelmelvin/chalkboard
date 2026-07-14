# Chalkboard Plugin Implementation Plan

## 1. Purpose

This document describes a recommended implementation plan for adding a Figma-like plugin system to Collaborative Chalkboard.

The goal is to let Chalkboard support installable, configurable, collaborative plugin packs. For example, a `Mathematical Set` plugin could add set theory symbols, Venn diagrams, number lines, coordinate grids, and math teaching templates to the chalkboard experience.

The recommended approach is to start with a safe, first-party plugin architecture and evolve toward a marketplace-style system once the core extension points are stable.

---

## 2. Product Vision

Chalkboard is already a collaborative canvas application. A plugin system should extend the board without requiring every feature to live in the core app.

Plugins should be able to contribute:

- Toolbar buttons.
- Insertable shapes and templates.
- Commands and command palette actions.
- Side panels and modal interfaces.
- Canvas object generators.
- Room-aware collaborative actions.
- Optional backend-powered services.

Example plugin categories include:

- **Mathematical Set**: set symbols, Venn diagrams, number lines, grids, proof templates.
- **Geometry Kit**: rulers, compasses, angles, polygons, transformations.
- **Chemistry Kit**: molecules, bonds, reaction arrows, periodic table snippets.
- **Music Staff**: staves, notes, clefs, chord diagrams.
- **Teacher Templates**: Cornell notes, quizzes, diagrams, classroom games.
- **Mind Mapping**: nodes, connectors, automatic layouts.

---

## 3. Recommended Implementation Strategy

Do not begin with a fully public marketplace. The safer and more maintainable path is incremental.

### Phase 1: First-Party Plugin Runtime

Build the internal plugin API, registry, and UI integration. Plugins are trusted and bundled with the app.

### Phase 2: Built-In Plugin Packs

Implement the first plugin, `Mathematical Set`, as a bundled plugin using the same public plugin API that future third-party plugins will use.

### Phase 3: Install/Enable Configuration

Add frontend configuration for enabling and disabling plugins per user or per room.

### Phase 4: Backend Persistence

Persist plugin installation and configuration state in the backend.

### Phase 5: Sandboxed Third-Party Plugins

Load remote plugins in sandboxed iframes using a message bridge and explicit permissions.

### Phase 6: Marketplace

Add marketplace listing, versioning, review, permissions, author verification, and signed manifests.

---

## 4. Core Concepts

### 4.1 Plugin

A plugin is an extension package that registers tools, commands, panels, insertable objects, or collaborative behavior.

```ts
export interface ChalkboardPlugin {
  id: string;
  name: string;
  version: string;
  activate(api: ChalkboardPluginAPI): void | Promise<void>;
  deactivate?: () => void | Promise<void>;
}
```

### 4.2 Manifest

A manifest describes what a plugin is and what it contributes before the plugin code executes.

```ts
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  icon?: string;
  entry?: string;
  permissions: PluginPermission[];
  contributes: PluginContributions;
}
```

### 4.3 Plugin Contributions

Plugin contributions are declarative capabilities exposed by the plugin.

```ts
export interface PluginContributions {
  tools?: PluginToolContribution[];
  commands?: PluginCommandContribution[];
  panels?: PluginPanelContribution[];
  insertables?: PluginInsertableContribution[];
  templates?: PluginTemplateContribution[];
}
```

### 4.4 Plugin Command

Commands are named actions that can be triggered from toolbar buttons, menu items, keyboard shortcuts, panels, or other plugins.

```ts
export type PluginCommandHandler = (payload?: unknown) => void | Promise<void>;
```

---

## 5. Proposed File Structure

Create a dedicated plugin runtime under the frontend source tree.

```txt
frontend/src/plugins/
├── api.ts
├── installedPlugins.ts
├── loader.ts
├── permissions.ts
├── registry.ts
├── types.ts
└── builtin/
    └── mathSet/
        ├── generators.ts
        ├── index.ts
        ├── manifest.ts
        └── symbols.ts
```

Optional future backend files:

```txt
backend/src/plugins/
├── marketplace.ts
├── manifests.ts
├── installs.ts
└── permissions.ts
```

If the backend remains a single `server.js` file initially, plugin endpoints can be added there first and extracted later.

---

## 6. Plugin Manifest Design

A plugin manifest should be valid JSON so it can be loaded locally or remotely.

Example `Mathematical Set` manifest:

```json
{
  "id": "chalkboard.math-set",
  "name": "Mathematical Set",
  "version": "1.0.0",
  "description": "Set theory symbols, Venn diagrams, number lines, grids, and math templates.",
  "author": "Chalkboard Labs",
  "icon": "/plugins/math-set/icon.svg",
  "entry": "/plugins/math-set/index.js",
  "permissions": [
    "board:read",
    "board:write",
    "selection:read",
    "room:sync"
  ],
  "contributes": {
    "tools": [
      {
        "id": "math-set.venn-diagram",
        "label": "Venn Diagram",
        "icon": "venn",
        "command": "mathSet.insertVennDiagram"
      },
      {
        "id": "math-set.number-line",
        "label": "Number Line",
        "icon": "number-line",
        "command": "mathSet.insertNumberLine"
      }
    ],
    "commands": [
      {
        "id": "mathSet.insertVennDiagram",
        "title": "Insert Venn Diagram"
      },
      {
        "id": "mathSet.insertNumberLine",
        "title": "Insert Number Line"
      },
      {
        "id": "mathSet.insertSetSymbol",
        "title": "Insert Set Symbol"
      }
    ],
    "insertables": [
      {
        "id": "math-set.symbols",
        "label": "Set Symbols",
        "panel": "mathSet.symbolPicker"
      }
    ]
  }
}
```

---

## 7. Runtime API Design

Plugins should never directly mutate the internal Zustand store or the raw Socket.io client. Instead, expose a stable API wrapper.

```ts
export interface ChalkboardPluginAPI {
  board: PluginBoardAPI;
  selection: PluginSelectionAPI;
  ui: PluginUIAPI;
  commands: PluginCommandAPI;
  collaboration: PluginCollaborationAPI;
}
```

### 7.1 Board API

```ts
export interface PluginBoardAPI {
  getRoomId(): string;
  getUserId(): string;
  getStrokes(): Stroke[];
  getViewport(): PluginViewport;
  getViewportCenter(): Point;
  insertStrokes(strokes: Stroke[], options?: InsertStrokeOptions): void;
  updateStrokes(strokes: Stroke[]): void;
  removeStrokes(ids: string[]): void;
}
```

### 7.2 Selection API

```ts
export interface PluginSelectionAPI {
  getSelectedStrokeIds(): string[];
  setSelectedStrokeIds(ids: string[]): void;
  clear(): void;
}
```

### 7.3 UI API

```ts
export interface PluginUIAPI {
  registerTool(tool: PluginTool): void;
  registerPanel(panel: PluginPanel): void;
  showToast(message: string): void;
  openModal(config: PluginModalConfig): void;
}
```

### 7.4 Command API

```ts
export interface PluginCommandAPI {
  register(commandId: string, handler: PluginCommandHandler): void;
  unregister(commandId: string): void;
  execute(commandId: string, payload?: unknown): void | Promise<void>;
}
```

### 7.5 Collaboration API

```ts
export interface PluginCollaborationAPI {
  broadcastPluginEvent(eventName: string, payload: unknown): void;
  onPluginEvent(eventName: string, handler: (payload: unknown) => void): () => void;
}
```

For the first version, most plugins should collaborate by inserting normal board strokes rather than sending custom plugin events.

---

## 8. Registry Design

The registry owns plugin lifecycle and contribution lookup.

```ts
export class PluginRegistry {
  private plugins = new Map<string, ChalkboardPlugin>();
  private manifests = new Map<string, PluginManifest>();
  private commands = new Map<string, PluginCommandHandler>();
  private tools = new Map<string, PluginTool>();

  registerManifest(manifest: PluginManifest): void;
  registerPlugin(plugin: ChalkboardPlugin): void;
  activatePlugin(pluginId: string, api: ChalkboardPluginAPI): Promise<void>;
  deactivatePlugin(pluginId: string): Promise<void>;
  getTools(): PluginTool[];
  getCommands(): PluginCommandContribution[];
  executeCommand(commandId: string, payload?: unknown): Promise<void>;
}
```

Responsibilities:

- Validate manifests.
- Track installed plugins.
- Activate enabled plugins.
- Register plugin commands.
- Register plugin UI contributions.
- Prevent duplicate command IDs.
- Enforce permissions.
- Clean up contributions when plugins are disabled.

---

## 9. Installation and Configuration

### 9.1 Frontend-Only Configuration

Start with a simple local list.

```ts
export const installedPlugins = [
  {
    id: 'chalkboard.math-set',
    enabled: true,
    scope: 'user'
  }
];
```

This can later be replaced with data fetched from the backend.

### 9.2 User-Scoped Plugins

User-scoped plugins are installed for the current user and follow that user across rooms.

Use cases:

- A teacher always wants the Mathematical Set plugin available.
- A student wants personal accessibility tools.

### 9.3 Room-Scoped Plugins

Room-scoped plugins are enabled for everyone in a particular room.

Use cases:

- A math class room enables Mathematical Set.
- A chemistry room enables Chemistry Kit.
- A music room enables Music Staff.

Recommended install model:

```ts
export interface InstalledPlugin {
  pluginId: string;
  version: string;
  enabled: boolean;
  installedByUserId: string;
  scope: 'user' | 'room' | 'workspace';
  roomId?: string;
}
```

---

## 10. Mathematical Set Plugin Example

### 10.1 Features

The first plugin should include:

- Insert Venn diagram.
- Insert two-set and three-set Venn templates.
- Insert number line.
- Insert coordinate grid.
- Insert common set symbols.
- Insert proof template.

### 10.2 Symbols

```ts
export const SET_SYMBOLS = [
  '∈',
  '∉',
  '⊂',
  '⊆',
  '⊄',
  '⊃',
  '⊇',
  '∪',
  '∩',
  '∅',
  'ℕ',
  'ℤ',
  'ℚ',
  'ℝ',
  'ℂ'
];
```

### 10.3 Plugin Activation

```ts
export const mathSetPlugin: ChalkboardPlugin = {
  id: 'chalkboard.math-set',
  name: 'Mathematical Set',
  version: '1.0.0',

  activate(api) {
    api.ui.registerTool({
      id: 'math-set.venn-diagram',
      label: 'Venn Diagram',
      command: 'mathSet.insertVennDiagram'
    });

    api.commands.register('mathSet.insertVennDiagram', () => {
      const strokes = createVennDiagramStrokes({
        center: api.board.getViewportCenter(),
        userId: api.board.getUserId(),
        color: '#ffffff'
      });

      api.board.insertStrokes(strokes, { select: true });
    });
  }
};
```

### 10.4 Stroke-Based Output

The first implementation should output normal Chalkboard strokes.

Advantages:

- Works with current rendering.
- Works with selection.
- Works with erasing.
- Works with undo/redo once command history is connected.
- Works for users who do not have the plugin installed.
- Syncs naturally if inserted strokes are broadcast through the existing board sync model.

---

## 11. Collaborative Behavior

### 11.1 Recommended Version 1 Behavior

Plugin commands should produce regular board mutations.

For example:

1. User selects `Mathematical Set > Venn Diagram`.
2. Plugin generates `Stroke[]`.
3. App inserts strokes locally.
4. App broadcasts the board update to the room.
5. Other users receive the same strokes.

This avoids requiring every collaborator to have the same plugin installed just to see the result.

### 11.2 Advanced Plugin Events

Later, plugins may need custom collaboration.

Example event:

```ts
api.collaboration.broadcastPluginEvent('mathSet.symbolSelected', {
  symbol: '∩',
  position: { x: 100, y: 200 }
});
```

The host app should validate:

- The plugin is installed and enabled.
- The plugin has the `room:sync` permission.
- The payload is within size limits.
- The event name is namespaced to the plugin.

---

## 12. Permissions

Permissions make plugin behavior explicit.

Recommended permissions:

```ts
export type PluginPermission =
  | 'board:read'
  | 'board:write'
  | 'selection:read'
  | 'selection:write'
  | 'ui:panel'
  | 'ui:modal'
  | 'room:sync'
  | 'network:fetch'
  | 'storage:local'
  | 'storage:room';
```

Permission examples:

- `board:read`: plugin can inspect strokes.
- `board:write`: plugin can insert, update, or remove strokes.
- `selection:read`: plugin can inspect selected items.
- `selection:write`: plugin can change selection.
- `ui:panel`: plugin can register a side panel.
- `room:sync`: plugin can send room-scoped plugin events.
- `network:fetch`: plugin can request external resources.
- `storage:local`: plugin can store user-local settings.
- `storage:room`: plugin can store room-level plugin settings.

For bundled first-party plugins, permissions can be validated but not prompted. For third-party plugins, permissions should be shown during installation.

---

## 13. Security Model

### 13.1 Trusted Built-In Plugins

The first implementation should only support trusted built-in plugins imported directly into the frontend bundle.

This avoids immediate risks around arbitrary JavaScript execution.

### 13.2 Sandboxed Plugins

When third-party plugins are supported, run them in sandboxed iframes.

Recommended iframe attributes:

```html
<iframe
  sandbox="allow-scripts"
  src="/plugin-sandbox.html?pluginId=chalkboard.math-set"
/>
```

The plugin iframe should not receive direct access to cookies, the parent DOM, or the internal app store.

Communication should happen through `postMessage`.

### 13.3 Message Bridge

Host-to-plugin message:

```ts
iframe.contentWindow?.postMessage({
  type: 'chalkboard:init',
  pluginId,
  permissions,
  manifest
}, pluginOrigin);
```

Plugin-to-host message:

```ts
window.parent.postMessage({
  type: 'chalkboard:command',
  command: 'board.insertStrokes',
  payload: strokes
}, hostOrigin);
```

The host must validate every incoming message.

### 13.4 Remote Plugin Restrictions

Remote plugins should require:

- Signed manifests.
- Version pinning.
- Allowed origins.
- Content Security Policy restrictions.
- Marketplace review.
- Permission prompts.
- Payload size limits.
- Rate limiting for plugin events.

---

## 14. UI Integration

### 14.1 Plugin Button

Add a `Plugins` button to the main toolbar or near the existing insert button.

Suggested behavior:

- Click opens plugin drawer.
- Drawer lists enabled plugins.
- Each plugin shows contributed tools and actions.
- Disabled plugins show an install/enable prompt.

### 14.2 Insert Panel Integration

The existing insert-shapes experience can become a generalized insert panel.

Suggested tabs:

```txt
Insert
├── Shapes
├── Links
└── Plugins
    ├── Mathematical Set
    ├── Geometry Kit
    └── Chemistry Kit
```

### 14.3 Command Palette

A command palette can expose plugin commands.

Example commands:

```txt
Mathematical Set: Insert Venn Diagram
Mathematical Set: Insert Number Line
Mathematical Set: Insert Set Symbol
```

### 14.4 Plugin Manager

Add a plugin manager modal.

Sections:

- Installed.
- Available.
- Enabled for this room.
- Permissions.
- Settings.
- Updates.

---

## 15. Backend API Plan

A marketplace-style backend can be added later.

Recommended endpoints:

```txt
GET    /api/plugins
GET    /api/plugins/:pluginId
GET    /api/plugins/:pluginId/versions
POST   /api/plugins/:pluginId/install
DELETE /api/plugins/:pluginId/install
GET    /api/users/:userId/plugins
GET    /api/rooms/:roomId/plugins
POST   /api/rooms/:roomId/plugins/:pluginId/enable
POST   /api/rooms/:roomId/plugins/:pluginId/disable
GET    /api/rooms/:roomId/plugins/:pluginId/settings
PUT    /api/rooms/:roomId/plugins/:pluginId/settings
```

### 15.1 Plugin Marketplace Record

```ts
export interface PluginMarketplaceEntry {
  id: string;
  name: string;
  description: string;
  latestVersion: string;
  authorId: string;
  iconUrl: string;
  manifestUrl: string;
  verified: boolean;
  permissions: PluginPermission[];
}
```

### 15.2 Plugin Install Record

```ts
export interface PluginInstallRecord {
  pluginId: string;
  version: string;
  enabled: boolean;
  scope: 'user' | 'room' | 'workspace';
  userId?: string;
  roomId?: string;
  installedByUserId: string;
  installedAt: string;
}
```

---

## 16. Socket.io Event Plan

Recommended plugin-related events:

```txt
plugin:event
plugin:installed
plugin:enabled
plugin:disabled
plugin:settings-updated
```

Example event payload:

```ts
export interface PluginEventPayload {
  roomId: string;
  pluginId: string;
  eventName: string;
  payload: unknown;
  senderId: string;
}
```

Validation rules:

- `roomId` must match the sender's joined room.
- `pluginId` must be enabled for the room or user.
- Event payload must be serializable.
- Event payload must be size-limited.
- Event names must be plugin-namespaced.

---

## 17. Data Model Evolution

### 17.1 Version 1: Stroke-Only Plugins

Plugins generate normal strokes.

This is the recommended starting point.

### 17.2 Version 2: Plugin Metadata on Strokes

Add optional plugin metadata to strokes.

```ts
export interface PluginStrokeMetadata {
  pluginId: string;
  objectType: string;
  objectId: string;
  editable: boolean;
  data?: unknown;
}
```

Then extend strokes with:

```ts
plugin?: PluginStrokeMetadata;
```

This lets a Mathematical Set Venn diagram remain editable as a smart object while still rendering as strokes.

### 17.3 Version 3: Dedicated Plugin Objects

Add a separate object model for plugin-owned objects.

```ts
export interface PluginObject {
  id: string;
  pluginId: string;
  type: string;
  bounds: Rect;
  data: unknown;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
```

Only add this after the stroke-only plugin approach proves insufficient.

---

## 18. Undo/Redo Integration

Plugin actions should be command-based so they can integrate with undo/redo.

Recommended board command model:

```ts
export interface BoardCommand {
  id: string;
  label: string;
  source: 'core' | 'plugin';
  pluginId?: string;
  apply(): void;
  undo(): void;
}
```

Plugin insertion command:

```ts
export interface InsertPluginStrokesCommand extends BoardCommand {
  source: 'plugin';
  pluginId: string;
  strokes: Stroke[];
}
```

This prevents plugin actions from bypassing history.

---

## 19. Error Handling

Plugin failures should not crash the board.

Recommended behavior:

- Wrap plugin activation in a safe boundary.
- Disable a plugin if activation fails repeatedly.
- Show a user-friendly toast.
- Log errors with plugin id, version, and command id.
- Prevent failed commands from partially mutating board state.

Example:

```ts
try {
  await registry.executeCommand(commandId, payload);
} catch (error) {
  api.ui.showToast('Plugin action failed.');
  console.error('[Plugin command failed]', { commandId, error });
}
```

---

## 20. Testing Plan

### 20.1 Unit Tests

Test:

- Manifest validation.
- Permission checks.
- Registry command registration.
- Duplicate command handling.
- Mathematical Set stroke generators.
- Plugin enable/disable behavior.

### 20.2 Integration Tests

Test:

- Plugin appears in UI.
- Plugin command inserts strokes.
- Inserted strokes can be selected and erased.
- Inserted strokes sync to another client.
- Disabled plugins do not register tools.
- Plugin errors do not crash the board.

### 20.3 Collaboration Tests

Test with two browser sessions:

1. User A joins room.
2. User B joins same room.
3. User A inserts a Venn diagram.
4. User B sees the Venn diagram.
5. User B selects and modifies it.
6. User A sees the updated state.

---

## 21. Suggested Development Milestones

### Milestone 1: Plugin Types and Registry

Deliverables:

- `frontend/src/plugins/types.ts`
- `frontend/src/plugins/registry.ts`
- Basic command registration.
- Basic tool registration.

### Milestone 2: Plugin API Wrapper

Deliverables:

- `frontend/src/plugins/api.ts`
- Safe board API.
- Safe selection API.
- Safe UI API.
- Safe command API.

### Milestone 3: Mathematical Set Plugin

Deliverables:

- `frontend/src/plugins/builtin/mathSet/manifest.ts`
- `frontend/src/plugins/builtin/mathSet/index.ts`
- `frontend/src/plugins/builtin/mathSet/generators.ts`
- Venn diagram generator.
- Number line generator.
- Set symbol list.

### Milestone 4: UI Integration

Deliverables:

- Plugin panel or insert-panel tab.
- Registered plugin tools visible in the UI.
- Plugin command execution from UI.

### Milestone 5: Collaborative Stroke Insertion

Deliverables:

- Plugin-generated strokes inserted locally.
- Plugin-generated strokes broadcast to room.
- Plugin-generated strokes included in room history.

### Milestone 6: Install/Enable State

Deliverables:

- `installedPlugins.ts`.
- Enable/disable UI.
- Room-scoped plugin setting placeholder.

### Milestone 7: Backend Persistence

Deliverables:

- Plugin install endpoints.
- Room plugin settings endpoints.
- Persisted enabled plugins.

### Milestone 8: Sandboxed Plugin Runtime

Deliverables:

- Plugin iframe host.
- Message bridge.
- Permission enforcement.
- Remote manifest loader.

---

## 22. Recommended First Pull Request Scope

The first implementation PR should be intentionally small.

Recommended scope:

1. Add plugin type definitions.
2. Add plugin registry.
3. Add plugin API wrapper.
4. Add bundled Mathematical Set plugin.
5. Add one UI entry point for plugin tools.
6. Support one command: `Insert Venn Diagram`.
7. Insert generated Venn diagram as normal strokes.

Avoid in the first PR:

- Public marketplace.
- Remote plugins.
- Sandboxed iframes.
- Backend persistence.
- Paid plugins.
- Plugin review system.
- Complex smart object editing.

---

## 23. Open Questions

Before building the full system, decide:

1. Should plugins be enabled per user, per room, or both?
2. Should users without a plugin installed be able to edit plugin-created objects?
3. Should plugin-created content remain smart/editable or become normal strokes?
4. Should plugin settings sync to all room participants?
5. Should third-party plugins be allowed to make network requests?
6. Should plugins be allowed in anonymous rooms?
7. Who can install room-level plugins?
8. Should plugins be version-pinned per room?
9. What is the maximum allowed plugin event payload size?
10. Will Chalkboard have user accounts, or are rooms fully anonymous?

---

## 24. Final Recommendation

Build the plugin system as a progressive extension platform.

Start with trusted, bundled plugins that generate normal board strokes. Use the Mathematical Set plugin as the proving ground because it is useful, domain-specific, and naturally fits a classroom chalkboard product.

Once the internal plugin API is stable, add install/enable configuration, backend persistence, sandboxed remote plugins, and finally a marketplace.

This approach gives Chalkboard the extensibility of Figma-style plugins without taking on marketplace security, sandboxing, and review complexity too early.

---

## 25. Current Implementation Status

The project now includes the first implementation slice described in this plan:

- A frontend plugin runtime under `frontend/src/plugins/`.
- Shared plugin types for manifests, commands, tools, runtime APIs, and permissions.
- A singleton plugin registry that can register installed plugins, activate them, expose contributed tools, and execute plugin commands.
- A safe plugin API wrapper that lets plugins insert strokes through the existing board store and Socket.io synchronization path rather than directly mutating internal implementation details.
- A bundled `Mathematical Set` plugin under `frontend/src/plugins/builtin/mathSet/`.
- A Plugins tab in the Insert panel so users can run plugin-contributed tools from the Chalkboard UI.

The bundled Mathematical Set plugin currently contributes these tools:

- `2-Set Venn`
- `3-Set Venn`
- `Number Line`
- `Coordinate Grid`

Each tool inserts normal Chalkboard strokes, selects the inserted strokes, closes the insert panel, and broadcasts the updated stroke list to the current room through the existing board synchronization flow.
<<<<<<< HEAD
=======

### 25.1 Follow-up UX Enhancements

The plugin UX has been expanded so the Insert panel now lists plugins first, similar to Figma plugin cards, with a placeholder search input ready for future backend-powered plugin discovery. Selecting a plugin opens a draggable plugin modal on top of the canvas. That modal shows the plugin's contributed tools, renders per-tool configuration fields, and then executes the plugin command with those form values.

Plugin contributions now support selection toolbar actions through `selectionTools`, so plugins can add contextual actions for selected canvas content. Plugin-generated insertions can also opt into grouped insertion and plugin metadata, allowing multi-stroke plugin objects such as Venn diagrams and number lines to move together and identify themselves as plugin-created content.

The Mathematical Set plugin now renders set symbols, configurable Venn labels, number-line labels/titles, and coordinate-grid axis labels using text strokes. Inserted Mathematical Set objects are grouped automatically and tagged with the built-in plugin identifier.
>>>>>>> 06fc3634bb49ab4c7658a86650b57ef2e5a266c6
