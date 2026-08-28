import React from 'react';
import { Slider } from '@/components/ui/Slider';

interface BrushIntensityProps {
  brushIntensity: number; // 0.01 to 1.0
  onIntensityChange: (intensity: number) => void;
}

const BrushIntensity: React.FC<BrushIntensityProps> = ({ brushIntensity, onIntensityChange }) => {
  // Convert 0.01-1.0 to 1-100 for the slider
  const displayValue = Math.round(brushIntensity * 100);

  const handleChange = (val: number) => {
    onIntensityChange(val / 100);
  };

  return (
    <Slider
      value={displayValue}
      onChange={handleChange}
      min={1}
      max={100}
      step={1}
      showInput={true}
      aria-label="Brush Intensity"
    />
  );
};

export default BrushIntensity;
