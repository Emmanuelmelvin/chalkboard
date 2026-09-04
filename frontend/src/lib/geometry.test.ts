import { describe, it, expect } from 'vitest';
import { boxCenter, intersectRects, getStrokeBoundingBox, rectsIntersect, getCombinedBoundingBox, rotatePoint } from './geometry';
import type { Stroke } from '@/types';

const mkStroke = (points: {x:number;y:number}[], extra?: Partial<Stroke>): Stroke => ({
  id: 's1', userId: 'u1', tool: 'chalk', color: '#fff', size: 5, points, ...extra
} as Stroke);

describe('geometry', () => {
  it('boxCenter', () => {
    expect(boxCenter({minX:0,minY:0,maxX:10,maxY:20})).toEqual({x:5,y:10});
  });
  it('intersectRects', () => {
    expect(intersectRects({minX:0,minY:0,maxX:10,maxY:10},{minX:5,minY:5,maxX:15,maxY:15})).toEqual({minX:5,minY:5,maxX:10,maxY:10});
    expect(intersectRects({minX:0,minY:0,maxX:1,maxY:1},{minX:2,minY:2,maxX:3,maxY:3})).toBeNull();
  });
  it('getStrokeBoundingBox chalk', () => {
    const s = mkStroke([{x:0,y:0},{x:10,y:10}]);
    const b = getStrokeBoundingBox(s)!;
    expect(b.minX).toBe(-5); // padding size
    expect(b.maxX).toBe(15);
  });
  it('getStrokeBoundingBox text', () => {
    const s = mkStroke([{x:0,y:0},{x:100,y:0}], {text:'hello', fontSize: 20});
    const b = getStrokeBoundingBox(s)!;
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxY).toBeGreaterThan(b.minY);
  });
  it('rectsIntersect', () => {
    expect(rectsIntersect({minX:0,minY:0,maxX:10,maxY:10},{minX:5,minY:5,maxX:15,maxY:15})).toBe(true);
    expect(rectsIntersect({minX:0,minY:0,maxX:1,maxY:1},{minX:2,minY:2,maxX:3,maxY:3})).toBe(false);
  });
  it('getCombinedBoundingBox', () => {
    const a = mkStroke([{x:0,y:0}]);
    const b = mkStroke([{x:10,y:10}]);
    const c = getCombinedBoundingBox([a,b])!;
    expect(c.minX).toBeLessThan(c.maxX);
  });
  it('rotatePoint 90deg', () => {
    const p = rotatePoint({x:1,y:0},{x:0,y:0},90);
    expect(p.x).toBeCloseTo(0,1);
    expect(p.y).toBeCloseTo(1,1);
  });
});
