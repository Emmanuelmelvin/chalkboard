import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Trash2,
  X,
  Minus,
  Plus,
  Copy,
  SquareStack,
  Scissors,
  ChevronRight,
  RulerIcon,
} from 'lucide-react';
import { CHALK_COLORS } from '@/components/tools/ColorPicker';

interface SelectionToolboxProps {
  /** Canvas-space X of the right edge of the transform box in screen coords */
  boxScreenLeft: number;
  /** Canvas-space X of the right edge of the transform box in screen coords */
  boxScreenRight: number;
  /** Canvas-space Y of the vertical center of the transform box in screen coords */
  boxScreenCenterY: number;
  activeColor: string;
  onColorChange: (color: string) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onIncreaseSize: () => void;
  onDecreaseSize: () => void;
  onSetSize: (size: number) => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onCut: () => void;
}

type SubPanel = 'color' | 'size' | null;

const PANEL_WIDTH = 188;
const PANEL_MARGIN = 16; // gap from selection box edge to panel
const RIGHT_EXTRA_OFFSET = 60; // extra offset to the right so the panel doesn't block the selection

const SelectionToolbox: React.FC<SelectionToolboxProps> = ({
  boxScreenLeft,
  boxScreenRight,
  boxScreenCenterY,
  activeColor,
  onColorChange,
  onDelete,
  onDeselect,
  onIncreaseSize,
  onDecreaseSize,
  onSetSize,
  onCopy,
  onDuplicate,
  onCut,
}) => {
  const [openSubPanel, setOpenSubPanel] = useState<SubPanel>(null);
  const [brushSize, setBrushSize] = useState<number>(8);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Decide left vs right placement
  const viewportW = window.innerWidth;
  const spaceRight = viewportW - boxScreenRight - PANEL_MARGIN;
  const spaceLeft = boxScreenLeft - PANEL_MARGIN;
  const placeRight = spaceRight >= PANEL_WIDTH || spaceRight >= spaceLeft;
  const panelX = placeRight
    ? boxScreenRight + PANEL_MARGIN + RIGHT_EXTRA_OFFSET
    : boxScreenLeft - PANEL_MARGIN - PANEL_WIDTH;

  // Clamp vertically so the panel stays on screen
  const panelEstH = 310;
  const rawTop = boxScreenCenterY - panelEstH / 2;
  const panelY = Math.max(12, Math.min(rawTop, window.innerHeight - panelEstH - 12));

  // Sub-panel side: always opposite to avoid going off-screen
  const subPanelSide = placeRight ? 'right' : 'left';

  const clearCloseTimer = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  const scheduleClose = useCallback(() => {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpenSubPanel(null), 120);
  }, []);

  const handleRowEnter = (panel: SubPanel) => {
    clearCloseTimer();
    setOpenSubPanel(panel);
  };

  const handlePanelLeave = () => {
    scheduleClose();
  };

  // Close on outside click
  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpenSubPanel(null);
      }
    };
    document.addEventListener('mousedown', down);
    return () => document.removeEventListener('mousedown', down);
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        position: 'fixed',
        left: panelX,
        top: panelY,
        zIndex: 2000,
        pointerEvents: 'auto',
        display: 'flex',
        flexDirection: placeRight ? 'row' : 'row-reverse',
        alignItems: 'flex-start',
        gap: 0,
      }}
    >
      {/* ── Main vertical panel ── */}
      <div className="sel-toolbox-panel" onMouseLeave={handlePanelLeave}>

        {/* ── Color row ── */}
        <div
          className={`sel-toolbox-row ${openSubPanel === 'color' ? 'sel-row-active' : ''}`}
          onMouseEnter={() => handleRowEnter('color')}
        >
          <span className="sel-row-icon">
            <span
              className="sel-color-dot"
              style={{ background: activeColor, boxShadow: `0 0 0 2px rgba(255,255,255,0.3), 0 0 6px ${activeColor}66` }}
            />
          </span>
          <span className="sel-row-label">Color</span>
          <ChevronRight size={11} className="sel-row-chevron" />
        </div>

        {/* ── Size row ── */}
        <div
          className={`sel-toolbox-row ${openSubPanel === 'size' ? 'sel-row-active' : ''}`}
          onMouseEnter={() => handleRowEnter('size')}
        >
          <span className="sel-row-icon"><RulerIcon size={13} /></span>
          <span className="sel-row-label">Size</span>
          <ChevronRight size={11} className="sel-row-chevron" />
        </div>

        <div className="sel-divider" />

        {/* ── Copy ── */}
        <button
          type="button"
          className="sel-toolbox-row sel-action-row"
          onMouseEnter={() => handleRowEnter(null)}
          onClick={() => { onCopy(); }}
        >
          <span className="sel-row-icon"><Copy size={13} /></span>
          <span className="sel-row-label">Copy</span>
          <kbd className="sel-kbd">Ctrl+C</kbd>
        </button>

        {/* ── Duplicate ── */}
        <button
          type="button"
          className="sel-toolbox-row sel-action-row"
          onMouseEnter={() => handleRowEnter(null)}
          onClick={() => { onDuplicate(); }}
        >
          <span className="sel-row-icon"><SquareStack size={13} /></span>
          <span className="sel-row-label">Duplicate</span>
          <kbd className="sel-kbd">Ctrl+D</kbd>
        </button>

        {/* ── Cut ── */}
        <button
          type="button"
          className="sel-toolbox-row sel-action-row"
          onMouseEnter={() => handleRowEnter(null)}
          onClick={() => { onCut(); }}
        >
          <span className="sel-row-icon"><Scissors size={13} /></span>
          <span className="sel-row-label">Cut</span>
          <kbd className="sel-kbd">Ctrl+X</kbd>
        </button>

        <div className="sel-divider" />

        {/* ── Delete ── */}
        <button
          type="button"
          className="sel-toolbox-row sel-action-row sel-danger-row"
          onMouseEnter={() => handleRowEnter(null)}
          onClick={() => { onDelete(); }}
        >
          <span className="sel-row-icon"><Trash2 size={13} /></span>
          <span className="sel-row-label">Delete</span>
          <kbd className="sel-kbd">Del</kbd>
        </button>

        {/* ── Deselect ── */}
        <button
          type="button"
          className="sel-toolbox-row sel-action-row sel-deselect-row"
          onMouseEnter={() => handleRowEnter(null)}
          onClick={() => { onDeselect(); }}
        >
          <span className="sel-row-icon"><X size={13} /></span>
          <span className="sel-row-label">Deselect</span>
          <kbd className="sel-kbd">Esc</kbd>
        </button>
      </div>

      {/* ── Sub-panel: Color ── */}
      {openSubPanel === 'color' && (
        <div
          className={`sel-subpanel ${subPanelSide === 'right' ? 'sel-subpanel-right' : 'sel-subpanel-left'}`}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={handlePanelLeave}
        >
          <p className="sel-subpanel-title">Color</p>
          {/* Native color picker */}
          <input
            type="color"
            className="native-color-picker"
            value={activeColor}
            onChange={(e) => onColorChange(e.target.value)}
            title="Custom Color"
            style={{ height: 32, borderRadius: 6, marginBottom: 10 }}
          />
          {/* Swatches */}
          <div className="sel-swatch-grid">
            {CHALK_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`sel-swatch ${activeColor.toLowerCase() === c.value.toLowerCase() ? 'sel-swatch-active' : ''}`}
                style={{ background: c.value }}
                title={c.name}
                onClick={() => onColorChange(c.value)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Sub-panel: Size ── */}
      {openSubPanel === 'size' && (
        <div
          className={`sel-subpanel ${subPanelSide === 'right' ? 'sel-subpanel-right' : 'sel-subpanel-left'}`}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={handlePanelLeave}
        >
          <p className="sel-subpanel-title">Stroke Size</p>
          <div className="sel-size-stepper">
            <button
              type="button"
              className="sel-size-btn"
              title="Decrease ([ )"
              onClick={onDecreaseSize}
            >
              <Minus size={14} />
            </button>
            <div className="sel-size-preview">
              <div
                className="sel-size-dot"
                style={{
                  width: Math.min(brushSize * 3, 48),
                  height: Math.min(brushSize * 3, 48),
                }}
              />
            </div>
            <button
              type="button"
              className="sel-size-btn"
              title="Increase (] )"
              onClick={onIncreaseSize}
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="slider-container" style={{ marginTop: 8, gap: 8 }}>
            <input
              type="range"
              className="slider-input"
              min={1}
              max={100}
              value={brushSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                setBrushSize(v);
                onSetSize(v);
              }}
            />
            <input
              type="number"
              className="number-input"
              min={1}
              max={100}
              value={brushSize}
              style={{ width: 44 }}
              onChange={(e) => {
                const v = Math.min(100, Math.max(1, Number(e.target.value)));
                setBrushSize(v);
                onSetSize(v);
              }}
            />
          </div>
          <p className="sel-size-hint">Use <kbd className="sel-kbd">[ ]</kbd> keys to change size</p>
        </div>
      )}
    </div>
  );
};

export default SelectionToolbox;
