import React from 'react';

interface BrushSizeProps {
  brushSize: number;
  onBrushSizeChange: (size: number) => void;
}

const BrushSize: React.FC<BrushSizeProps> = ({ brushSize, onBrushSizeChange }) => {
  const sizes = [
    { label: 'small', val: 3, dotSize: '6px' },
    { label: 'medium', val: 8, dotSize: '12px' },
    { label: 'large', val: 18, dotSize: '18px' },
  ];

  return (
    <div className="brush-controls">
      {sizes.map((s) => (
        <button
          key={s.label}
          type="button"
          className={`size-dot-btn ${brushSize === s.val ? 'active' : ''}`}
          title={`Size: ${s.label}`}
          onClick={() => onBrushSizeChange(s.val)}
        >
          <div
            className="size-dot"
            style={{ width: s.dotSize, height: s.dotSize }}
          />
        </button>
      ))}
    </div>
  );
};

export default BrushSize;
