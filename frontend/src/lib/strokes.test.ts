import { describe, it, expect } from 'vitest';
import { transformStrokes, rotateStrokesTo, clipStrokeToRect } from './strokes';
import type { Stroke } from '@/types';

const mk = (points: {x:number;y:number}[]): Stroke => ({ id: 's1', userId:'u1', tool:'chalk', color:'#fff', size:5, points } as Stroke);

describe('strokes', () => {
  it('transformStrokes scales', () => {
    const s = mk([{x:0,y:0},{x:10,y:10}]);
    const from = {minX:0,minY:0,maxX:10,maxY:10};
    const to = {minX:0,minY:0,maxX:20,maxY:20};
    const out = transformStrokes([s], from, to);
    expect(out[0].points[1].x).toBe(20);
    expect(out[0].points[1].y).toBe(20);
  });
  it('rotateStrokesTo', () => {
    const s = mk([{x:0,y:0},{x:10,y:0}]);
    const out = rotateStrokesTo([s], 90);
    expect(out[0].rotation).toBe(90);
  });
  it('clipStrokeToRect keeps inside', () => {
    const s = mk([{x:0,y:0},{x:10,y:10},{x:20,y:0}]);
    const out = clipStrokeToRect(s, {minX:0,minY:0,maxX:15,maxY:15});
    expect(out.length).toBeGreaterThan(0);
  });
});
