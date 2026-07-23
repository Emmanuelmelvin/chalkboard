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
  eraserWidth,
  eraserHeight,
  onToolChange,
  onColorChange,
  onBrushSizeChange,
  onIntensityChange,
  onEraserWidthChange,
  onEraserHeightChange,
}) => {
  const [showChalkSettings, setShowChalkSettings] = useState(false);
  const [showEraserSettings, setShowEraserSettings] = useState(false);

  const [prevActiveTool, setPrevActiveTool] = useState(activeTool);

  if (activeTool !== prevActiveTool) {
    setPrevActiveTool(activeTool);
    if (activeTool !== 'chalk') {
      setShowChalkSettings(false);
    }
    if (activeTool !== 'eraser') {
      setShowEraserSettings(false);
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
              setShowChalkSettings(true);
            }
          }}
          onMouseLeave={() => setShowChalkSettings(false)}
        >
          <button
            type="button"
            className={`action-stick ${activeTool === 'chalk' ? 'active' : ''}`}
            onClick={() => {
              if (activeTool !== 'chalk') {
                onToolChange('chalk');
                setShowChalkSettings(true);
              } else {
                setShowChalkSettings((prev) => !prev);
              }
            }}
            title="Chalk (Ctrl+B)"
          >
            <PenTool size={14} />
          </button>

          {showChalkSettings && activeTool === 'chalk' && (
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

        {/* Eraser wrapper to manage hover/click */}
        <div
          className="chalk-tool-wrapper"
          onMouseEnter={() => {
            if (activeTool === 'eraser') {
              setShowEraserSettings(true);
            }
          }}
          onMouseLeave={() => setShowEraserSettings(false)}
        >
          <button
            type="button"
            className={`action-stick ${activeTool === 'eraser' ? 'active' : ''}`}
            onClick={() => {
              if (activeTool !== 'eraser') {
                onToolChange('eraser');
                setShowEraserSettings(true);
              } else {
                setShowEraserSettings((prev) => !prev);
              }
            }}
            title="Eraser (Ctrl+E)"
          >
            <Eraser size={14} />
          </button>

          {showEraserSettings && activeTool === 'eraser' && (
            <div className="chalk-settings-flyout eraser-settings-flyout">
              <div className="eraser-flyout-header">
                <span className="eraser-flyout-icon">⬜</span>
                <span className="eraser-flyout-title">Eraser Size</span>
              </div>
              <div className="settings-divider" />

              {/* Eraser Preview */}
              <div className="eraser-preview-area">
                <div
                  className="eraser-preview-rect"
                  data-width={Math.min(eraserWidth, 200)}
                  data-height={Math.min(eraserHeight, 60)}
                />
              </div>

              <div className="settings-section">
                <span className="settings-label">Width — {eraserWidth}px</span>
                <div className="slider-container">
                  <input
                    type="range"
                    className="slider-input"
                    min={10}
                    max={300}
                    step={5}
                    value={eraserWidth}
                    onChange={(e) => onEraserWidthChange(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    className="number-input"
                    min={10}
                    max={300}
                    value={eraserWidth}
                    onChange={(e) => {
                      const v = Math.min(300, Math.max(10, Number(e.target.value)));
                      onEraserWidthChange(v);
                    }}
                  />
                </div>
              </div>
              <div className="settings-divider" />
              <div className="settings-section">
                <span className="settings-label">Height — {eraserHeight}px</span>
                <div className="slider-container">
                  <input
                    type="range"
                    className="slider-input"
                    min={10}
                    max={200}
                    step={5}
                    value={eraserHeight}
                    onChange={(e) => onEraserHeightChange(Number(e.target.value))}
                  />
                  <input
                    type="number"
                    className="number-input"
                    min={10}
                    max={200}
                    value={eraserHeight}
                    onChange={(e) => {
                      const v = Math.min(200, Math.max(10, Number(e.target.value)));
                      onEraserHeightChange(v);
                    }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          className={`action-stick ${activeTool === 'pan' ? 'active' : ''}`}
          onClick={() => {
            onToolChange('pan');
            setShowChalkSettings(false);
            setShowEraserSettings(false);
          }}
          title="Move Board (Ctrl+H / Ctrl+M)"
        >
          <Hand size={14} />
        </button>

        <button
          type="button"
          className={`action-stick ${activeTool === 'select' ? 'active' : ''}`}
          onClick={() => {
            onToolChange('select');
            setShowChalkSettings(false);
            setShowEraserSettings(false);
          }}
          title="Select Items (Ctrl+S)"
        >
          <MousePointer2 size={14} />
        </button>
      </div>
    </div>
  );
};

export default Toolbar;
