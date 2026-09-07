/**
 * @file index.ts
 * @description Barrel export for all Chalkboard WebMCP tools — single import point.
 * Classified into: canvas, selection, navigation, board, links, chat, room, config.
 * Plugins are human-only via UI — no discovery tools for agents.
 */

export * from './helpers';
export * from './canvas.tools';
export * from './selection.tools';
export * from './navigation.tools';
export * from './board.tools';
export * from './links.tools';
export * from './chat.tools';
export * from './room.tools';
export * from './config.tools';

import { drawChalkTool, writeTextTool, insertShapeTool, createNoteTool, highlightAreaTool } from './canvas.tools';
import { selectAndTransformTool, clipboardTool, trimTool } from './selection.tools';
import { navigateViewportTool, moveCursorTool, fullscreenTool } from './navigation.tools';
import { getBoardStateTool, clearOrUndoTool } from './board.tools';
import { manageTopicLinksTool } from './links.tools';
import { sendChatMessageTool, speakNarrationTool, sendReactionTool, toggleHandTool } from './chat.tools';
import { kickMemberTool, updateMemberRoleTool, closeRoomTool, voiceMembershipTool } from './room.tools';
import { configureToolTool } from './config.tools';
import type { WebMcpTool } from '../types';

/**
 * Returns all default Chalkboard WebMCP tools (23 classified tools, no plugins).
 */
export function getAllChalkboardTools(): WebMcpTool[] {
  return [
    getBoardStateTool,
    drawChalkTool,
    writeTextTool,
    insertShapeTool,
    createNoteTool,
    highlightAreaTool,
    selectAndTransformTool,
    navigateViewportTool,
    manageTopicLinksTool,
    sendChatMessageTool,
    speakNarrationTool,
    clearOrUndoTool,
    sendReactionTool,
    toggleHandTool,
    kickMemberTool,
    updateMemberRoleTool,
    closeRoomTool,
    voiceMembershipTool,
    configureToolTool,
    clipboardTool,
    trimTool,
    moveCursorTool,
    fullscreenTool,
  ];
}

/** All registered Chalkboard WebMCP tools */
export const ALL_CHALKBOARD_TOOLS: WebMcpTool[] = getAllChalkboardTools();
