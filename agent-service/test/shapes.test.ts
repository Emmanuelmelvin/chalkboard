import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateShapeStrokes, ShapeType } from '../src/tools/shapes.js';

describe('Shape Generator Engine', () => {
  const allShapes: ShapeType[] = [
    'triangle',
    'square',
    'rectangle',
    'pentagon',
    'hexagon',
    'heptagon',
    'octagon',
    'nonagon',
    'decagon',
    'circle',
    'star',
    'diamond',
    'line',
    'arrow',
    'cross',
    'heart',
  ];

  it('should generate valid strokes for all 16 supported shapes', () => {
    for (const shape of allShapes) {
      const strokes = generateShapeStrokes({
        shape,
        cx: 100,
        cy: 150,
        radius: 60,
        color: '#38bdf8',
        size: 4,
      });

      assert.ok(strokes.length > 0, `Shape ${shape} should produce at least one stroke`);
      for (const s of strokes) {
        assert.equal(s.tool, 'chalk');
        assert.equal(s.color, '#38bdf8');
        assert.equal(s.size, 4);
        assert.ok(Array.isArray(s.points) && s.points.length >= 2, `Shape ${shape} stroke must have at least 2 points`);
        for (const pt of s.points) {
          assert.equal(typeof pt.x, 'number');
          assert.equal(typeof pt.y, 'number');
          assert.ok(!Number.isNaN(pt.x), 'Point X must be a valid number');
          assert.ok(!Number.isNaN(pt.y), 'Point Y must be a valid number');
        }
      }
    }
  });

  it('should generate closed paths for closed polygons and loops', () => {
    const closedShapes: ShapeType[] = ['triangle', 'square', 'circle', 'star', 'heart', 'cross'];
    for (const shape of closedShapes) {
      const strokes = generateShapeStrokes({ shape, cx: 0, cy: 0 });
      assert.equal(strokes[0].closed, true, `Shape ${shape} should be marked as closed`);
    }
  });

  it('arrow should generate both shaft and head components', () => {
    const strokes = generateShapeStrokes({ shape: 'arrow', cx: 200, cy: 300, radius: 50 });
    assert.equal(strokes.length, 2, 'Arrow should produce shaft and head strokes');
    assert.ok(strokes[0].id.includes('shaft'));
    assert.ok(strokes[1].id.includes('head'));
  });

  it('should fallback to circle when an unknown shape is requested', () => {
    const strokes = generateShapeStrokes({ shape: 'rhomboid_xyz' as any, cx: 50, cy: 50 });
    assert.ok(strokes.length > 0);
    assert.equal(strokes[0].points.length, 36);
  });
});
