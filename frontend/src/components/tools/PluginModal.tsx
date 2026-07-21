import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
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
import type { PluginManifest, PluginToolContribution } from '@/plugins/types';
import PluginIcon from '@/components/tools/PluginIcons';
import { calculateSummary, parseStatisticRows } from '@/plugins/builtin/statistics/generators';

const TAG_PLUGIN_ID = 'chalkboard.tag';
const STATISTICS_PLUGIN_ID = 'chalkboard.statistics';

interface DataGridRow {
  label: string;
  value: string;
}

const parseGridRows = (value: string | undefined): DataGridRow[] => {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) && parsed.length
      ? parsed.map((row) => ({ label: String(row?.label ?? ''), value: String(row?.value ?? '') }))
      : [{ label: '', value: '' }];
  } catch {
    return [{ label: '', value: '' }];
  }
};

const MatrixGridField: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const matrix = parseMatrixValues(value);
  const update = (next: string[][]) => onChange(JSON.stringify(next));
  const updateCell = (rowIndex: number, columnIndex: number, nextValue: string) => {
    const next = matrix.map((row) => [...row]);
    next[rowIndex][columnIndex] = nextValue;
    update(next);
  };

  return (
    <div className="matrix-grid-field">
      <div className="matrix-grid-toolbar">
        <span>{matrix.length} × {matrix[0]?.length ?? 0}</span>
        <div className="matrix-grid-actions">
          <button type="button" onClick={() => update([...matrix, Array.from({ length: matrix[0].length }, () => '')])}>+ Row</button>
          <button type="button" onClick={() => update(matrix.map((row) => [...row, '']))}>+ Column</button>
          <button type="button" disabled={matrix.length <= 1} onClick={() => update(matrix.slice(0, -1))}>− Row</button>
          <button type="button" disabled={(matrix[0]?.length ?? 1) <= 1} onClick={() => update(matrix.map((row) => row.slice(0, -1)))}>− Column</button>
        </div>
      </div>
      <div className="matrix-grid" style={{ gridTemplateColumns: `repeat(${matrix[0]?.length ?? 1}, minmax(0, 1fr))` }}>
        {matrix.flatMap((row, rowIndex) => row.map((cell, columnIndex) => (
          <input
            key={`${rowIndex}-${columnIndex}`}
            aria-label={`Matrix row ${rowIndex + 1}, column ${columnIndex + 1}`}
            value={cell}
            placeholder="0"
            onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)}
          />
        )))}
      </div>
    </div>
  );
};

const StatisticsPreview: React.FC<{ values: Record<string, string>; summaryOnly: boolean }> = ({ values, summaryOnly }) => {
  const rows = parseStatisticRows(values.dataset);
  const summary = calculateSummary(rows);
  const max = Math.max(1, ...rows.map((row) => Number(row.value)).filter(Number.isFinite));
  return (
    <div className="statistics-preview" aria-label="Statistics preview">
      {summaryOnly ? (
        <div className="statistics-summary-grid">
          <span>Count<strong>{summary.count}</strong></span>
          <span>Mean<strong>{summary.mean.toFixed(2)}</strong></span>
          <span>Median<strong>{summary.median.toFixed(2)}</strong></span>
          <span>Range<strong>{summary.range.toFixed(2)}</strong></span>
        </div>
      ) : (
        <div className="statistics-bars">
          {rows.slice(0, 10).map((row, index) => {
            const value = Number(row.value);
            const height = Number.isFinite(value) ? Math.max(8, Math.abs(value) / max * 86) : 4;
            return <div className="statistics-bar-item" key={`${row.label}-${index}`}><div className="statistics-bar" style={{ height }} /><small>{row.label || index + 1}</small></div>;
          })}
        </div>
      )}
    </div>
  );
};

const parseStringList = (value: string | undefined, fallback: string[]): string[] => {
  try {
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : fallback;
  } catch {
    return fallback;
  }
};

const SetBuilderField: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const tokens = parseStringList(value, ['{', 'x', '∈', 'ℝ', '|', 'x', '>', '2', '}']);
  const [draft, setDraft] = useState('');
  const palette = ['∈', '∉', '⊂', '⊆', '∪', '∩', 'ℕ', 'ℤ', 'ℚ', 'ℝ', 'ℂ', '{', '}', '|', '=', '>', '<', '≥', '≤', '∅'];
  const update = (next: string[]) => onChange(JSON.stringify(next));
  return (
    <div className="math-set-builder-field">
      <div className="math-set-builder-blocks" aria-label="Set-builder blocks">
        {tokens.map((token, index) => <button key={`${token}-${index}`} type="button" className="math-set-builder-block" title="Remove block" onClick={() => update(tokens.filter((_, tokenIndex) => tokenIndex !== index))}>{token}</button>)}
      </div>
      <div className="math-set-builder-palette" aria-label="Set-builder symbol palette">
        {palette.map((token) => <button key={token} type="button" onClick={() => update([...tokens, token])}>{token}</button>)}
      </div>
      <div className="math-set-builder-add">
        <input value={draft} placeholder="Add a value" aria-label="Add set-builder value" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && draft.trim()) { update([...tokens, draft.trim()]); setDraft(''); } }} />
        <button type="button" disabled={!draft.trim()} onClick={() => { update([...tokens, draft.trim()]); setDraft(''); }}>Add</button>
      </div>
    </div>
  );
};

const SetMembersField: React.FC<{ value: string; onChange: (value: string) => void }> = ({ value, onChange }) => {
  const members = parseStringList(value, ['1', '2', '3']);
  const [draft, setDraft] = useState('');
  const update = (next: string[]) => onChange(JSON.stringify(next));
  return (
    <div className="math-set-members-field">
      <div className="math-set-member-chips" aria-label="Set elements">
        {members.map((member, index) => <button key={`${member}-${index}`} type="button" title="Remove element" onClick={() => update(members.filter((_, memberIndex) => memberIndex !== index))}>{member}<span>×</span></button>)}
      </div>
      <div className="math-set-member-add">
        <input value={draft} placeholder="Add element" aria-label="Add set element" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && draft.trim()) { update([...members, draft.trim()]); setDraft(''); } }} />
        <button type="button" disabled={!draft.trim()} onClick={() => { update([...members, draft.trim()]); setDraft(''); }}>Add</button>
      </div>
    </div>
  );
};

const SetBuilderPreview: React.FC<{ values: Record<string, string> }> = ({ values }) => (
  <div className="math-set-expression-preview" aria-label="Set-builder preview">
    <strong>{values.setName || 'A'} =</strong>
    {parseStringList(values.setBuilder, ['{', 'x', '∈', 'ℝ', '|', 'x', '>', '2', '}']).map((token, index) => <span key={`${token}-${index}`}>{token}</span>)}
  </div>
);

const SetOperationPreview: React.FC<{ values: Record<string, string> }> = ({ values }) => (
  <div className="math-set-expression-preview" aria-label="Set operation preview">
    <strong>{values.leftSetName || 'A'}</strong>
    <span>({parseStringList(values.leftMembers, ['1', '2', '3']).join(', ')})</span>
    <b>{values.operation || '∪'}</b>
    <strong>{values.rightSetName || 'B'}</strong>
    <span>({parseStringList(values.rightMembers, ['3', '4', '5']).join(', ')})</span>
  </div>
);

interface PluginModalProps {
  plugin: PluginManifest;
  tools: PluginToolContribution[];
  selectedStrokes: Stroke[];
  selectionStrokeIds: string[];
  onClose: () => void;
  onRunPluginTool: (
    commandId: string,
    formValues: Record<string, string>,
    selectionStrokeIds: string[]
  ) => Promise<boolean> | boolean;
  sharedOutput?: string;
  onPublishOutput?: (value: string) => void;
}

interface TagPreviewProps {
  strokes: Stroke[];
  label: string;
  placement: 'top' | 'bottom';
}

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
    <div className="matrix-preview-grid" style={{ gridTemplateColumns: `repeat(${matrix[0]?.length ?? 1}, minmax(0, 1fr))` }}>
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

const MathToolPreview: React.FC<{ toolId: string; values: Record<string, string> }> = ({ toolId, values }) => (
  <div className="math-tool-preview" aria-label="Tool preview">
    {toolId.includes('matrix') ? <MatrixPreview values={values} /> : toolId.includes('coordinate-grid') ? <CoordinateGridPreview values={values} /> : toolId.includes('graph') ? <GraphPreview values={values} /> : toolId.includes('number-line') ? <NumberLinePreview values={values} /> : toolId.includes('two-set-venn') ? <svg viewBox="0 0 260 130"><circle cx="105" cy="65" r="42" /><circle cx="155" cy="65" r="42" /><text x="70" y="25">{values.leftSet || 'A'}</text><text x="175" y="25">{values.rightSet || 'B'}</text><text x="82" y="70">{values.leftValue || '1'}</text><text x="130" y="70">{values.intersectionValue || '2'}</text><text x="168" y="70">{values.rightValue || '3'}</text></svg> : toolId.includes('three-set-venn') ? <svg viewBox="0 0 260 150"><circle cx="105" cy="62" r="42" /><circle cx="155" cy="62" r="42" /><circle cx="130" cy="94" r="42" /><text x="70" y="20">{values.leftSet || 'A'}</text><text x="190" y="20">{values.rightSet || 'B'}</text><text x="130" y="145">{values.bottomSet || 'C'}</text><text x="82" y="62">{values.leftValue || '1'}</text><text x="178" y="62">{values.rightValue || '2'}</text><text x="130" y="116">{values.bottomValue || '3'}</text><text x="130" y="42">{values.leftRightValue || '4'}</text><text x="108" y="103">{values.leftBottomValue || '5'}</text><text x="152" y="103">{values.rightBottomValue || '6'}</text><text x="130" y="78">{values.centerValue || '7'}</text></svg> : <div className="math-tool-preview-generic">{values.title || values.symbol || 'Preview of inserted chalk object'}</div>}
  </div>
);

const TagPreview: React.FC<TagPreviewProps> = ({ strokes, label, placement }) => {
  const box = useMemo(() => getCombinedBoundingBox(strokes), [strokes]);

  if (!box) {
    return (
      <div className="tag-plugin-preview-empty">
        Select an object on the canvas to preview its tag.
      </div>
    );
  }

  const objectWidth = Math.max(1, box.maxX - box.minX);
  const objectHeight = Math.max(1, box.maxY - box.minY);
  const padding = Math.max(18, Math.min(36, Math.max(objectWidth, objectHeight) * 0.16));
  const tagGap = 16;
  const tagHeight = 20;
  const tagY = placement === 'top'
    ? box.minY - tagGap
    : box.maxY + tagGap + tagHeight;
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
            return (
              <text
                key={stroke.id}
                x={x}
                y={y}
                fill={stroke.color}
                fontSize={stroke.fontSize ?? 18}
              >
                {stroke.text}
              </text>
            );
          }

          if (stroke.points.length === 1) {
            const [point] = stroke.points;
            return <circle key={stroke.id} cx={point.x} cy={point.y} r={Math.max(2, stroke.size)} fill={stroke.color} />;
          }

          const points = stroke.points.map((point) => `${point.x},${point.y}`).join(' ');
          const fill = stroke.closed && stroke.fillColor && stroke.fillColor !== 'transparent'
            ? stroke.fillColor
            : 'none';
          const commonProps = {
            fill,
            stroke: stroke.color,
            strokeWidth: Math.max(2, stroke.size),
            strokeLinecap: 'round' as const,
            strokeLinejoin: 'round' as const,
          };

          return stroke.closed
            ? <polygon key={stroke.id} points={points} {...commonProps} />
            : <polyline key={stroke.id} points={points} {...commonProps} />;
        })}
        <text
          className="tag-plugin-preview-label"
          x={tagX}
          y={tagY}
          textAnchor="middle"
        >
          {label || 'Your tag'}
        </text>
      </svg>
    </div>
  );
};

const PluginModal: React.FC<PluginModalProps> = ({
  plugin,
  tools,
  selectedStrokes,
  selectionStrokeIds,
  onClose,
  onRunPluginTool,
  sharedOutput,
  onPublishOutput,
}) => {
  const clampPosition = useCallback((x: number, y: number) => ({
    x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - 432)),
    y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - 120)),
  }), []);

  const [position, setPosition] = useState(() => clampPosition(420, 120));
  const [dragStart, setDragStart] = useState<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
  const equationInputRef = useRef<HTMLInputElement | null>(null);
  const existingTag = selectedStrokes.find((stroke) => stroke.pluginId === TAG_PLUGIN_ID && stroke.text);
  const [formValues, setFormValues] = useState<Record<string, Record<string, string>>>(() => {
    if (existingTag && tools[0]) return { [tools[0].id]: { label: existingTag.text ?? '' } };
    const values: Record<string, Record<string, string>> = {};
    tools.forEach((tool) => {
      const texts = selectedStrokes.filter((stroke) => stroke.pluginId === plugin.id && stroke.text).map((stroke) => stroke.text as string);
      if (texts.length) values[tool.id] = Object.fromEntries((tool.formFields ?? []).map((field, index) => [field.id, texts[index] ?? field.defaultValue ?? '']));
    });
    return values;
  });
  const isTagPlugin = plugin.id === TAG_PLUGIN_ID;
  const isMathSetPlugin = plugin.id === 'chalkboard.math-set';
  const isStatisticsPlugin = plugin.id === STATISTICS_PLUGIN_ID;
  const [activeToolId, setActiveToolId] = useState<string | null>(isTagPlugin ? tools[0]?.id ?? null : null);

  const handleDragMove = useCallback((event: PointerEvent) => {
    if (!dragStart) return;
    setPosition(clampPosition(
      dragStart.x + event.clientX - dragStart.pointerX,
      dragStart.y + event.clientY - dragStart.pointerY
    ));
  }, [clampPosition, dragStart]);

  const handleDragEnd = useCallback(() => setDragStart(null), []);

  useEffect(() => {
    if (!dragStart) return;
    window.addEventListener('pointermove', handleDragMove);
    window.addEventListener('pointerup', handleDragEnd);
    return () => {
      window.removeEventListener('pointermove', handleDragMove);
      window.removeEventListener('pointerup', handleDragEnd);
    };
  }, [dragStart, handleDragEnd, handleDragMove]);

  const setToolFieldValue = (toolId: string, fieldId: string, value: string) => {
    setFormValues((previous) => ({
      ...previous,
      [toolId]: {
        ...(previous[toolId] ?? {}),
        [fieldId]: value,
      },
    }));
  };

  const insertEquationToken = (toolId: string, value: string, token: string) => {
    const input = equationInputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
    setToolFieldValue(toolId, 'equation', nextValue);
    requestAnimationFrame(() => {
      input?.focus();
      const caret = start + token.length;
      input?.setSelectionRange(caret, caret);
    });
  };

  const getToolFormValues = (tool: PluginToolContribution) => {
    const saved = formValues[tool.id] ?? {};
    return Object.fromEntries(
      (tool.formFields ?? []).map((field) => [
        field.id,
        saved[field.id] ?? field.defaultValue ?? '',
      ])
    );
  };

  const handleHeaderPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest('button')) return;
    setDragStart({ pointerX: event.clientX, pointerY: event.clientY, x: position.x, y: position.y });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleSubmit = async (tool: PluginToolContribution) => {
    await onRunPluginTool(tool.command, getToolFormValues(tool), selectionStrokeIds);
  };

  const applySharedOutputAsTag = (toolId: string) => {
    if (sharedOutput) setToolFieldValue(toolId, 'label', sharedOutput);
  };

  return (
    <div
      className={`plugin-floating-modal ${isTagPlugin ? 'tag-plugin-modal' : ''} ${isMathSetPlugin ? 'math-set-plugin-modal' : ''} ${isStatisticsPlugin ? 'statistics-plugin-modal' : ''}`}
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-modal="true"
      aria-label={`${plugin.name} plugin`}
    >
      <div className="plugin-floating-header" onPointerDown={handleHeaderPointerDown}>
        <span className="insert-plugin-logo">{plugin.logoUrl ? <img src={plugin.logoUrl} alt="" /> : <PluginIcon pluginId={plugin.id} fallback={plugin.name.slice(0, 1)} />}</span>
        <div>
          <strong>{plugin.name}</strong>
          <small>{plugin.description}</small>
        </div>
        <button className="insert-shapes-close" type="button" onClick={onClose} aria-label="Close plugin modal">
          <X size={14} />
        </button>
      </div>
      <div className="plugin-floating-body">
        {tools.length === 0 ? (
          <div className="tag-plugin-preview-empty">This plugin has no available tools.</div>
        ) : !activeToolId ? tools.map((tool) => (
          <button key={tool.id} type="button" className="plugin-tool-card plugin-tool-list-item" onClick={() => setActiveToolId(tool.id)}>
            <div className="plugin-tool-heading"><span>{tool.label}</span><small>Open tool</small></div>
            {tool.description && <p>{tool.description}</p>}
          </button>
        )) : tools.filter((candidate) => candidate.id === activeToolId).map((tool) => {
          const values = getToolFormValues(tool);
          const tagText = values.label ?? '';
          const placement = values.placement === 'top' ? 'top' : 'bottom';
          const isGraphTool = tool.id === 'math-set.graph';
          const isMatrixTool = tool.id === 'math-set.matrix';
          const hasStatisticValues = parseStatisticRows(values.dataset).some((row) => Number.isFinite(Number(row.value)));
          const matrixError = isMatrixTool ? validateMatrixRequest(values) : null;
          const canSubmit = isTagPlugin
            ? selectedStrokes.length > 0 && tagText.trim().length > 0
            : isMatrixTool
              ? !matrixError
              : !isStatisticsPlugin || hasStatisticValues;

          return (
            <div key={tool.id} className="plugin-tool-card">
              {!isTagPlugin && <button type="button" className="plugin-tool-back" onClick={() => setActiveToolId(null)}>← All tools</button>}
              <div className="plugin-tool-heading">
                <span>{tool.label}</span>
                <small>{isTagPlugin ? 'Selected object' : 'Plugin tool'}</small>
              </div>
              {tool.description && <p>{tool.description}</p>}

              {isTagPlugin && (
                <TagPreview strokes={selectedStrokes} label={tagText} placement={placement} />
              )}
              {isTagPlugin && sharedOutput && (
                <button type="button" className="plugin-shared-output" onClick={() => applySharedOutputAsTag(tool.id)}>
                  Use selected symbol <strong>{sharedOutput}</strong>
                </button>
              )}
              {!isTagPlugin && !isStatisticsPlugin && tool.id === 'math-set.set-builder' && <SetBuilderPreview values={values} />}
              {!isTagPlugin && !isStatisticsPlugin && tool.id === 'math-set.operation' && <SetOperationPreview values={values} />}
              {!isTagPlugin && !isStatisticsPlugin && tool.id !== 'math-set.set-builder' && tool.id !== 'math-set.operation' && <MathToolPreview toolId={tool.id} values={values} />}
              {isStatisticsPlugin && <StatisticsPreview values={values} summaryOnly={tool.command === 'statistics.insertSummary'} />}

              {(tool.formFields ?? []).map((field) => {
                const isMatrixOperationField = ['rowOperation', 'rowTarget', 'rowSource', 'factor'].includes(field.id);
                if (isMatrixTool && isMatrixOperationField && values.operation !== 'row-operation') return null;
                return (
                <label key={field.id} className="plugin-form-field">
                  <span>{field.label}</span>
                  {isTagPlugin && field.id === 'placement' ? (
                    <div className="tag-placement-options" role="group" aria-label="Tag placement">
                      {(field.options ?? []).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={values[field.id] === option.value ? 'tag-placement-option active' : 'tag-placement-option'}
                          onClick={() => setToolFieldValue(tool.id, field.id, option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : field.type === 'set-builder' ? (
                    <SetBuilderField value={values[field.id] ?? ''} onChange={(next) => setToolFieldValue(tool.id, field.id, next)} />
                  ) : field.type === 'set-members' ? (
                    <SetMembersField value={values[field.id] ?? ''} onChange={(next) => setToolFieldValue(tool.id, field.id, next)} />
                  ) : field.type === 'matrix-grid' ? (
                    <MatrixGridField value={values[field.id] ?? ''} onChange={(next) => setToolFieldValue(tool.id, field.id, next)} />
                  ) : field.type === 'data-grid' ? (
                    <div className="statistics-data-grid">
                      <div className="statistics-data-grid-head"><span>Label</span><span>Value</span><span aria-hidden="true" /></div>
                      {parseGridRows(values[field.id]).map((row, index, allRows) => (
                        <div className="statistics-data-grid-row" key={index}>
                          <input aria-label={`Row ${index + 1} label`} value={row.label} placeholder={`Item ${index + 1}`} onChange={(event) => {
                            const next = [...allRows];
                            next[index] = { ...next[index], label: event.target.value };
                            setToolFieldValue(tool.id, field.id, JSON.stringify(next));
                          }} />
                          <input aria-label={`Row ${index + 1} value`} type="number" value={row.value} placeholder="0" onChange={(event) => {
                            const next = [...allRows];
                            next[index] = { ...next[index], value: event.target.value };
                            setToolFieldValue(tool.id, field.id, JSON.stringify(next));
                          }} />
                          <button type="button" aria-label={`Remove row ${index + 1}`} disabled={allRows.length <= 1} onClick={() => setToolFieldValue(tool.id, field.id, JSON.stringify(allRows.filter((_, rowIndex) => rowIndex !== index)))}>×</button>
                        </div>
                      ))}
                      <button type="button" className="statistics-add-row" onClick={() => setToolFieldValue(tool.id, field.id, JSON.stringify([...parseGridRows(values[field.id]), { label: '', value: '' }]))}>+ Add row</button>
                    </div>
                  ) : field.type === 'symbol-grid' ? (
                    <div className="math-symbol-grid" role="group" aria-label="Set symbols">
                      {(field.options ?? []).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          className={values[field.id] === option.value ? 'math-symbol-option active' : 'math-symbol-option'}
                          aria-pressed={values[field.id] === option.value}
                          onClick={() => {
                            setToolFieldValue(tool.id, field.id, option.value);
                            onPublishOutput?.(option.value);
                          }}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  ) : field.type === 'select' ? (
                    <select
                      value={values[field.id] ?? ''}
                      onChange={(event) => setToolFieldValue(tool.id, field.id, event.target.value)}
                    >
                      {(field.options ?? []).map((option) => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      ref={isGraphTool && field.id === 'equation' ? equationInputRef : undefined}
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={values[field.id] ?? ''}
                      placeholder={field.placeholder}
                      autoFocus={isTagPlugin && field.id === 'label'}
                      onChange={(event) => setToolFieldValue(tool.id, field.id, event.target.value)}
                    />
                  )}
                  {isGraphTool && field.id === 'equation' && (
                    <div className="graph-equation-symbols" aria-label="Equation symbols">
                      {['²', '>=', '<=', 'sqrt()', 'π'].map((token) => (
                        <button key={token} type="button" onClick={() => insertEquationToken(tool.id, values[field.id] ?? '', token)}>{token}</button>
                      ))}
                    </div>
                  )}
                </label>
                );
              })}
              {matrixError && <div className="plugin-validation-error" role="alert">{matrixError}</div>}
              <button
                type="button"
                className="insert-links-add-btn"
                disabled={!canSubmit}
                onClick={() => void handleSubmit(tool)}
              >
                <Check size={14} />
                {isTagPlugin ? 'Add tag' : 'Add to canvas'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PluginModal;
