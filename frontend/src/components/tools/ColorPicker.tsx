import React from 'react';

export interface ChalkColor {
  name: string;
  value: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export const CHALK_COLORS: ChalkColor[] = [
  { name: 'white', value: '#ffffff' },
  { name: 'black', value: '#1a1a1a' },
  { name: 'gray', value: '#a0a0a0' },
  { name: 'brown', value: '#8b4513' },
  { name: 'red', value: '#ff6b6b' },
  { name: 'green', value: '#4ade80' },
  { name: 'blue', value: '#60a5fa' },
  { name: 'yellow', value: '#facc15' },
  { name: 'pink', value: '#f472b6' },
  { name: 'purple', value: '#c084fc' },
];

interface ColorPickerProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select';
  activeColor: string;
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
  onColorChange: (color: string) => void;
}

const ColorPicker: React.FC<ColorPickerProps> = ({
  activeTool,
  activeColor,
  onToolChange,
  onColorChange,
}) => {
  return (
    <div className="color-picker-container">
      <input
        type="color"
        className="native-color-picker"
        value={activeColor}
        onChange={(e) => {
          onToolChange('chalk');
          onColorChange(e.target.value);
        }}
        title="Custom Color Picker"
      />
      <div className="swatch-grid">
        {CHALK_COLORS.map((color) => (
          <button
            key={color.name}
            type="button"
            className={`color-swatch ${activeTool === 'chalk' && activeColor.toLowerCase() === color.value.toLowerCase() ? 'active' : ''}`}
            style={{ backgroundColor: color.value }}
            title={`Chalk: ${color.name}`}
            onClick={() => {
              onToolChange('chalk');
              onColorChange(color.value);
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default ColorPicker;
