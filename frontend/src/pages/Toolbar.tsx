import React, { useState } from 'react';
import { PenTool, Eraser, Hand, MousePointer2 } from 'lucide-react';
import ColorPicker from '@/components/tools/ColorPicker';
import BrushSize from '@/components/tools/BrushSize';
import BrushIntensity from '@/components/tools/BrushIntensity';
import type { ToolbarProps } from '@/types';

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
  const [showSettings, setShowSettings] = useState(false);

  const [prevActiveTool, setPrevActiveTool] = useState(activeTool);

  if (activeTool !== prevActiveTool) {
    setPrevActiveTool(activeTool);
    if (activeTool !== 'chalk') {
      setShowSettings(false);
    }
  }

  return (
    <div className="bottom-toolbar-container">
      <div className="bottom-toolbar-card">
        {/* Chalk/Brush wrapper to manage hover/click */}
        <div
          className="chalk-tool-wrapper"
          onMouseEnter={() => {
            if (activeTool === 'chalk') {
              setShowSettings(true);
            }
          }}
          onMouseLeave={() => setShowSettings(false)}
          style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
        >
          <button
            type="button"
            className={`action-stick ${activeTool === 'chalk' ? 'active' : ''}`}
            onClick={() => {
              if (activeTool !== 'chalk') {
                onToolChange('chalk');
                setShowSettings(true);
              } else {
                setShowSettings((prev) => !prev);
              }
            }}
            title="Chalk (Ctrl+B)"
          >
            <PenTool size={20} />
          </button>

          {showSettings && activeTool === 'chalk' && (
            <div className="chalk-settings-flyout">
              <div className="settings-section">
                <span className="settings-label">Color</span>
                <ColorPicker
                  activeTool={activeTool}
                  activeColor={activeColor}
                  onToolChange={onToolChange}
                  onColorChange={onColorChange}
                />
              </div>
              <div className="settings-divider" />
              <div className="settings-section">
                <span className="settings-label">Size</span>
                <BrushSize brushSize={brushSize} onBrushSizeChange={onBrushSizeChange} />
              </div>
              <div className="settings-divider" />
              <div className="settings-section">
                <span className="settings-label">Intensity</span>
                <BrushIntensity brushIntensity={brushIntensity} onIntensityChange={onIntensityChange} />
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`action-stick ${activeTool === 'eraser' ? 'active' : ''}`}
          onClick={() => {
            onToolChange('eraser');
            setShowSettings(false);
          }}
          title="Eraser (Ctrl+E)"
        >
          <Eraser size={20} />
        </button>

        <button
          type="button"
          className={`action-stick ${activeTool === 'pan' ? 'active' : ''}`}
          onClick={() => {
            onToolChange('pan');
            setShowSettings(false);
          }}
          title="Move Board (Ctrl+H / Ctrl+M)"
        >
          <Hand size={20} />
        </button>

        <button
          type="button"
          className={`action-stick ${activeTool === 'select' ? 'active' : ''}`}
          onClick={() => {
            onToolChange('select');
            setShowSettings(false);
          }}
          title="Select Items (Ctrl+S)"
        >
          <MousePointer2 size={20} />
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
