/**
 * @file resources.ts
 * @description Exposes live classroom resources via WebMCP (e.g. board state snapshot, topic links, lesson notes).
 */

import { getBoardState, getLinks } from '@/lib/boardCommands';
import type { WebMcpResource } from './types';

export const classroomStateResource: WebMcpResource = {
  uri: 'chalkboard://classroom/state',
  name: 'Live Classroom Board State',
  description: 'Current real-time snapshot of the chalkboard canvas including all strokes, viewport position, and active room configuration.',
  mimeType: 'application/json',
  read: () => {
    const { data: state } = getBoardState();
    const { data: links } = getLinks();
    const payload = {
      roomId: state?.roomId ?? 'local',
      viewport: {
        panOffset: state?.panOffset ?? { x: 0, y: 0 },
        zoom: state?.zoom ?? 0.7,
      },
      activeTool: state?.activeTool ?? 'chalk',
      activeColor: state?.activeColor ?? '#ffffff',
      strokesCount: state?.strokes.length ?? 0,
      selectedCount: state?.selectedStrokeIds.length ?? 0,
      linksCount: links?.length ?? 0,
      strokesSummary: (state?.strokes || []).slice(-30).map((s) => ({
        id: s.id,
        tool: s.tool,
        color: s.color,
        text: s.text,
        objectType: s.objectType,
        pointCount: s.points.length,
      })),
      topicLinks: links || [],
    };

    return {
      contents: [
        {
          uri: 'chalkboard://classroom/state',
          mimeType: 'application/json',
          text: JSON.stringify(payload, null, 2),
        },
      ],
    };
  },
};

export const topicLinksResource: WebMcpResource = {
  uri: 'chalkboard://classroom/topic-links',
  name: 'Classroom Topic Links & Bookmarks',
  description: 'Saved topic bookmarks organizing the lesson into navigable sections on the infinite canvas.',
  mimeType: 'application/json',
  read: () => {
    const { data: links } = getLinks();
    return {
      contents: [
        {
          uri: 'chalkboard://classroom/topic-links',
          mimeType: 'application/json',
          text: JSON.stringify(links || [], null, 2),
        },
      ],
    };
  },
};

export const boardSummaryResource: WebMcpResource = {
  uri: 'chalkboard://classroom/summary',
  name: 'Chalkboard Visual Markdown Summary',
  description: 'A markdown overview of the titles, notes, and diagrams currently visible on the board.',
  mimeType: 'text/markdown',
  read: () => {
    const { data: state } = getBoardState();
    const { data: links } = getLinks();
    const strokes = state?.strokes || [];

    const textStrokes = strokes.filter((s) => s.text).map((s) => `- **Text**: "${s.text}" (at x:${s.points[0]?.x}, y:${s.points[0]?.y})`);
    const noteStrokes = strokes.filter((s) => s.noteHtml).map((s) => `- **Note**: ${s.noteHtml?.replace(/<[^>]*>?/gm, '')}`);
    const shapeStrokes = strokes.filter((s) => s.objectType).map((s) => `- **Shape**: ${s.objectType}`);

    const markdown = `# Classroom Board Summary (Room: ${state?.roomId || 'Local'})

- **Total Elements**: ${strokes.length}
- **Current Zoom**: ${Math.round((state?.zoom || 0.7) * 100)}%
- **Topic Bookmarks**: ${(links || []).map((l) => `[${l.tag}]`).join(', ') || 'None'}

## Board Contents:
${textStrokes.length > 0 ? textStrokes.join('\n') : '_No text labels yet._'}
${noteStrokes.length > 0 ? '\n' + noteStrokes.join('\n') : ''}
${shapeStrokes.length > 0 ? '\n' + shapeStrokes.join('\n') : ''}
`;

    return {
      contents: [
        {
          uri: 'chalkboard://classroom/summary',
          mimeType: 'text/markdown',
          text: markdown,
        },
      ],
    };
  },
};

/** All registered Chalkboard WebMCP resources */
export const ALL_CHALKBOARD_RESOURCES: WebMcpResource[] = [
  classroomStateResource,
  topicLinksResource,
  boardSummaryResource,
];
