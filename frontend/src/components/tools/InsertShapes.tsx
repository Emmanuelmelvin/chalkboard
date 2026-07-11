import React from 'react';
import {
  Square,
  Circle,
  Triangle,
  Minus,
  ArrowRight,
  Hexagon,
  Star,
  Diamond,
  X,
} from 'lucide-react';

export type ShapeType = 'rectangle' | 'circle' | 'triangle' | 'line' | 'arrow' | 'hexagon' | 'star' | 'diamond';

interface InsertShapesProps {
  onInsertShape: (shape: ShapeType) => void;
  onClose: () => void;
}

const shapes: { type: ShapeType; label: string; icon: React.ReactNode }[] = [
  { type: 'rectangle', label: 'Rectangle', icon: <Square size={20} /> },
  { type: 'circle', label: 'Circle', icon: <Circle size={20} /> },
  { type: 'triangle', label: 'Triangle', icon: <Triangle size={20} /> },
  { type: 'line', label: 'Line', icon: <Minus size={20} /> },
  { type: 'arrow', label: 'Arrow', icon: <ArrowRight size={20} /> },
  { type: 'hexagon', label: 'Hexagon', icon: <Hexagon size={20} /> },
  { type: 'star', label: 'Star', icon: <Star size={20} /> },
  { type: 'diamond', label: 'Diamond', icon: <Diamond size={20} /> },
];

const InsertShapes: React.FC<InsertShapesProps> = ({ onInsertShape, onClose }) => {
  return (
    <div className="insert-shapes-overlay" onClick={onClose}>
      <div className="insert-shapes-panel" onClick={(e) => e.stopPropagation()}>
        <div className="insert-shapes-header">
          <h3>Insert Shape</h3>
          <button className="insert-shapes-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="insert-shapes-grid">
          {shapes.map((s) => (
            <button
              key={s.type}
              className="insert-shape-btn"
              onClick={() => onInsertShape(s.type)}
              title={s.label}
            >
              {s.icon}
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default InsertShapes;