import React from 'react';

interface BrushIntensityProps {
  brushIntensity: number; // 0.01 to 1.0
  onIntensityChange: (intensity: number) => void;
}

const BrushIntensity: React.FC<BrushIntensityProps> = ({ brushIntensity, onIntensityChange }) => {
  // Convert 0.01-1.0 to 1-100 for the slider
  const displayValue = Math.round(brushIntensity * 100);

  const handleChange = (val: number) => {
    if (isNaN(val)) val = 1;
    if (val > 100) val = 100;
    if (val < 1) val = 1;
    // Convert back to 0.01-1.0
    onIntensityChange(val / 100);
  };

  return (
    <div className="slider-container">
      <input
        type="range"
        className="slider-input"
        min="1"
        max="100"
        value={displayValue}
        onChange={(e) => handleChange(parseInt(e.target.value, 10))}
      />
      <input
        type="number"
        className="number-input"
        min="1"
        max="100"
        value={displayValue}
        onChange={(e) => handleChange(parseInt(e.target.value, 10))}
      />
    </div>
  );
};

export default BrushIntensity;
