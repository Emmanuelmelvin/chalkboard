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
  ChevronDown,
  ChevronUp,
  RulerIcon,
  Group,
  Ungroup,
  RotateCw,
  RotateCcw,
  Undo2,
  Maximize2,
} from 'lucide-react';
import { CHALK_COLORS } from '@/components/tools/ColorPicker';
import type { PluginSelectionToolContribution } from '@/plugins/types';

interface SelectionToolboxProps {
  /** Canvas-space X of the right edge of the transform box in screen coords */
  boxScreenLeft: number;
  /** Canvas-space X of the right edge of the transform box in screen coords */
  boxScreenRight: number;
  /** Canvas-space Y of the vertical center of the transform box in screen coords */
  boxScreenCenterY: number;
  activeColor: string;
  activeFillColor?: string;
  onColorChange: (color: string) => void;
  onFillColorChange?: (fillColor: string) => void;
  onDelete: () => void;
  onDeselect: () => void;
  onIncreaseSize: () => void;
  onDecreaseSize: () => void;
  onSetSize: (size: number) => void;
  onCopy: () => void;
  onDuplicate: () => void;
  onCut: () => void;
  onGroup: () => void;
  onUngroup: () => void;
  /** Rotate callback: angle in degrees */
  onRotate?: (angleDeg: number) => void;
  /** Reset rotation to 0 */
  onResetRotation?: () => void;
  /** Set dimensions (width, height) */
  onSetDimensions?: (width: number, height: number) => void;
  /** Trim callback */
  onTrim?: () => void;
  onResetTrim?: () => void;
  /** Current rotation angle in degrees */
  currentRotation?: number;
  /** Current bounding box dimensions */
  currentWidth?: number;
  currentHeight?: number;
  /** Number of selected strokes */
  selectedCount: number;
  /** Whether the selected strokes are already grouped */
  isGrouped: boolean;
  pluginSelectionTools?: PluginSelectionToolContribution[];
  onRunPluginSelectionTool?: (commandId: string) => void;
}

type SubPanel = 'color' | 'size' | 'rotate' | 'dimensions' | 'trim' | 'plugins' | null;

const PANEL_WIDTH = 164;
const PANEL_MARGIN = 16; // gap from selection box edge to panel
const RIGHT_EXTRA_OFFSET = 60; // extra offset to the right so the panel doesn't block the selection

const SelectionToolbox: React.FC<SelectionToolboxProps> = ({
  boxScreenLeft,
  boxScreenRight,
  boxScreenCenterY,
  activeColor,
  activeFillColor = 'transparent',
  onColorChange,
  onFillColorChange,
  onDelete,
  onDeselect,
  onIncreaseSize,
  onDecreaseSize,
  onSetSize,
  onCopy,
  onDuplicate,
  onCut,
  onGroup,
  onUngroup,
  onRotate,
  onResetRotation,
  onSetDimensions,
  onTrim,
  onResetTrim,
  currentRotation = 0,
  currentWidth = 0,
  currentHeight = 0,
  selectedCount,
  isGrouped,
  pluginSelectionTools = [],
  onRunPluginSelectionTool,
}) => {
  const [openSubPanel, setOpenSubPanel] = useState<SubPanel>(null);
  const [colorMode, setColorMode] = useState<'stroke' | 'fill'>('stroke');
  const [brushSize, setBrushSize] = useState<number>(8);
  const [dimW, setDimW] = useState<string>(String(Math.round(currentWidth)));
  const [dimH, setDimH] = useState<string>(String(Math.round(currentHeight)));
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelScrollRef = useRef<HTMLDivElement | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [canScrollUp, setCanScrollUp] = useState(false);
  const [canScrollDown, setCanScrollDown] = useState(false);

  // Sync dimension inputs when currentWidth/currentHeight change
  useEffect(() => {
    const timer = window.setTimeout(() => setDimW(String(Math.round(currentWidth))), 0);
    return () => window.clearTimeout(timer);
  }, [currentWidth]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDimH(String(Math.round(currentHeight))), 0);
    return () => window.clearTimeout(timer);
  }, [currentHeight]);

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
    closeTimer.current = setTimeout(() => setOpenSubPanel(null), 450);
  }, []);

  const updateScrollControls = useCallback(() => {
    const panel = panelScrollRef.current;
    if (!panel) return;

    const hasOverflow = panel.scrollHeight > panel.clientHeight + 1;
    setCanScrollUp(hasOverflow && panel.scrollTop > 1);
    setCanScrollDown(hasOverflow && panel.scrollTop + panel.clientHeight < panel.scrollHeight - 1);
  }, []);

  useEffect(() => {
    updateScrollControls();
    const panel = panelScrollRef.current;
    if (!panel) return;

    const observer = new ResizeObserver(updateScrollControls);
    observer.observe(panel);
    observer.observe(panel.firstElementChild ?? panel);
    window.addEventListener('resize', updateScrollControls);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateScrollControls);
    };
  }, [pluginSelectionTools.length, updateScrollControls]);

  const scrollPanel = (direction: 1 | -1) => {
    panelScrollRef.current?.scrollBy({ top: direction * 180, behavior: 'smooth' });
  };

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

  const handleDimWChange = (val: string) => {
    setDimW(val);
  };

  const handleDimHChange = (val: string) => {
    setDimH(val);
  };

  const commitDimW = () => {
    const num = parseInt(dimW, 10);
    if (!isNaN(num) && num > 0) {
      onSetDimensions?.(num, parseInt(dimH, 10) || currentHeight);
    } else {
      setDimW(String(Math.round(currentWidth)));
    }
  };

  const commitDimH = () => {
    const num = parseInt(dimH, 10);
    if (!isNaN(num) && num > 0) {
      onSetDimensions?.(parseInt(dimW, 10) || currentWidth, num);
    } else {
      setDimH(String(Math.round(currentHeight)));
    }
  };

  return (
    <div
      ref={rootRef}
      className={`selection-toolbox selection-toolbox-${placeRight ? 'right' : 'left'}`}
      data-panel-x={panelX}
      data-panel-y={panelY}
    >
      {/* ── Main vertical panel ── */}
      <div className="sel-toolbox-panel" onMouseLeave={handlePanelLeave}>
        <button
            type="button"
            onClick={() => scrollPanel(-1)}
            disabled={!canScrollUp}
            className={`sel-scroll-control sel-scroll-control-top ${canScrollUp ? '' : 'sel-scroll-control-hidden'}`}
            aria-label="Scroll selection tools up"
            title="Scroll up"
          >
            <ChevronUp size={16} />
          </button>
        <div
          ref={panelScrollRef}
          className="sel-toolbox-scroll-area"
          onScroll={updateScrollControls}
        >

        {/* ── Color row ── */}
        <div
          className={`sel-toolbox-row ${openSubPanel === 'color' ? 'sel-row-active' : ''}`}
          onMouseEnter={() => handleRowEnter('color')}
        >
          <span className="sel-row-icon">
            <span
              className="sel-color-dot"
              data-color={activeColor}
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

        {/* ── Dimensions row ── */}
        <div
          className={`sel-toolbox-row ${openSubPanel === 'dimensions' ? 'sel-row-active' : ''}`}
          onMouseEnter={() => handleRowEnter('dimensions')}
        >
          <span className="sel-row-icon"><Maximize2 size={13} /></span>
          <span className="sel-row-label">Dimensions</span>
          <ChevronRight size={11} className="sel-row-chevron" />
        </div>

        {/* ── Rotate row ── */}
        <div
          className={`sel-toolbox-row ${openSubPanel === 'rotate' ? 'sel-row-active' : ''}`}
          onMouseEnter={() => handleRowEnter('rotate')}
        >
          <span className="sel-row-icon"><RotateCw size={13} /></span>
          <span className="sel-row-label">Rotate</span>
          <span className="sel-rotation-value">
            {Math.round(currentRotation)}°
          </span>
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

        {/* ── Crop ── */}
        <div
          className={`sel-toolbox-row sel-action-row ${openSubPanel === 'trim' ? 'sel-row-active' : ''}`}
          onMouseEnter={() => handleRowEnter('trim')}
        >
          <span className="sel-row-icon"><Scissors size={13} /></span>
          <span className="sel-row-label">Crop</span>
          <kbd className="sel-kbd sel-kbd-crop">Ctrl+Shift+T</kbd>
          <ChevronRight size={11} className="sel-row-chevron" />
        </div>

        <div className="sel-divider" />

        {/* ── Group ── */}
        <button
          type="button"
          onMouseEnter={() => handleRowEnter(null)}
          onClick={() => { onGroup(); }}
          disabled={selectedCount < 2 || isGrouped}
          className={`sel-toolbox-row sel-action-row ${selectedCount < 2 || isGrouped ? 'sel-action-disabled' : ''}`}
        >
          <span className="sel-row-icon"><Group size={13} /></span>
          <span className="sel-row-label">Group</span>
          <kbd className="sel-kbd">Ctrl+G</kbd>
        </button>

        {/* ── Ungroup ── */}
        <button
          type="button"
          onMouseEnter={() => handleRowEnter(null)}
          onClick={() => { onUngroup(); }}
          disabled={!isGrouped || selectedCount < 1}
          className={`sel-toolbox-row sel-action-row ${!isGrouped || selectedCount < 1 ? 'sel-action-disabled' : ''}`}
        >
          <span className="sel-row-icon"><Ungroup size={13} /></span>
          <span className="sel-row-label">Ungroup</span>
          <kbd className="sel-kbd">Ctrl+Shift+G</kbd>
        </button>

        {pluginSelectionTools.length > 0 && (
          <div className={`sel-toolbox-row ${openSubPanel === 'plugins' ? 'sel-row-active' : ''}`} onMouseEnter={() => handleRowEnter('plugins')}>
            <span className="sel-row-icon"><SquareStack size={13} /></span>
            <span className="sel-row-label">Plugins</span>
            <ChevronRight size={11} className="sel-row-chevron" />
          </div>
        )}

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
        <button
            type="button"
            onClick={() => scrollPanel(1)}
            disabled={!canScrollDown}
            className={`sel-scroll-control sel-scroll-control-bottom ${canScrollDown ? '' : 'sel-scroll-control-hidden'}`}
            aria-label="Scroll selection tools down"
            title="More selection tools"
          >
            <ChevronDown size={16} />
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
          {/* Stroke / Fill toggle */}
          <div className="sel-color-mode-toggle">
            <button
              type="button"
              onClick={() => setColorMode('stroke')}
              className={`sel-color-mode-button ${colorMode === 'stroke' ? 'active' : ''}`}
            >
              Stroke
            </button>
            <button
              type="button"
              onClick={() => setColorMode('fill')}
              className={`sel-color-mode-button ${colorMode === 'fill' ? 'active' : ''}`}
            >
              Fill
            </button>
          </div>
          {/* Native color picker */}
          <input
            type="color"
            value={colorMode === 'stroke' ? activeColor : activeFillColor === 'transparent' ? '#ffffff' : activeFillColor}
            onChange={(e) => {
              if (colorMode === 'stroke') {
                onColorChange(e.target.value);
              } else {
                onFillColorChange?.(e.target.value);
              }
            }}
            title="Custom Color"
            className="native-color-picker sel-native-color-picker"
          />
          {/* Swatches */}
          <div className="sel-swatch-grid">
            {CHALK_COLORS.map((c) => (
              <button
                key={c.name}
                type="button"
                className={`sel-swatch sel-swatch-${c.name} ${(colorMode === 'stroke' ? activeColor : activeFillColor).toLowerCase() === c.value.toLowerCase() ? 'sel-swatch-active' : ''}`}
                title={c.name}
                onClick={() => {
                  if (colorMode === 'stroke') {
                    onColorChange(c.value);
                  } else {
                    onFillColorChange?.(c.value);
                  }
                }}
              />
            ))}
          </div>
          {/* Transparent option for fill */}
          {colorMode === 'fill' && (
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-transparent-fill-button"
              onClick={() => onFillColorChange?.('transparent')}
            >
              <span className="sel-small-label">No Fill (Transparent)</span>
            </button>
          )}
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
                data-size={Math.min(brushSize * 3, 48)}
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
          <div className="slider-container sel-size-slider">
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
              min={1}
              max={100}
              value={brushSize}
              className="number-input sel-size-number"
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

      {/* ── Sub-panel: Dimensions ── */}
      {openSubPanel === 'dimensions' && (
        <div
          className={`sel-subpanel ${subPanelSide === 'right' ? 'sel-subpanel-right' : 'sel-subpanel-left'}`}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={handlePanelLeave}
        >
          <p className="sel-subpanel-title">Dimensions</p>
          <div className="sel-dimensions-fields">
            <div className="sel-dimension-field">
              <label>W</label>
              <input
                type="number"
                min={1}
                value={dimW}
                className="number-input sel-dimension-input"
                onChange={(e) => handleDimWChange(e.target.value)}
                onBlur={commitDimW}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}

              />
            </div>
            <div className="sel-dimension-field">
              <label>H</label>
              <input
                type="number"
                min={1}
                value={dimH}
                className="number-input sel-dimension-input"
                onChange={(e) => handleDimHChange(e.target.value)}
                onBlur={commitDimH}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}

              />
            </div>
          </div>
          <p className="sel-size-hint sel-size-hint-spaced">
            Set exact width & height
          </p>
        </div>
      )}

      {/* ── Sub-panel: Rotate ── */}
      {openSubPanel === 'rotate' && (
        <div
          className={`sel-subpanel ${subPanelSide === 'right' ? 'sel-subpanel-right' : 'sel-subpanel-left'}`}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={handlePanelLeave}
        >
          <p className="sel-subpanel-title">
            Rotate
            <span className="sel-rotation-value sel-rotation-value-inline">
              {Math.round(currentRotation)}°
            </span>
          </p>
          <div className="sel-rotate-actions">
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={() => onRotate?.(90)}
            >
              <RotateCw size={14} className="sel-action-icon" />
              Rotate 90° CW
              <kbd className="sel-kbd sel-kbd-auto">Ctrl+]</kbd>
            </button>
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={() => onRotate?.(-90)}
            >
              <RotateCcw size={14} className="sel-action-icon" />
              Rotate 90° CCW
              <kbd className="sel-kbd sel-kbd-auto">Ctrl+[</kbd>
            </button>
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={() => onRotate?.(180)}
            >
              <RotateCw size={14} className="sel-action-icon" />
              Rotate 180°
            </button>
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={() => onRotate?.(45)}
            >
              <RotateCw size={14} className="sel-action-icon" />
              Rotate 45° CW
            </button>
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={() => onRotate?.(-45)}
            >
              <RotateCcw size={14} className="sel-action-icon" />
              Rotate 45° CCW
            </button>
            <div className="sel-divider sel-divider-spaced" />
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={() => onResetRotation?.()}
            >
              <Undo2 size={14} className="sel-action-icon" />
              Reset Rotation
              <kbd className="sel-kbd sel-kbd-auto">Ctrl+Shift+R</kbd>
            </button>
          </div>
          <p className="sel-size-hint sel-size-hint-spaced">Or drag the rotate handle below selection</p>
        </div>
      )}
      {/* ── Sub-panel: Trim ── */}
      {openSubPanel === 'trim' && (
        <div
          className={`sel-subpanel ${subPanelSide === 'right' ? 'sel-subpanel-right' : 'sel-subpanel-left'} sel-subpanel-end`}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={handlePanelLeave}
        >
          <p className="sel-subpanel-title">Crop</p>
          <div className="sel-rotate-actions">
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={() => onTrim?.()}
            >
              <Scissors size={14} className="sel-action-icon" />
              Crop Selection
            </button>
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={() => onResetTrim?.()}
            >
              <Undo2 size={14} className="sel-action-icon" />
              Reset Crop
            </button>
          </div>
          <p className="sel-size-hint sel-size-hint-spaced">
            Drag edges to crop, Enter to apply
          </p>
        </div>
      )}
      {openSubPanel === 'plugins' && (
        <div className={`sel-subpanel sel-plugin-subpanel ${subPanelSide === 'right' ? 'sel-subpanel-right' : 'sel-subpanel-left'}`} onMouseEnter={() => clearCloseTimer()} onMouseLeave={handlePanelLeave}>
          {pluginSelectionTools.map((tool) => (
            <button key={tool.id} type="button" className="sel-toolbox-row sel-action-row" onClick={() => onRunPluginSelectionTool?.(tool.command)} title={tool.description ?? tool.label}>
              <span className="sel-row-icon"><SquareStack size={13} /></span><span className="sel-row-label">{tool.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SelectionToolbox;
