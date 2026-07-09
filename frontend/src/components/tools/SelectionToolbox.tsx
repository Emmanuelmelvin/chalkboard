import React from 'react';
import { Trash2, X } from 'lucide-react';
import ColorPicker from './ColorPicker';
import Card from '../ui/Card';

interface SelectionToolboxProps {
  x: number;
  y: number;
  activeColor: string;
  onColorChange: (color: string) => void;
  onDelete: () => void;
  onDeselect: () => void;
}

const SelectionToolbox: React.FC<SelectionToolboxProps> = ({
  x,
  y,
  activeColor,
  onColorChange,
  onDelete,
  onDeselect,
}) => {
  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        transform: 'translateX(-50%)',
        zIndex: 1000,
        pointerEvents: 'auto',
      }}
    >
      <Card
        style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          gap: '12px',
          padding: '8px 16px',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '12px', color: '#cbd5e1' }}>Change Color</span>
          <div className="toolbar-row">
            <ColorPicker
              activeTool="chalk"
              activeColor={activeColor}
              onToolChange={() => {}}
              onColorChange={onColorChange}
            />
          </div>
        </div>

        <div
          style={{
            width: '1px',
            height: '40px',
            background: 'rgba(255,255,255,0.1)',
            margin: '0 8px',
          }}
        />

        <button
          className="action-stick"
          title="Delete Selection"
          onClick={onDelete}
          style={{ width: '40px', height: '40px' }}
        >
          <Trash2 size={16} color="#ef4444" />
        </button>

        <button
          className="action-stick"
          title="Deselect"
          onClick={onDeselect}
          style={{ width: '40px', height: '40px' }}
        >
          <X size={16} />
        </button>
      </Card>
    </div>
  );
};

export default SelectionToolbox;
