import React from 'react';
import type { ShapeType } from '@/types';
import { ColorPicker as AstryxColorPicker, CHALK_COLORS, type ChalkColor } from '@/components/ui/ColorPicker';

export { CHALK_COLORS };
export type { ChalkColor };

interface ColorPickerProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select' | ShapeType;
  activeColor: string;
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
  onColorChange: (color: string) => void;
}

export const ColorPicker: React.FC<ColorPickerProps> = ({
  onToolChange,
  activeColor,
  onColorChange,
}) => {
  return (
    <AstryxColorPicker
      value={activeColor}
      onChange={(color) => {
        onToolChange('chalk');
        onColorChange(color);
      }}
      showInput={true}
      showSwatches={true}
    />
  );
};

export default ColorPicker;
