import React from 'react';
import { MousePointer2 } from 'lucide-react';

interface SelectToolProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select';
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
}

const SelectTool: React.FC<SelectToolProps> = ({ activeTool, onToolChange }) => {
  return (
    <button
      type="button"
      className={`felt-eraser tool-stick-button ${activeTool === 'select' ? 'active' : ''}`}
      title="Select Items"
      onClick={() => onToolChange('select')}
    >
      <MousePointer2 size={16} />
      <span>SELECT</span>
    </button>
  );
};

export default SelectTool;
