import React from 'react';
import { Slider } from '@/components/ui/Slider';

interface BrushSizeProps {
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
}

const BrushSize: React.FC<BrushSizeProps> = ({ brushSize, onBrushSizeChange }) => {
  return (
    <Slider
      value={brushSize}
      onChange={onBrushSizeChange}
      min={1}
      max={100}
      step={1}
      showInput={true}
      aria-label="Brush Size"
    />
  );
};

export default BrushSize;
