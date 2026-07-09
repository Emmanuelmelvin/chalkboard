import React from 'react';
import { Undo2, Redo2, Trash2 } from 'lucide-react';

export interface ChalkColor {
  name: string;
  value: string;
  className: string;
}

export const CHALK_COLORS: ChalkColor[] = [
  { name: 'white', value: '#ffffff', className: 'color-white' },
  { name: 'yellow', value: '#fff3a1', className: 'color-yellow' },
  { name: 'blue', value: '#a3e5ff', className: 'color-blue' },
  { name: 'pink', value: '#ffa3d1', className: 'color-pink' },
  { name: 'green', value: '#a3ffd6', className: 'color-green' },
];

interface ToolbarProps {
  activeTool: 'chalk' | 'eraser';
  activeColor: string;
  brushSize: number;
  onToolChange: (tool: 'chalk' | 'eraser') => void;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  activeColor,
  brushSize,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}) => {
  const sizes = [
    { label: 'small', val: 3, dotSize: '6px' },
    { label: 'medium', val: 8, dotSize: '12px' },
    { label: 'large', val: 18, dotSize: '18px' },
  ];

  return (
    <div className="chalk-ledge-container">
      <div className="chalk-ledge">
        {/* Chalk Sticks */}
        {CHALK_COLORS.map((color) => (
          <button
            key={color.name}
            type="button"
            className={`chalk-stick ${color.className} ${
              activeTool === 'chalk' && activeColor === color.value ? 'active' : ''
            }`}
            style={{ color: color.value }}
            title={`Chalk: ${color.name}`}
            onClick={() => {
              onToolChange('chalk');
              onColorChange(color.value);
            }}
          >
            <span>{color.name}</span>
          </button>
        ))}

        <div className="ledge-divider" />

        {/* Felt Eraser */}
        <button
          type="button"
          className={`felt-eraser ${activeTool === 'eraser' ? 'active' : ''}`}
          title="Felt Eraser"
          onClick={() => onToolChange('eraser')}
        >
          <span>ERASER</span>
        </button>

        <div className="ledge-divider" />

        {/* Brush Size Selector */}
        <div className="brush-controls">
          {sizes.map((s) => (
            <button
              key={s.label}
              type="button"
              className={`size-dot-btn ${brushSize === s.val ? 'active' : ''}`}
              title={`Size: ${s.label}`}
              onClick={() => onBrushSizeChange(s.val)}
            >
              <div
                className="size-dot"
                style={{ width: s.dotSize, height: s.dotSize }}
              />
            </button>
          ))}
        </div>

        <div className="ledge-divider" />

        {/* Action Sticks (Undo, Redo, Clear) */}
        <button
          type="button"
          className="action-stick"
          title="Undo Action"
          onClick={onUndo}
          disabled={!canUndo}
          style={{ opacity: canUndo ? 1 : 0.4, cursor: canUndo ? 'pointer' : 'not-allowed' }}
        >
          <Undo2 size={16} />
          <span>Undo</span>
        </button>

        <button
          type="button"
          className="action-stick"
          title="Redo Action"
          onClick={onRedo}
          disabled={!canRedo}
          style={{ opacity: canRedo ? 1 : 0.4, cursor: canRedo ? 'pointer' : 'not-allowed' }}
        >
          <Redo2 size={16} />
          <span>Redo</span>
        </button>

        <button
          type="button"
          className="action-stick"
          title="Clear Blackboard"
          onClick={() => {
            if (window.confirm('Are you sure you want to clear the entire blackboard?')) {
              onClear();
            }
          }}
        >
          <Trash2 size={16} />
          <span>Clear</span>
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
