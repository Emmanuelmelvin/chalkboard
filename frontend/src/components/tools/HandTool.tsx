import React from 'react';
import { Hand } from 'lucide-react';

interface HandToolProps {
  activeTool: 'chalk' | 'eraser' | 'pan';
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan') => void;
}

const HandTool: React.FC<HandToolProps> = ({ activeTool, onToolChange }) => {
  return (
    <button
      type="button"
      className={`felt-eraser ${activeTool === 'pan' ? 'active' : ''}`}
      title="Pan / Move Board"
      onClick={() => onToolChange('pan')}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
    >
      <Hand size={16} />
      <span>PAN</span>
    </button>
  );
};

export default HandTool;
