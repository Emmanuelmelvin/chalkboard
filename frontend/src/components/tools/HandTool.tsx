import React from 'react';
import { Hand } from 'lucide-react';

interface HandToolProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select';
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
}

const HandTool: React.FC<HandToolProps> = ({ activeTool, onToolChange }) => {
  return (
    <button
      type="button"
      className={`felt-eraser tool-stick-button ${activeTool === 'pan' ? 'active' : ''}`}
      title="Pan / Move Board"
      onClick={() => onToolChange('pan')}
    >
      <Hand size={16} />
      <span>PAN</span>
    </button>
  );
};

export default HandTool;
