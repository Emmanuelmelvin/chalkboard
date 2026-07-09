import React from 'react';
import ChalkSticks from '@/components/tools/ChalkSticks';
import Eraser from '@/components/tools/Eraser';
import BrushSize from '@/components/tools/BrushSize';
import BrushIntensity from '@/components/tools/BrushIntensity';
import ActionSticks from '@/components/tools/ActionSticks';

interface ToolbarProps {
  activeTool: 'chalk' | 'eraser';
  activeColor: string;
  brushSize: number;
  brushIntensity: number;
  onToolChange: (tool: 'chalk' | 'eraser') => void;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onIntensityChange: (intensity: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
  activeTool,
  activeColor,
  brushSize,
  brushIntensity,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onIntensityChange,
  onUndo,
  onRedo,
  onClear,
  canUndo,
  canRedo,
}) => {
  return (
    <div className="chalk-ledge-container">
      <div className="chalk-ledge">
        {/* Chalk Sticks */}
        <ChalkSticks
          activeTool={activeTool}
          activeColor={activeColor}
          onToolChange={onToolChange}
          onColorChange={onColorChange}
        />

        <div className="ledge-divider" />

        {/* Felt Eraser */}
        <Eraser activeTool={activeTool} onToolChange={onToolChange} />

        <div className="ledge-divider" />

        {/* Brush Size Selector */}
        <BrushSize brushSize={brushSize} onBrushSizeChange={onBrushSizeChange} />

        <div className="ledge-divider" />

        {/* Brush Intensity Selector */}
        <BrushIntensity brushIntensity={brushIntensity} onIntensityChange={onIntensityChange} />

        <div className="ledge-divider" />

        {/* Action Sticks (Undo, Redo, Clear) */}
        <ActionSticks
          onUndo={onUndo}
          onRedo={onRedo}
          onClear={onClear}
          canUndo={canUndo}
          canRedo={canRedo}
        />
      </div>
    </div>
  );
};

export default Toolbar;
