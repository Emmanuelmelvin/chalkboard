import React, { useState, useRef, useEffect } from 'react';
import { Trash2, X, Plus, Minus, Copy, SquareStack, Scissors, ChevronDown } from 'lucide-react';
import ColorPicker from './ColorPicker';
import Card from '../ui/Card';

interface SelectionToolboxProps {
  x: number;
  y: number;
  activeColor: string;
  onColorChange: (color: string) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onIncreaseSize: () => void;
  onDecreaseSize: () => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onCut: () => void;
}

const SelectionToolbox: React.FC<SelectionToolboxProps> = ({
  x,
  y,
  activeColor,
  onColorChange,
  onDelete,
  onDeselect,
  onIncreaseSize,
  onDecreaseSize,
  onCopy,
  onDuplicate,
  onCut,
}) => {
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
          position: 'relative',
        }}
      >
        {/* Color Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Color</span>
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
            height: '32px',
            background: 'rgba(255,255,255,0.08)',
            margin: '0 4px',
          }}
        />

        {/* Size Section */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Size</span>
          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              type="button"
              className="action-stick"
              title="Decrease Size ([)"
              onClick={onDecreaseSize}
              style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Minus size={12} />
            </button>
            <button
              type="button"
              className="action-stick"
              title="Increase Size (])"
              onClick={onIncreaseSize}
              style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              <Plus size={12} />
            </button>
          </div>
        </div>

        <div
          style={{
            width: '1px',
            height: '32px',
            background: 'rgba(255,255,255,0.08)',
            margin: '0 4px',
          }}
        />

        {/* Actions Dropdown Trigger */}
        <div ref={dropdownRef} style={{ position: 'relative' }}>
          <button
            type="button"
            className={`action-stick-btn ${showDropdown ? 'active' : ''}`}
            onClick={() => setShowDropdown(!showDropdown)}
            style={{
              padding: '0 10px',
              height: '28px',
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '6px',
              background: showDropdown ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.08)',
              borderRadius: '6px',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            <span style={{ fontSize: '12px', color: '#e2e8f0' }}>Actions</span>
            <ChevronDown size={12} color="#e2e8f0" style={{ transform: showDropdown ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>

          {/* Floating Dropdown Menu */}
          {showDropdown && (
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(15, 23, 42, 0.95)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: '8px',
                padding: '6px',
                display: 'flex',
                flexDirection: 'column',
                gap: '2px',
                minWidth: '160px',
                boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)',
                zIndex: 1001,
              }}
            >
              {/* Copy */}
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onCopy();
                  setShowDropdown(false);
                }}
                style={dropdownItemStyle}
              >
                <Copy size={13} />
                <span>Copy</span>
                <kbd style={kbdStyle}>Ctrl+C</kbd>
              </button>

              {/* Duplicate */}
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onDuplicate();
                  setShowDropdown(false);
                }}
                style={dropdownItemStyle}
              >
                <SquareStack size={13} />
                <span>Duplicate</span>
                <kbd style={kbdStyle}>Ctrl+D</kbd>
              </button>

              {/* Cut */}
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onCut();
                  setShowDropdown(false);
                }}
                style={dropdownItemStyle}
              >
                <Scissors size={13} />
                <span>Cut</span>
                <kbd style={kbdStyle}>Ctrl+X</kbd>
              </button>

              <div style={{ height: '1px', background: 'rgba(255,255,255,0.06)', margin: '4px 0' }} />

              {/* Delete */}
              <button
                type="button"
                className="dropdown-item"
                onClick={() => {
                  onDelete();
                  setShowDropdown(false);
                }}
                style={{ ...dropdownItemStyle, color: '#f87171' }}
              >
                <Trash2 size={13} />
                <span>Delete</span>
                <kbd style={kbdStyle}>Del</kbd>
              </button>
            </div>
          )}
        </div>

        <div
          style={{
            width: '1px',
            height: '32px',
            background: 'rgba(255,255,255,0.08)',
            margin: '0 4px',
          }}
        />

        {/* Deselect Button */}
        <button
          type="button"
          className="action-stick"
          title="Deselect"
          onClick={onDeselect}
          style={{ width: '28px', height: '28px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <X size={14} />
        </button>
      </Card>
    </div>
  );
};

const dropdownItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  padding: '6px 10px',
  background: 'none',
  border: 'none',
  color: '#e2e8f0',
  fontSize: '12px',
  textAlign: 'left',
  borderRadius: '4px',
  cursor: 'pointer',
  transition: 'background 0.15s ease',
  outline: 'none',
};

const kbdStyle: React.CSSProperties = {
  marginLeft: 'auto',
  fontSize: '9px',
  background: 'rgba(255,255,255,0.06)',
  padding: '2px 4px',
  borderRadius: '3px',
  color: '#94a3b8',
  border: '1px solid rgba(255,255,255,0.04)',
};

export default SelectionToolbox;
