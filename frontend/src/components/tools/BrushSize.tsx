import React from 'react';

interface BrushSizeProps {
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
}

const BrushSize: React.FC<BrushSizeProps> = ({ brushSize, onBrushSizeChange }) => {
  return (
    <div className="slider-container">
      <input
        type="range"
        className="slider-input"
        min="1"
        max="100"
        value={brushSize}
        onChange={(e) => onBrushSizeChange(parseInt(e.target.value, 10))}
      />
      <input
        type="number"
        className="number-input"
        min="1"
        max="100"
        value={brushSize}
        onChange={(e) => {
          let val = parseInt(e.target.value, 10);
          if (isNaN(val)) val = 1;
          if (val > 100) val = 100;
          if (val < 1) val = 1;
          onBrushSizeChange(val);
        }}
      />
    </div>
  );
};

export default BrushSize;
