import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { Stroke } from '@/types';
import type { PluginManifest, PluginToolContribution } from '@/plugins/types';
import PluginIcon from '@/components/svg/PluginIcons';
import { MathToolPreview, TagPreview } from '@/components/svg/MathPreviews';
import { parseMatrixValues, validateMatrixRequest } from '@/plugins/builtin/mathSet/generators';
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
      <div className="matrix-grid" data-columns={matrix[0]?.length ?? 1}>
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
            return <div className="statistics-bar-item" key={`${row.label}-${index}`}><div className="statistics-bar" data-height={height} /><small>{row.label || index + 1}</small></div>;
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
  pluginReady?: boolean;
}

/*

                <span className="matrix-preview-arrow">→</span>

*/
const PluginModal: React.FC<PluginModalProps> = ({
  plugin,
  tools,
  selectedStrokes,
  selectionStrokeIds,
  onClose,
  onRunPluginTool,
  sharedOutput,
  onPublishOutput,
  pluginReady = true,
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
      data-left={position.x}
      data-top={position.y}
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
                disabled={!canSubmit || !pluginReady}
                onClick={() => void handleSubmit(tool)}
              >
                <Check size={14} />
                {!pluginReady ? 'Loading plugin…' : isTagPlugin ? 'Add tag' : 'Add to canvas'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default PluginModal;
