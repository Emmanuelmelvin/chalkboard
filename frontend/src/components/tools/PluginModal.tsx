import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { getCombinedBoundingBox } from '@/lib/geometry';
import { getNumberLineDomain, parseNumberLineExpression } from '@/plugins/builtin/mathSet/generators';
import type { Stroke } from '@/types';
import type { PluginManifest, PluginToolContribution } from '@/plugins/types';

const TAG_PLUGIN_ID = 'chalkboard.tag';

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

const MathToolPreview: React.FC<{ toolId: string; values: Record<string, string> }> = ({ toolId, values }) => (
  <div className="math-tool-preview" aria-label="Tool preview">
    {toolId.includes('number-line') ? <NumberLinePreview values={values} /> : toolId.includes('two-set-venn') ? <svg viewBox="0 0 260 130"><circle cx="105" cy="65" r="42" /><circle cx="155" cy="65" r="42" /><text x="70" y="25">{values.leftSet || 'A'}</text><text x="175" y="25">{values.rightSet || 'B'}</text><text x="82" y="70">{values.leftValue || '1'}</text><text x="130" y="70">{values.intersectionValue || '2'}</text><text x="168" y="70">{values.rightValue || '3'}</text></svg> : toolId.includes('three-set-venn') ? <svg viewBox="0 0 260 150"><circle cx="105" cy="62" r="42" /><circle cx="155" cy="62" r="42" /><circle cx="130" cy="94" r="42" /><text x="70" y="20">{values.leftSet || 'A'}</text><text x="190" y="20">{values.rightSet || 'B'}</text><text x="130" y="145">{values.bottomSet || 'C'}</text><text x="82" y="62">{values.leftValue || '1'}</text><text x="178" y="62">{values.rightValue || '2'}</text><text x="130" y="116">{values.bottomValue || '3'}</text><text x="130" y="42">{values.leftRightValue || '4'}</text><text x="108" y="103">{values.leftBottomValue || '5'}</text><text x="152" y="103">{values.rightBottomValue || '6'}</text><text x="130" y="78">{values.centerValue || '7'}</text></svg> : <div className="math-tool-preview-generic">{values.title || values.symbol || 'Preview of inserted chalk object'}</div>}
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
}) => {
  const [position, setPosition] = useState({ x: 420, y: 120 });
  const [dragStart, setDragStart] = useState<{ pointerX: number; pointerY: number; x: number; y: number } | null>(null);
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
  const [activeToolId, setActiveToolId] = useState<string | null>(isTagPlugin ? tools[0]?.id ?? null : null);

  const clampPosition = useCallback((x: number, y: number) => ({
    x: Math.min(Math.max(12, x), Math.max(12, window.innerWidth - 432)),
    y: Math.min(Math.max(12, y), Math.max(12, window.innerHeight - 120)),
  }), []);

  useEffect(() => {
    setPosition(clampPosition(420, 120));
  }, [clampPosition]);

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
    const didRun = await onRunPluginTool(tool.command, getToolFormValues(tool), selectionStrokeIds);
    if (didRun) onClose();
  };

  return (
    <div
      className={`plugin-floating-modal ${isTagPlugin ? 'tag-plugin-modal' : ''} ${plugin.id === 'chalkboard.math-set' ? 'math-set-plugin-modal' : ''}`}
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-modal="true"
      aria-label={`${plugin.name} plugin`}
    >
      <div className="plugin-floating-header" onPointerDown={handleHeaderPointerDown}>
        <span className="insert-plugin-logo">{plugin.name.slice(0, 1)}</span>
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
          const canSubmit = !isTagPlugin || (selectedStrokes.length > 0 && tagText.trim().length > 0);

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
              {!isTagPlugin && <MathToolPreview toolId={tool.id} values={values} />}

              {(tool.formFields ?? []).map((field) => (
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
                      type={field.type === 'number' ? 'number' : 'text'}
                      value={values[field.id] ?? ''}
                      placeholder={field.placeholder}
                      autoFocus={isTagPlugin && field.id === 'label'}
                      onChange={(event) => setToolFieldValue(tool.id, field.id, event.target.value)}
                    />
                  )}
                </label>
              ))}
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
