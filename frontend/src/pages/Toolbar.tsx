import React, { useState } from 'react';
import { PenTool, X } from 'lucide-react';
import ColorPicker from '@/components/tools/ColorPicker';
import Eraser from '@/components/tools/Eraser';
import HandTool from '@/components/tools/HandTool';
import BrushSize from '@/components/tools/BrushSize';
import BrushIntensity from '@/components/tools/BrushIntensity';
import ActionSticks from '@/components/tools/ActionSticks';

interface ToolbarProps {
  activeTool: 'chalk' | 'eraser' | 'pan';
  activeColor: string;
  brushSize: number;
  brushIntensity: number;
  onToolChange: (tool: 'chalk' | 'eraser' | 'pan') => void;
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
          <div className="toolbar-section-title">Brush Size</div>
          <BrushSize brushSize={brushSize} onBrushSizeChange={onBrushSizeChange} />
        </div>

        <div className="toolbar-section">
          <div className="toolbar-section-title">Chalk Intensity</div>
          <BrushIntensity brushIntensity={brushIntensity} onIntensityChange={onIntensityChange} />
        </div>

        <div className="toolbar-section" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px', marginTop: '8px' }}>
          <div className="toolbar-row">
            <ActionSticks
              onUndo={onUndo}
              onRedo={onRedo}
              onClear={onClear}
              canUndo={canUndo}
              canRedo={canRedo}
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default Toolbar;
