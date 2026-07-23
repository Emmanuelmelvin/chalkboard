import type { Stroke } from '@/types';

/**
 * Put a stroke in a new outer group while retaining any group it already
 * belongs to. The first path entry is restored when the outer group is
 * ungrouped.
 */
export function nestStrokeGroup(stroke: Stroke, groupId: string): Stroke {
  const groupPath = stroke.groupId
    ? [stroke.groupId, ...(stroke.groupPath ?? [])]
    : stroke.groupPath;

  return {
    ...stroke,
    groupId,
    groupPath: groupPath && groupPath.length > 0 ? groupPath : undefined,
  };
}

/** Remove the current outer group and restore the next group in the path. */
export function restorePreviousStrokeGroup(stroke: Stroke): Stroke {
  const [groupId, ...groupPath] = stroke.groupPath ?? [];

  return {
    ...stroke,
    groupId,
    groupPath: groupPath.length > 0 ? groupPath : undefined,
  };
}
