import React from 'react';

export interface ChalkColor {
  name: string;
  value: string;
  className: string;
}

// eslint-disable-next-line react-refresh/only-export-components
export const CHALK_COLORS: ChalkColor[] = [
  { name: 'white', value: '#ffffff', className: 'color-white' },
  { name: 'yellow', value: '#fff3a1', className: 'color-yellow' },
  { name: 'blue', value: '#a3e5ff', className: 'color-blue' },
  { name: 'pink', value: '#ffa3d1', className: 'color-pink' },
  { name: 'green', value: '#a3ffd6', className: 'color-green' },
];

interface ChalkSticksProps {
  activeTool: 'chalk' | 'eraser' | 'pan';
  activeColor: string;
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan') => void;
  onColorChange: (color: string) => void;
}

const ChalkSticks: React.FC<ChalkSticksProps> = ({
  activeTool,
  activeColor,
  onToolChange,
  onColorChange,
}) => {
  return (
    <>
      {CHALK_COLORS.map((color) => (
        <button
          key={color.name}
          type="button"
          className={`chalk-stick ${color.className} ${
            activeTool === 'chalk' && activeColor === color.value ? 'active' : ''
          }`}
          title={`Chalk: ${color.name}`}
          onClick={() => {
            onToolChange('chalk');
            onColorChange(color.value);
          }}
        >
          <span>{color.name}</span>
        </button>
      ))}
    </>
  );
};

export default ChalkSticks;
