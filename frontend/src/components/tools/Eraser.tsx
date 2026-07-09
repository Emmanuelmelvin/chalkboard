import React from 'react';

interface EraserProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select';
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
}

const Eraser: React.FC<EraserProps> = ({ activeTool, onToolChange }) => {
  return (
    <button
      type="button"
      className={`felt-eraser ${activeTool === 'eraser' ? 'active' : ''}`}
      title="Felt Eraser"
      onClick={() => onToolChange('eraser')}
    >
      <span>ERASER</span>
    </button>
  );
};

export default Eraser;
