/**
 * @file links.ts
 * @description Link management tools for creating, deleting, renaming, and
 * navigating to saved canvas links.
 *
 * Agent-callable entry points. Links are persisted in the Zustand links store
 * and synced via socket events for multiplayer.
 */

import { getCombinedBoundingBox } from '@/utils/drawing';
import { getBoard } from '@/stores/boardStore';
import { useLinksStore } from '@/stores/linksStore';
import type { SavedLink } from '@/types';

/**
 * Create a new link from the current selection tagged with `tag`.
 *
 * If the tag already exists, or any selected stroke is already linked, the
 * operation is silently skipped.
 *
 * @param tag - Human-readable name for the link.
 * @returns The newly created link, or `undefined` if creation was skipped.
 *
 * @example
 * ```ts
 * import { handleCreateLink } from '@/components/toolbox';
 * handleCreateLink('Introduction');
 * ```
 */
export function handleCreateLink(tag: string): SavedLink | undefined {
  const { selectedStrokeIds, socket, roomId } = getBoard();
  if (selectedStrokeIds.length === 0) return undefined;

  const { links, setLinks } = useLinksStore.getState();

  // Check for duplicate tag
  const existing = links.find(
    (l) => l.tag.toLowerCase() === tag.toLowerCase()
  );
  if (existing) return undefined;

  // Check if any selected stroke is already linked
  const alreadyLinked = links.some((l) =>
    l.strokeIds.some((id) => selectedStrokeIds.includes(id))
  );
  if (alreadyLinked) return undefined;

  const newLink: SavedLink = {
    id: `link-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
    tag,
    strokeIds: [...selectedStrokeIds],
    userId: socket?.id || 'local',
  };

  const updated = [...links, newLink];
  setLinks(updated);
  socket?.emit('links-update', { roomId, links: updated });
  return newLink;
}

/**
 * Delete a saved link by its id.
 *
 * @param linkId - The id of the link to delete.
 * @returns `true` if the link was found and deleted.
 *
 * @example
 * ```ts
 * import { handleDeleteLink } from '@/components/toolbox';
 * handleDeleteLink('link-1234567890-abc');
 * ```
 */
export function handleDeleteLink(linkId: string): boolean {
  const { links, setLinks } = useLinksStore.getState();
  const { socket, roomId } = getBoard();
  const updated = links.filter((l) => l.id !== linkId);
  if (updated.length === links.length) return false; // not found
  setLinks(updated);
  socket?.emit('links-update', { roomId, links: updated });
  return true;
}

/**
 * Rename an existing link.
 *
 * @param linkId - The id of the link to rename.
 * @param newTag - The new tag (name) for the link.
 * @returns `true` if the rename succeeded, `false` if the tag already exists
 *          or the link wasn't found.
 *
 * @example
 * ```ts
 * import { handleRenameLink } from '@/components/toolbox';
 * handleRenameLink('link-1234567890-abc', 'Chapter 2');
 * ```
 */
export function handleRenameLink(linkId: string, newTag: string): boolean {
  const { links, setLinks } = useLinksStore.getState();
  const { socket, roomId } = getBoard();

  // Check for duplicate tag (excluding the link being renamed)
  const existing = links.find(
    (l) => l.id !== linkId && l.tag.toLowerCase() === newTag.toLowerCase()
  );
  if (existing) return false;

  const updated = links.map((l) =>
    l.id === linkId ? { ...l, tag: newTag } : l
  );
  setLinks(updated);
  socket?.emit('links-update', { roomId, links: updated });
  return true;
}

/**
 * Navigate the viewport to center on the strokes referenced by the given link.
 *
 * @param link - The saved link to navigate to.
 * @returns `true` if navigation occurred.
 *
 * @example
 * ```ts
 * import { handleNavigateToLink } from '@/components/toolbox';
 * // Get a link from the store, then:
 * handleNavigateToLink(link);
 * ```
 */
export function handleNavigateToLink(link: SavedLink): boolean {
  const { strokes, zoom, canvas, setPanOffset, setShowInsertShapes } =
    getBoard();

  const linkedStrokes = strokes.filter((s) => link.strokeIds.includes(s.id));
  if (linkedStrokes.length === 0) return false;

  const box = getCombinedBoundingBox(linkedStrokes);
  if (!box) return false;
  if (!canvas) return false;

  const rect = canvas.getBoundingClientRect();
  const targetCenterX = (box.minX + box.maxX) / 2;
  const targetCenterY = (box.minY + box.maxY) / 2;

  setPanOffset({
    x: rect.width / 2 - targetCenterX * zoom,
    y: rect.height / 2 - targetCenterY * zoom,
  });
  setShowInsertShapes(false);

  // Update URL without triggering navigation
  const url = new URL(window.location.href);
  url.searchParams.set('link', link.id);
  window.history.pushState({}, '', url.toString());
  return true;
}

/**
 * Open the InsertShapes modal on the Links tab so the user can manage links.
 * This is a UI-only action and does not modify board state.
 *
 * @example
 * ```ts
 * import { handleOpenLinksTab } from '@/components/toolbox';
 * handleOpenLinksTab();
 * ```
 */
export function handleOpenLinksTab(): void {
  const { setInsertShapesTab, setShowInsertShapes } = getBoard();
  setInsertShapesTab('links');
  setShowInsertShapes(true);
}

/**
 * Get all saved links from the Zustand links store.
 */
export function getLinks(): SavedLink[] {
  return useLinksStore.getState().links;
}
