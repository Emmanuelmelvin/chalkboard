import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeCanvasBounds, analyzeCanvasLayout, formatSpatialLayoutPrompt } from '../src/agent/canvasLayout.js';
import type { Stroke } from '../src/types/index.js';

describe('Spatial Canvas Layout Engine', () => {
  it('should return null bounds for empty strokes array', () => {
    assert.equal(computeCanvasBounds([]), null);
    const layout = analyzeCanvasLayout([]);
    assert.equal(layout.bounds, null);
    assert.deepEqual(layout.suggestedOriginBelow, { x: 0, y: 0 });
  });

  it('should compute accurate bounding box across multiple strokes', () => {
    const strokes: Stroke[] = [
      {
        id: 's1',
        userId: 'u1',
        tool: 'chalk',
        color: '#fff',
        size: 2,
        points: [
          { x: -50, y: 20 },
          { x: 100, y: 80 },
        ],
      },
      {
        id: 's2',
        userId: 'u1',
        tool: 'chalk',
        color: '#fff',
        size: 2,
        points: [
          { x: 0, y: -10 },
          { x: 250, y: 150 },
        ],
      },
    ];

    const bounds = computeCanvasBounds(strokes);
    assert.ok(bounds !== null);
    assert.equal(bounds.minX, -50);
    assert.equal(bounds.minY, -10);
    assert.equal(bounds.maxX, 250);
    assert.equal(bounds.maxY, 150);

    const analysis = analyzeCanvasLayout(strokes);
    assert.ok(analysis.bounds !== null);
    // Suggested placement below should have y > maxY
    assert.ok(analysis.suggestedOriginBelow.y > 150);
    // Suggested placement right should have x > maxX
    assert.ok(analysis.suggestedOriginRight.x > 250);
  });

  it('should generate informative layout prompt', () => {
    const emptyPrompt = formatSpatialLayoutPrompt([]);
    assert.ok(emptyPrompt.includes('Clean/Empty board'));

    const strokes: Stroke[] = [
      {
        id: 's1',
        userId: 'u1',
        tool: 'chalk',
        color: '#fff',
        size: 2,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 50 },
        ],
      },
    ];

    const activePrompt = formatSpatialLayoutPrompt(strokes);
    assert.ok(activePrompt.includes('Active Board Geometry'));
    assert.ok(activePrompt.includes('Recommended Clean Origin'));
  });
});
