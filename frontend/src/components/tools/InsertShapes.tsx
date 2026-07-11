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
  Pentagon,
  RectangleHorizontal,
  Octagon,
  Heart,
  Plus,
  Shapes,
  Link,
  Image,
} from 'lucide-react';

import type { ShapeType } from '@/types';
interface InsertShapesProps {
  onInsertShape: (shape: ShapeType) => void;
  onInsertLink: () => void;
  onInsertImage: () => void;
  onClose: () => void;
}

const shapes: { type: ShapeType; label: string; icon: React.ReactNode }[] = [
  { type: 'rectangle', label: 'Rectangle', icon: <RectangleHorizontal size={20} /> },
  { type: 'square', label: 'Square', icon: <Square size={20} /> },
  { type: 'circle', label: 'Circle', icon: <Circle size={20} /> },
  { type: 'triangle', label: 'Triangle', icon: <Triangle size={20} /> },
  { type: 'pentagon', label: 'Pentagon', icon: <Pentagon size={20} /> },
  { type: 'hexagon', label: 'Hexagon', icon: <Hexagon size={20} /> },
  { type: 'heptagon', label: 'Heptagon', icon: <Shapes size={20} /> },
  { type: 'octagon', label: 'Octagon', icon: <Octagon size={20} /> },
  { type: 'nonagon', label: 'Nonagon', icon: <Shapes size={20} /> },
  { type: 'decagon', label: 'Decagon', icon: <Shapes size={20} /> },
  { type: 'star', label: 'Star', icon: <Star size={20} /> },
  { type: 'diamond', label: 'Diamond', icon: <Diamond size={20} /> },
  { type: 'cross', label: 'Cross', icon: <Plus size={20} /> },
  { type: 'heart', label: 'Heart', icon: <Heart size={20} /> },
  { type: 'line', label: 'Line', icon: <Minus size={20} /> },
  { type: 'arrow', label: 'Arrow', icon: <ArrowRight size={20} /> },
];

const InsertShapes: React.FC<InsertShapesProps> = ({ onInsertShape, onInsertLink, onInsertImage, onClose }) => {
  return (
    <div className="insert-shapes-overlay" onClick={onClose}>
      <div className="insert-shapes-panel" onClick={(e) => e.stopPropagation()}>
        <div className="insert-shapes-header">
          <h3>Insert</h3>
          <button className="insert-shapes-close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        
        {/* Shapes Section */}
        <div className="insert-shapes-section">
          <h4>Shapes</h4>
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

        {/* Media Section */}
        <div className="insert-shapes-section">
          <h4>Media</h4>
          <div className="insert-shapes-grid">
            <button
              className="insert-shape-btn"
              onClick={onInsertLink}
              title="Insert Link"
            >
              <Link size={20} />
              <span>Link</span>
            </button>
            <button
              className="insert-shape-btn"
              onClick={onInsertImage}
              title="Insert Image"
            >
              <Image size={20} />
              <span>Image</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default InsertShapes;