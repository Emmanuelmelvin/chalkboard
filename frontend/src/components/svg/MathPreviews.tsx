import React, { useMemo } from 'react';
import { getCombinedBoundingBox } from '@/lib/geometry';
import {
  calculateMatrixDeterminant,
  evaluateGraphExpression,
  formatMatrixNumber,
  getGraphRange,
  getMatrixRowOperationResult,
  getNumberLineDomain,
  parseMatrixValues,
  parseNumericMatrix,
  parseCoordinatePoints,
  parseGraphEquation,
  parseNumberLineExpression,
  validateMatrixRequest,
} from '@/plugins/builtin/mathSet/generators';
import type { Stroke } from '@/types';

const NumberLinePreview: React.FC<{ values: Record<string, string> }> = ({ values }) => {
  const equation = values.equation || 'x >= 0';
  const endpoints = parseNumberLineExpression(equation).sort((a, b) => a.value - b.value);
  const { min, max, tickCount } = getNumberLineDomain(endpoints);
  const span = Math.max(1, max - min);
  const xFor = (value: number) => 18 + ((value - min) / span) * 224;
  const lower = endpoints[0];
  const upper = endpoints[endpoints.length - 1];
  const between = endpoints.length > 1 && lower.direction === 'right' && upper.direction === 'left';
  const outside = endpoints.length > 1 && lower.direction === 'left' && upper.direction === 'right';
  const solutionSegments = between
    ? [[xFor(lower.value) + 7, xFor(upper.value) - 7]]
    : outside
      ? [[18, xFor(lower.value) - 7], [xFor(upper.value) + 7, 242]]
      : endpoints.flatMap((endpoint) => endpoint.direction === 'right'
        ? [[xFor(endpoint.value) + 7, 242]]
        : endpoint.direction === 'left' ? [[18, xFor(endpoint.value) - 7]] : []);

  return (
    <div className="number-line-preview" aria-label="Number line preview">
      <svg viewBox="0 0 260 140" role="img">
        <line x1="18" y1="55" x2="242" y2="55" stroke="#cbd5e1" strokeWidth="2" />
        <path d="M18 55l8-5v10zM242 55l-8-5v10z" fill="#cbd5e1" />
        {Array.from({ length: tickCount + 1 }, (_, index) => {
          const x = 18 + (224 * index) / tickCount;
          const value = min + ((max - min) * index) / tickCount;
          return <g key={index}><line x1={x} y1="47" x2={x} y2="63" stroke="#cbd5e1" strokeWidth="1.5" /><text x={x} y="82" textAnchor="middle" fill="#cbd5e1" fontSize="9">{Number.isInteger(value) ? value : value.toFixed(1)}</text></g>;
        })}
        {solutionSegments.map(([start, end], index) => <line key={`solution-${index}`} x1={start} y1="55" x2={end} y2="55" stroke="#60a5fa" strokeWidth="4" strokeLinecap="round" />)}
        {endpoints.map((endpoint, index) => <g key={`endpoint-${index}`}><circle cx={xFor(endpoint.value)} cy="55" r="6" fill={endpoint.inclusive ? '#60a5fa' : '#0f172a'} stroke="#93c5fd" strokeWidth="2" /><text x={xFor(endpoint.value)} y="101" textAnchor="middle" fill="#93c5fd" fontSize="10">{endpoint.value}</text></g>)}
        <text x="130" y="126" textAnchor="middle" fill="#f8fafc" fontSize="12">{equation}</text>
      </svg>
    </div>
  );
};

const GraphPreview: React.FC<{ values: Record<string, string> }> = ({ values }) => {
  const equation = values.equation || 'y = x^2';
  const graph = parseGraphEquation(equation);
  const range = getGraphRange(values);
  const left = 20;
  const right = 240;
  const top = 16;
  const bottom = 112;
  const mapX = (x: number) => left + ((x - range.xMin) / (range.xMax - range.xMin)) * (right - left);
  const mapY = (y: number) => bottom - ((y - range.yMin) / (range.yMax - range.yMin)) * (bottom - top);
  const points: string[] = [];
  if (graph) {
    for (let index = 0; index <= 160; index++) {
      const x = range.xMin + ((range.xMax - range.xMin) * index) / 160;
      const y = evaluateGraphExpression(graph.expression, x);
      if (!Number.isFinite(y)) continue;
      points.push(`${mapX(x)},${mapY(y)}`);
    }
  }
  const path = points.join(' ');
  const xAxis = range.xMin <= 0 && range.xMax >= 0 ? mapX(0) : left;
  const yAxis = range.yMin <= 0 && range.yMax >= 0 ? mapY(0) : bottom;
  const fillPath = graph && graph.relation !== '=' && points.length > 1
    ? `${path} ${mapX(range.xMax)},${graph.relation === '>' || graph.relation === '>=' ? top : bottom} ${mapX(range.xMin)},${graph.relation === '>' || graph.relation === '>=' ? top : bottom} Z`
    : '';

  return (
    <div className="graph-preview" aria-label="Graph preview">
      <svg viewBox="0 0 260 140" role="img">
        {Array.from({ length: 11 }, (_, index) => {
          const x = left + ((right - left) * index) / 10;
          const y = top + ((bottom - top) * index) / 10;
          return <g key={index}><line x1={x} y1={top} x2={x} y2={bottom} stroke="#334155" strokeWidth="0.7" /><line x1={left} y1={y} x2={right} y2={y} stroke="#334155" strokeWidth="0.7" /></g>;
        })}
        <line x1={xAxis} y1={top} x2={xAxis} y2={bottom} stroke="#cbd5e1" strokeWidth="1.5" />
        <line x1={left} y1={yAxis} x2={right} y2={yAxis} stroke="#cbd5e1" strokeWidth="1.5" />
        {fillPath && <path d={fillPath} fill="rgba(96,165,250,.18)" stroke="none" />}
        {path && <polyline points={path} fill="none" stroke="#60a5fa" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" />}
        <text x="130" y="132" textAnchor="middle" fill="#f8fafc" fontSize="12">{equation}</text>
      </svg>
    </div>
  );
};

const CoordinateGridPreview: React.FC<{ values: Record<string, string> }> = ({ values }) => {
  const range = getGraphRange(values);
  const stepValue = Number(values.gridStep);
  const step = Number.isFinite(stepValue) && stepValue > 0 ? stepValue : 1;
  const left = 20;
  const right = 240;
  const top = 16;
  const bottom = 112;
  const xCount = Math.min(30, Math.ceil((range.xMax - range.xMin) / step));
  const yCount = Math.min(30, Math.ceil((range.yMax - range.yMin) / step));
  const mapX = (value: number) => left + ((value - range.xMin) / (range.xMax - range.xMin)) * (right - left);
  const mapY = (value: number) => bottom - ((value - range.yMin) / (range.yMax - range.yMin)) * (bottom - top);
  const xAxis = range.xMin <= 0 && range.xMax >= 0 ? mapX(0) : left;
  const yAxis = range.yMin <= 0 && range.yMax >= 0 ? mapY(0) : bottom;
  const major = (value: number) => value !== 0 && Math.abs(value % 5) < 0.0001;
  const points = parseCoordinatePoints(values.points).filter((point) => point.x >= range.xMin && point.x <= range.xMax && point.y >= range.yMin && point.y <= range.yMax);

  return (
    <div className="coordinate-grid-preview" aria-label="Coordinate grid preview">
      <svg viewBox="0 0 260 140" role="img">
        {Array.from({ length: xCount + 1 }, (_, index) => {
          const value = range.xMin + ((range.xMax - range.xMin) * index) / xCount;
          const x = mapX(value);
          return <g key={`x-${index}`}><line x1={x} y1={top} x2={x} y2={bottom} stroke={major(value) ? '#64748b' : '#334155'} strokeOpacity={major(value) ? 0.45 : 0.22} strokeWidth="0.6" />{major(value) && <text x={x} y={yAxis + 13} textAnchor="middle" fill="#cbd5e1" fontSize="8">{Number(value.toFixed(1))}</text>}</g>;
        })}
        {Array.from({ length: yCount + 1 }, (_, index) => {
          const value = range.yMin + ((range.yMax - range.yMin) * index) / yCount;
          const y = mapY(value);
          return <g key={`y-${index}`}><line x1={left} y1={y} x2={right} y2={y} stroke={major(value) ? '#64748b' : '#334155'} strokeOpacity={major(value) ? 0.45 : 0.22} strokeWidth="0.6" />{major(value) && <text x={xAxis + 5} y={y + 3} fill="#cbd5e1" fontSize="8">{Number(value.toFixed(1))}</text>}</g>;
        })}
        {range.yMin <= 0 && range.yMax >= 0 && <line x1={left} y1={yAxis} x2={right} y2={yAxis} stroke="#f8fafc" strokeWidth="1.8" />}
        {range.xMin <= 0 && range.xMax >= 0 && <line x1={xAxis} y1={top} x2={xAxis} y2={bottom} stroke="#f8fafc" strokeWidth="1.8" />}
        {points.map((point, index) => <g key={`point-${index}`}><circle cx={mapX(point.x)} cy={mapY(point.y)} r="4.5" fill="#60a5fa" stroke="#dbeafe" strokeWidth="1.2" /><text x={mapX(point.x) + 7} y={mapY(point.y) - 6} fill="#f8fafc" fontSize="8">({point.x}, {point.y})</text></g>)}
        <text x="250" y={yAxis - 4} textAnchor="end" fill="#f8fafc" fontSize="10">{values.xAxis || 'x'}</text>
        <text x={xAxis + 5} y="13" fill="#f8fafc" fontSize="10">{values.yAxis || 'y'}</text>
      </svg>
    </div>
  );
};

const MatrixPreviewMatrix: React.FC<{ matrix: string[][]; label?: string; determinant?: boolean }> = ({ matrix, label, determinant = false }) => (
  <div className="matrix-preview-matrix">
    {label && <span className="matrix-preview-label">{label} =</span>}
    <span className="matrix-preview-delimiter">{determinant ? '|' : '['}</span>
    <div className="matrix-preview-grid" data-columns={matrix[0]?.length ?? 1}>
      {matrix.flatMap((row, rowIndex) => row.map((value, columnIndex) => <span key={`${rowIndex}-${columnIndex}`}>{value || '0'}</span>))}
    </div>
    <span className="matrix-preview-delimiter">{determinant ? '|' : ']'}</span>
  </div>
);

const MatrixPreview: React.FC<{ values: Record<string, string> }> = ({ values }) => {
  const matrix = parseMatrixValues(values.matrixValues).map((row) => row.map((value) => value.trim() || '0'));
  const mode = values.operation === 'determinant' || values.operation === 'row-operation' ? values.operation : 'display';
  const error = validateMatrixRequest(values);
  const numeric = parseNumericMatrix(matrix);
  const rowResult = mode === 'row-operation' ? getMatrixRowOperationResult(values) : null;
  const label = values.matrixLabel?.trim() || '';

  return (
    <div className="matrix-preview" aria-label="Matrix preview">
      {error ? <div className="matrix-preview-error">{error}</div> : (
        <>
          <div className="matrix-preview-layout">
            <MatrixPreviewMatrix matrix={matrix} label={label || undefined} determinant={mode === 'determinant'} />
            {mode === 'row-operation' && rowResult && (
              <>
                <span className="matrix-preview-arrow">→</span>
                <MatrixPreviewMatrix matrix={rowResult.matrix.map((row) => row.map(formatMatrixNumber))} label={label ? `${label}'` : undefined} />
              </>
            )}
          </div>
          {mode === 'determinant' && numeric && (
            <strong className="matrix-preview-result">{label ? `det(${label})` : 'det'} = {formatMatrixNumber(calculateMatrixDeterminant(numeric) ?? 0)}</strong>
          )}
          {mode === 'row-operation' && rowResult && <small className="matrix-preview-operation">{rowResult.description}</small>}
        </>
      )}
    </div>
  );
};

export const MathToolPreview: React.FC<{ toolId: string; values: Record<string, string> }> = ({ toolId, values }) => (
  <div className="math-tool-preview" aria-label="Tool preview">
    {toolId.includes('matrix') ? <MatrixPreview values={values} /> : toolId.includes('coordinate-grid') ? <CoordinateGridPreview values={values} /> : toolId.includes('graph') ? <GraphPreview values={values} /> : toolId.includes('number-line') ? <NumberLinePreview values={values} /> : toolId.includes('two-set-venn') ? <svg viewBox="0 0 260 130"><circle cx="105" cy="65" r="42" /><circle cx="155" cy="65" r="42" /><text x="70" y="25">{values.leftSet || 'A'}</text><text x="175" y="25">{values.rightSet || 'B'}</text><text x="82" y="70">{values.leftValue || '1'}</text><text x="130" y="70">{values.intersectionValue || '2'}</text><text x="168" y="70">{values.rightValue || '3'}</text></svg> : toolId.includes('three-set-venn') ? <svg viewBox="0 0 260 150"><circle cx="105" cy="62" r="42" /><circle cx="155" cy="62" r="42" /><circle cx="130" cy="94" r="42" /><text x="70" y="20">{values.leftSet || 'A'}</text><text x="190" y="20">{values.rightSet || 'B'}</text><text x="130" y="145">{values.bottomSet || 'C'}</text><text x="82" y="62">{values.leftValue || '1'}</text><text x="178" y="62">{values.rightValue || '2'}</text><text x="130" y="116">{values.bottomValue || '3'}</text><text x="130" y="42">{values.leftRightValue || '4'}</text><text x="108" y="103">{values.leftBottomValue || '5'}</text><text x="152" y="103">{values.rightBottomValue || '6'}</text><text x="130" y="78">{values.centerValue || '7'}</text></svg> : <div className="math-tool-preview-generic">{values.title || values.symbol || 'Preview of inserted chalk object'}</div>}
  </div>
);

interface TagPreviewProps {
  strokes: Stroke[];
  label: string;
  placement: 'top' | 'bottom';
}

export const TagPreview: React.FC<TagPreviewProps> = ({ strokes, label, placement }) => {
  const box = useMemo(() => getCombinedBoundingBox(strokes), [strokes]);

  if (!box) {
    return <div className="tag-plugin-preview-empty">Select an object on the canvas to preview its tag.</div>;
  }

  const objectWidth = Math.max(1, box.maxX - box.minX);
  const objectHeight = Math.max(1, box.maxY - box.minY);
  const padding = Math.max(18, Math.min(36, Math.max(objectWidth, objectHeight) * 0.16));
  const tagGap = 16;
  const tagHeight = 20;
  const tagY = placement === 'top' ? box.minY - tagGap : box.maxY + tagGap + tagHeight;
  const minY = Math.min(box.minY - padding, tagY - tagHeight - padding / 2);
  const maxY = Math.max(box.maxY + padding, tagY + padding / 2);
  const minX = box.minX - padding;
  const maxX = box.maxX + padding;
  const viewWidth = Math.max(120, maxX - minX);
  const viewHeight = Math.max(100, maxY - minY);
  const tagX = (box.minX + box.maxX) / 2;

  return (
    <div className="tag-plugin-preview" aria-label="Selected object and tag preview">
      <svg viewBox={`${minX} ${minY} ${viewWidth} ${viewHeight}`} role="img">
        {strokes.map((stroke) => {
          if (stroke.text) {
            const x = Math.min(...stroke.points.map((point) => point.x));
            const y = Math.min(...stroke.points.map((point) => point.y));
            return <text key={stroke.id} x={x} y={y} fill={stroke.color} fontSize={stroke.fontSize ?? 18}>{stroke.text}</text>;
          }
          if (stroke.points.length === 1) {
            const [point] = stroke.points;
            return <circle key={stroke.id} cx={point.x} cy={point.y} r={Math.max(2, stroke.size)} fill={stroke.color} />;
          }
          const points = stroke.points.map((point) => `${point.x},${point.y}`).join(' ');
          const fill = stroke.closed && stroke.fillColor && stroke.fillColor !== 'transparent' ? stroke.fillColor : 'none';
          const commonProps = { fill, stroke: stroke.color, strokeWidth: Math.max(2, stroke.size), strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
          return stroke.closed ? <polygon key={stroke.id} points={points} {...commonProps} /> : <polyline key={stroke.id} points={points} {...commonProps} />;
        })}
        <text className="tag-plugin-preview-label" x={tagX} y={tagY} textAnchor="middle">{label || 'Your tag'}</text>
      </svg>
    </div>
  );
};
