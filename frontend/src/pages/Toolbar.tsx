import React, { useState } from 'react';
import { PenTool, X } from 'lucide-react';
import ColorPicker from '@/components/tools/ColorPicker';
import Eraser from '@/components/tools/Eraser';
import HandTool from '@/components/tools/HandTool';
import SelectTool from '@/components/tools/SelectTool';
import BrushSize from '@/components/tools/BrushSize';
import BrushIntensity from '@/components/tools/BrushIntensity';

interface ToolbarProps {
  activeTool: 'chalk' | 'eraser' | 'pan' | 'select';
  activeColor: string;
  brushSize: number;
  brushIntensity: number;
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan' | 'select') => void;
  onColorChange: (color: string) => void;
  onBrushSizeChange: (size: number) => void;
  onIntensityChange: (intensity: number) => void;
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
}) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!isOpen) {
    return (
      <button className="toolbar-toggle-btn" onClick={() => setIsOpen(true)} title="Open Tools">
        <PenTool size={26} />
      </button>
    );
  }

  return (
    <>
      <div className="toolbar-modal-overlay" onClick={() => setIsOpen(false)} />
      <div className="toolbar-modal">
        <div className="toolbar-modal-header">
          <h3>Blackboard Tools</h3>
          <button className="toolbar-close-btn" onClick={() => setIsOpen(false)} title="Close Tools">
            <X size={20} />
          </button>
        </div>

        <div className="toolbar-section">
          <div className="toolbar-section-title">Chalk Color</div>
          <div className="toolbar-row" style={{ paddingTop: '4px' }}>
            <ColorPicker
              activeTool={activeTool}
              activeColor={activeColor}
              onToolChange={onToolChange}
              onColorChange={onColorChange}
            />
          </div>
        </div>

        <div className="toolbar-section">
          <div className="toolbar-section-title">Eraser</div>
          <div className="toolbar-row">
            <Eraser activeTool={activeTool} onToolChange={onToolChange} />
          </div>
        </div>

        <div className="toolbar-section">
          <div className="toolbar-section-title">Move</div>
          <div className="toolbar-row">
            <HandTool activeTool={activeTool} onToolChange={onToolChange} />
          </div>
        </div>

        <div className="toolbar-section">
          <div className="toolbar-section-title">Select</div>
          <div className="toolbar-row">
            <SelectTool activeTool={activeTool} onToolChange={onToolChange} />
          </div>
        </div>

        <div className="toolbar-section">
          <div className="toolbar-section-title">Brush Size</div>
          <BrushSize brushSize={brushSize} onBrushSizeChange={onBrushSizeChange} />
        </div>

        <div className="toolbar-section">
          <div className="toolbar-section-title">Chalk Intensity</div>
          <BrushIntensity brushIntensity={brushIntensity} onIntensityChange={onIntensityChange} />
        </div>
      </div>
    </>
  );
};

export default Toolbar;
