import React from 'react';
import type { ShapeType } from '@/types';
import { HoverCard } from '@/components/ui/HoverCard';

export interface ChalkColor {
  name: string;
  value: string;
}

export const CHALK_COLORS: ChalkColor[] = [
  { name: 'white', value: '#ffffff' },
  { name: 'yellow', value: '#fef08a' },
  { name: 'blue', value: '#93c5fd' },
  { name: 'pink', value: '#f472b6' },
  { name: 'green', value: '#86efac' },
  { name: 'orange', value: '#fdba74' },
];

interface ColorPickerProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select' | ShapeType;
  activeColor: string;
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
  onColorChange: (color: string) => void;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  activeTool,
  activeColor,
  onToolChange,
  onColorChange,
}) => {
  return (
    <div className="color-picker-container">
      <HoverCard content="Custom Color Picker" placement="top" sideOffset={8}>
        <input
          type="color"
          className="native-color-picker"
          value={activeColor}
          onChange={(e) => {
            onToolChange('chalk');
            onColorChange(e.target.value);
          }}
          aria-label="Custom Color Picker"
        />
      </HoverCard>
      <div className="swatch-grid">
        {CHALK_COLORS.map((color) => (
          <HoverCard key={color.name} content={`Chalk: ${color.name}`} placement="top" sideOffset={8}>
            <button
              type="button"
              className={`color-swatch color-swatch-${color.name} ${activeTool === 'chalk' && activeColor.toLowerCase() === color.value.toLowerCase() ? 'active' : ''}`}
              aria-label={`Chalk: ${color.name}`}
              onClick={() => {
                onToolChange('chalk');
                onColorChange(color.value);
              }}
            />
          </HoverCard>
        ))}
      </div>
    </div>
  );
};

export default ColorPicker;
