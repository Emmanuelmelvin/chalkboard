/**
 * @file links.tools.ts
 * @description Topic bookmark link management tools.
 */

import { createLink, deleteLink, renameLink, focusLink, getLinks } from '@/lib/boardCommands';
import type { WebMcpTool } from '../types';
import { textResult, jsonResult } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// MANAGE TOPIC LINKS (LESSON BOOKMARKS)
// ─────────────────────────────────────────────────────────────────────────────
export const manageTopicLinksTool: WebMcpTool<{
  action: 'create' | 'delete' | 'rename' | 'focus' | 'list';
  tag?: string;
  linkId?: string;
  newTag?: string;
}> = {
  name: 'chalkboard_manage_topic_links',
  description:
    'Creates, lists, renames, deletes, or navigates to saved topic bookmark links (e.g. "Chapter 1: Theory", "Problem 2: Proof").',
  inputSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['create', 'delete', 'rename', 'focus', 'list'],
        description: 'Topic link operation.',
      },
      tag: { type: 'string', description: 'Name/tag for the created link (required when creating from active selection).' },
      linkId: { type: 'string', description: 'ID of the target link for focus/rename/delete.' },
      newTag: { type: 'string', description: 'New name when renaming.' },
    },
    required: ['action'],
  },
  handler: ({ action, tag, linkId, newTag }) => {
    switch (action) {
      case 'list': {
        const { data: links } = getLinks();
        return jsonResult({ success: true, links: links || [] });
      }
      case 'create': {
        if (!tag) return textResult('create action requires "tag"', true);
        const res = createLink(tag);
        if (!res.ok) return textResult(`Create link failed: ${res.error}`, true);
        return jsonResult({ success: true, link: res.data });
      }
      case 'focus': {
        if (!linkId) return textResult('focus action requires "linkId"', true);
        const res = focusLink(linkId);
        if (!res.ok) return textResult(`Focus link failed: ${res.error}`, true);
        return jsonResult({ success: true, focusedLinkId: linkId });
      }
      case 'rename': {
        if (!linkId || !newTag) return textResult('rename action requires "linkId" and "newTag"', true);
        const res = renameLink(linkId, newTag);
        if (!res.ok) return textResult(`Rename link failed: ${res.error}`, true);
        return jsonResult({ success: true, renamedLinkId: linkId, newTag });
      }
      case 'delete': {
        if (!linkId) return textResult('delete action requires "linkId"', true);
        const res = deleteLink(linkId);
        if (!res.ok) return textResult(`Delete link failed: ${res.error}`, true);
        return jsonResult({ success: true, deletedLinkId: linkId });
      }
      default:
        return textResult(`Unknown topic link action: ${action}`, true);
    }
  },
};
