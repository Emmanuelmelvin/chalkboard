/**
 * @file activityFormatter.ts
 * @description Dynamic, schema-aware activity telemetry engine for MCP tools.
 * Automatically decomposes arbitrary and newly discovered tools into human-readable
 * action titles, salient parameter summaries, and canvas coordinates without hardcoded tool tables.
 */

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema?: {
    type?: string;
    properties?: Record<string, any>;
    required?: string[];
  };
}

/**
 * Verb conjugation mapping to convert imperative tool verbs into continuous present tense (gerunds).
 */
const VERB_GERUND_MAP: Record<string, string> = {
  add: 'Adding',
  apply: 'Applying',
  balance: 'Balancing',
  build: 'Building',
  calc: 'Calculating',
  calculate: 'Calculating',
  clear: 'Clearing',
  compile: 'Compiling',
  compute: 'Computing',
  connect: 'Connecting',
  create: 'Creating',
  delete: 'Deleting',
  discover: 'Discovering',
  display: 'Displaying',
  draw: 'Drawing',
  edit: 'Editing',
  erase: 'Erasing',
  evaluate: 'Evaluating',
  execute: 'Executing',
  export: 'Exporting',
  fetch: 'Fetching',
  find: 'Finding',
  format: 'Formatting',
  generate: 'Generating',
  get: 'Retrieving',
  graph: 'Plotting graph for',
  highlight: 'Highlighting',
  import: 'Importing',
  insert: 'Inserting',
  inspect: 'Inspecting',
  load: 'Loading',
  make: 'Making',
  manage: 'Managing',
  measure: 'Measuring',
  modify: 'Modifying',
  move: 'Moving',
  navigate: 'Navigating',
  pan: 'Panning',
  place: 'Placing',
  plot: 'Plotting',
  query: 'Querying',
  read: 'Reading',
  remove: 'Removing',
  render: 'Rendering',
  resize: 'Resizing',
  rotate: 'Rotating',
  run: 'Running',
  scale: 'Scaling',
  scan: 'Scanning',
  search: 'Searching',
  select: 'Selecting',
  send: 'Sending',
  simulate: 'Simulating',
  sketch: 'Sketching',
  solve: 'Solving',
  speak: 'Speaking',
  summarize: 'Summarizing',
  trace: 'Tracing',
  transform: 'Transforming',
  undo: 'Undoing',
  update: 'Updating',
  visualize: 'Visualizing',
  write: 'Writing',
  zoom: 'Zooming',
};

/**
 * Clean and capitalize words in a string.
 */
function toTitleCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

/**
 * Decomposes an arbitrary tool name into a human-readable action headline.
 * E.g.:
 *   "plugin_chemistry_periodic_table_draw_element" -> "Drawing Element (Chemistry Periodic Table)"
 *   "plugin_math_set_coordinate_grid" -> "Drawing Coordinate Grid (Math Set)"
 *   "chalkboard_write_text" -> "Writing on Chalkboard"
 *   "circuit_place_resistor" -> "Placing Resistor (Circuit)"
 *   "execute_python_script" -> "Executing Python Script"
 */
export function synthesizeToolAction(toolName: string, toolDef?: ToolDefinition): string {
  // Strip common namespace prefixes
  let cleaned = toolName
    .replace(/^mcp[_\-\.]/i, '')
    .replace(/^ext[_\-\.]/i, '')
    .replace(/^tool[_\-\.]/i, '');

  let pluginDomain = '';
  if (cleaned.startsWith('plugin_') || cleaned.startsWith('plugin-')) {
    cleaned = cleaned.replace(/^plugin[_\-]/i, '');
    const parts = cleaned.split(/_{1,2}|-/);
    if (parts.length > 2) {
      // First 1-2 parts identify domain plugin
      pluginDomain = toTitleCase(parts.slice(0, Math.min(2, parts.length - 2)).join(' '));
      cleaned = parts.slice(Math.min(2, parts.length - 2)).join('_');
    }
  } else if (cleaned.startsWith('chalkboard_') || cleaned.startsWith('chalkboard-')) {
    cleaned = cleaned.replace(/^chalkboard[_\-]/i, '');
  }

  // Tokenize the remainder to find the main verb and object
  const tokens = cleaned.split(/_{1,2}|-|\./).filter(Boolean);
  if (tokens.length === 0) return 'Executing Tool';

  const firstWord = tokens[0].toLowerCase();
  let actionPrefix = VERB_GERUND_MAP[firstWord];

  let phrase = '';
  if (actionPrefix) {
    const objectWords = tokens.slice(1).map(toTitleCase).join(' ');
    phrase = objectWords ? `${actionPrefix} ${objectWords}` : `${actionPrefix}...`;
  } else {
    // If not in verb map, title case the whole token sequence
    phrase = tokens.map(toTitleCase).join(' ');
    if (!phrase.endsWith('ing') && !phrase.startsWith('Executing') && !phrase.startsWith('Running')) {
      phrase = `Executing ${phrase}`;
    }
  }

  if (pluginDomain && !phrase.toLowerCase().includes(pluginDomain.toLowerCase())) {
    return `${phrase} (${pluginDomain})`;
  }

  return phrase;
}

/**
 * Synthesizes a concise, salient parameter summary for any arbitrary tool call arguments.
 */
export function synthesizeToolSummary(args: any = {}, toolDef?: ToolDefinition): string {
  if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).length === 0) {
    return toolDef?.description ? toolDef.description.split('.')[0] : 'Running tool action';
  }

  // Priority 1: High-information string identifiers (e.g. text, formula, query, title, name, etc.)
  const priorityKeys = [
    'formula',
    'equation',
    'expression',
    'text',
    'message',
    'query',
    'prompt',
    'title',
    'name',
    'label',
    'symbol',
    'topic',
    'code',
    'command',
    'content',
    'type',
    'action',
    'pluginId',
    'element',
    'component',
  ];

  for (const key of priorityKeys) {
    const val = args[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      const truncated = val.trim().slice(0, 45) + (val.trim().length > 45 ? '...' : '');
      const label = toTitleCase(key);
      return `${label}: "${truncated}"`;
    }
  }

  // Priority 2: Coordinate & Range summaries
  if (typeof args.x === 'number' && typeof args.y === 'number') {
    const extra = args.type ? ` (${args.type})` : args.color ? ` (${args.color})` : '';
    return `At (${Math.round(args.x)}, ${Math.round(args.y)})${extra}`;
  }

  if (typeof args.xMin === 'number' && typeof args.xMax === 'number') {
    return `Range x:[${args.xMin}..${args.xMax}], y:[${args.yMin ?? args.xMin}..${args.yMax ?? args.xMax}]`;
  }

  if (Array.isArray(args.points) && args.points.length > 0) {
    return `Drawing ${args.points.length} points (${args.color || 'chalk'})`;
  }

  // Priority 3: Dynamic multi-parameter key-value summary
  const entries = Object.entries(args)
    .filter(([k, v]) => v !== undefined && v !== null && k !== 'roomId')
    .slice(0, 3);

  if (entries.length > 0) {
    const parts = entries.map(([k, v]) => {
      const cleanKey = toTitleCase(k);
      if (typeof v === 'string') {
        return `${cleanKey}: "${v.slice(0, 20)}${v.length > 20 ? '...' : ''}"`;
      }
      if (typeof v === 'number' || typeof v === 'boolean') {
        return `${cleanKey}: ${v}`;
      }
      if (Array.isArray(v)) {
        return `${cleanKey}: [${v.length} items]`;
      }
      return `${cleanKey}`;
    });
    return parts.join(', ');
  }

  return toolDef?.description ? toolDef.description.split('.')[0] : 'Parameters configured';
}

/**
 * Universal dynamic tool activity formatter.
 * Works seamlessly for core tools AND any newly discovered / dynamically loaded plugin tools.
 */
export function formatToolActivity(
  toolName: string,
  args: any = {},
  toolDef?: ToolDefinition
): { toolAction: string; toolSummary: string } {
  const toolAction = synthesizeToolAction(toolName, toolDef);
  const toolSummary = synthesizeToolSummary(args, toolDef);
  return { toolAction, toolSummary };
}

/**
 * Universal spatial coordinate extractor for real-time cursor broadcasting.
 * Recursively inspects arguments to extract canvas (x, y) coordinates for ANY tool or plugin.
 */
export function extractCursorPosition(toolName: string, args: any = {}): { x: number; y: number } | null {
  if (!args || typeof args !== 'object') return null;

  // 1. Direct coordinates
  if (typeof args.x === 'number' && typeof args.y === 'number') {
    return { x: args.x, y: args.y };
  }

  // 2. Nested position / center / coords / target / point objects
  const nestedKeys = ['position', 'center', 'target', 'coords', 'location', 'point', 'start', 'origin'];
  for (const key of nestedKeys) {
    const obj = args[key];
    if (obj && typeof obj === 'object') {
      if (typeof obj.x === 'number' && typeof obj.y === 'number') {
        return { x: obj.x, y: obj.y };
      }
    }
  }

  // 3. CenterX / CenterY or TargetX / TargetY
  if (typeof args.centerX === 'number' && typeof args.centerY === 'number') {
    return { x: args.centerX, y: args.centerY };
  }
  if (typeof args.targetX === 'number' && typeof args.targetY === 'number') {
    return { x: args.targetX, y: args.targetY };
  }
  if (typeof args.startX === 'number' && typeof args.startY === 'number') {
    return { x: args.startX, y: args.startY };
  }

  // 4. Point arrays (freehand strokes, polygons, paths)
  const arrayKeys = ['points', 'path', 'vertices', 'coordsList', 'polyline'];
  for (const key of arrayKeys) {
    const list = args[key];
    if (Array.isArray(list) && list.length > 0) {
      const first = list[0];
      if (first && typeof first.x === 'number' && typeof first.y === 'number') {
        return { x: first.x, y: first.y };
      }
      if (Array.isArray(first) && first.length >= 2 && typeof first[0] === 'number' && typeof first[1] === 'number') {
        return { x: first[0], y: first[1] };
      }
    }
  }

  // 5. Bounding boxes / rects / ranges
  if (typeof args.minX === 'number' && typeof args.maxX === 'number') {
    const cx = (args.minX + args.maxX) / 2;
    const cy = typeof args.minY === 'number' && typeof args.maxY === 'number' ? (args.minY + args.maxY) / 2 : 0;
    return { x: cx, y: cy };
  }

  if (typeof args.xMin === 'number' && typeof args.xMax === 'number') {
    const cx = (args.xMin + args.xMax) / 2;
    const cy = typeof args.yMin === 'number' && typeof args.yMax === 'number' ? (args.yMin + args.yMax) / 2 : 0;
    return { x: cx, y: cy };
  }

  if (args.bounds && typeof args.bounds === 'object') {
    const b = args.bounds;
    if (typeof b.minX === 'number' && typeof b.maxX === 'number') {
      return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
    }
    if (typeof b.x === 'number' && typeof b.y === 'number') {
      return { x: b.x + (b.width ? b.width / 2 : 0), y: b.y + (b.height ? b.height / 2 : 0) };
    }
  }

  return null;
}
