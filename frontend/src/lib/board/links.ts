// @ts-nocheck - split from boardCommands.ts, will be strict-cleaned incrementally
// Group: links
import { getBoard, type BoardState } from '@/stores/boardStore';
import { DEFAULT_ZOOM, MAX_ZOOM, MIN_ZOOM, viewportToCanvas } from '@/lib/zoom';
import { useLinksStore } from '@/stores/linksStore';
import { getCombinedBoundingBox, getSelectionBoundingBox } from '@/lib/geometry';
import { nestStrokeGroup, restorePreviousStrokeGroup } from '@/lib/grouping';
import { rotateStrokesTo, transformStrokes, clipStrokeToRect } from '@/lib/strokes';
import { generateShapeStrokes } from '@/utils/shapes';
import { emitStrokesImmediate } from '@/lib/sync';
import type { Socket } from 'socket.io-client';
import type { Stroke, ShapeType, Point, SavedLink } from '@/types';
import { CommandResult, requireSocket, requireSelection } from './common';

/**
 * Create a new link from the current selection tagged with `tag`.
 *
 * @param tag - Human-readable name for the link.
 * @returns `{ ok: true, data: SavedLink }` with the created link,
 *          or `{ ok: false, error }` if creation was skipped.
 *
 * @example
 * ```ts
 * createLink('Introduction');
 * ```
 */
export function createLink(tag: string): CommandResult<SavedLink> {
    const { selectedStrokeIds, socket, roomId } = getBoard();
    if (selectedStrokeIds.length === 0)
        return { ok: false, error: 'no selection' };

    const { links, setLinks } = useLinksStore.getState();

    // Check for duplicate tag
    const existing = links.find(
        (l) => l.tag.toLowerCase() === tag.toLowerCase()
    );
    if (existing) return { ok: false, error: `tag "${tag}" already exists` };

    // Check if any selected stroke is already linked
    const alreadyLinked = links.some((l) =>
        l.strokeIds.some((id) => selectedStrokeIds.includes(id))
    );
    if (alreadyLinked)
        return { ok: false, error: 'one or more selected strokes are already linked' };

    const newLink: SavedLink = {
        id: `link-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
        tag,
        strokeIds: [...selectedStrokeIds],
        userId: socket?.id || 'local',
    };

    const updated = [...links, newLink];
    setLinks(updated);
    socket?.emit('links-update', { roomId, links: updated });
    return { ok: true, data: newLink };
}

/**
 * Delete a saved link by its id.
 *
 * @param linkId - The id of the link to delete.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error: 'link not found' }` if the link doesn't exist.
 *
 * @example
 * ```ts
 * deleteLink('link-1234567890-abc');
 * ```
 */
export function deleteLink(linkId: string): CommandResult {
    const { links, setLinks } = useLinksStore.getState();
    const { socket, roomId } = getBoard();
    const updated = links.filter((l) => l.id !== linkId);
    if (updated.length === links.length)
        return { ok: false, error: 'link not found' };
    setLinks(updated);
    socket?.emit('links-update', { roomId, links: updated });
    return { ok: true };
}

/**
 * Rename an existing link.
 *
 * @param linkId - The id of the link to rename.
 * @param newTag - The new tag (name) for the link.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if the tag already exists or the link wasn't found.
 *
 * @example
 * ```ts
 * renameLink('link-1234567890-abc', 'Chapter 2');
 * ```
 */
export function renameLink(linkId: string, newTag: string): CommandResult {
    const { links, setLinks } = useLinksStore.getState();
    const { socket, roomId } = getBoard();

    // Check for duplicate tag (excluding the link being renamed)
    const existing = links.find(
        (l) => l.id !== linkId && l.tag.toLowerCase() === newTag.toLowerCase()
    );
    if (existing)
        return { ok: false, error: `tag "${newTag}" already exists` };

    const updated = links.map((l) =>
        l.id === linkId ? { ...l, tag: newTag } : l
    );
    const found = updated.some((l) => l.id === linkId);
    if (!found) return { ok: false, error: 'link not found' };

    setLinks(updated);
    socket?.emit('links-update', { roomId, links: updated });
    return { ok: true };
}

/**
 * Navigate the viewport to center on the strokes referenced by the given link id.
 *
 * @param linkId - The id of the link to focus on.
 * @returns `{ ok: true }` on success,
 *          `{ ok: false, error }` if the link or its strokes were not found.
 *
 * @example
 * ```ts
 * focusLink('link-1234567890-abc');
 * ```
 */
export function focusLink(linkId: string): CommandResult {
    const { links } = useLinksStore.getState();
    const link = links.find((l) => l.id === linkId);
    if (!link) return { ok: false, error: `link "${linkId}" not found` };

    const { strokes, zoom, canvas, setPanOffset, setShowInsertShapes, clearSelection } =
        getBoard();

    const linkedStrokes = strokes.filter((s) => link.strokeIds.includes(s.id));
    if (linkedStrokes.length === 0)
        return { ok: false, error: 'no strokes found for this link' };

    const box = getCombinedBoundingBox(linkedStrokes);
    if (!box) return { ok: false, error: 'no bounding box for linked strokes' };
    if (!canvas) return { ok: false, error: 'no canvas element available' };

    clearSelection();

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
    return { ok: true };
}

/**
 * Get all saved links from the Zustand links store.
 *
 * @returns `{ ok: true, data: SavedLink[] }`.
 *
 * @example
 * ```ts
 * const { data: links } = getLinks();
 * ```
 */
export function getLinks(): CommandResult<SavedLink[]> {
    return { ok: true, data: useLinksStore.getState().links };
}
