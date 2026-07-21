import { focusDotManifest } from '@/plugins/builtin/focusDot/manifest';
import type { ChalkboardPlugin } from '@/plugins/types';

export const focusDotPlugin: ChalkboardPlugin = {
  id: focusDotManifest.id,
  name: focusDotManifest.name,
  version: focusDotManifest.version,
  manifest: focusDotManifest,

  activate(api) {
    api.commands.register('focusDot.add', () => {
      const center = api.board.getViewportCenter();
      if (!center) return false;

      const radius = 18;
      const points = Array.from({ length: 32 }, (_, index) => {
        const angle = (index / 32) * Math.PI * 2;
        return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
      });

      return api.board.insertStrokes([{
        id: `${api.board.getUserId()}-focus-dot-${Date.now()}`,
        userId: api.board.getUserId(),
        tool: 'chalk',
        color: '#e0bf78',
        size: 4,
        intensity: 0.95,
        pathType: 'linear',
        closed: true,
        fillColor: 'rgba(224, 191, 120, 0.16)',
        points,
        pluginId: focusDotManifest.id,
      }], { select: true, closeInsertPanel: true, pluginId: focusDotManifest.id });
    });
  },
};
