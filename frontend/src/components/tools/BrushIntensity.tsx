import React from 'react';

interface BrushIntensityProps {
  brushIntensity: number;
  onIntensityChange: (intensity: number) => void;
}

const BrushIntensity: React.FC<BrushIntensityProps> = ({ brushIntensity, onIntensityChange }) => {
  const intensities = [
    { label: 'light', val: 0.35 },
    { label: 'medium', val: 0.60 },
    { label: 'heavy', val: 0.85 },
  ];

  return (
    <div className="brush-controls">
      {intensities.map((i) => (
        <button
          key={i.label}
          type="button"
          className={`size-dot-btn ${brushIntensity === i.val ? 'active' : ''}`}
          title={`Intensity: ${i.label}`}
          onClick={() => onIntensityChange(i.val)}
        >
          <div
            className="size-dot"
            style={{ width: '12px', height: '12px', backgroundColor: 'currentColor', opacity: i.val }}
          />
        </button>
      ))}
    </div>
  );
};

export default BrushIntensity;
