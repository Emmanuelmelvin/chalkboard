import React, { useState, useEffect } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Slider from '@radix-ui/react-slider';
import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  Trash2,
  X,
  Minus,
  Plus,
  Copy,
  CopyPlus,
  Scissors,
  Crop,
  Frame,
  Group,
  Ungroup,
  RotateCw,
  RotateCcw,
  Undo2,
  Palette,
  Brush,
  PenLine,
  PaintBucket,
} from 'lucide-react';
import { ColorPicker } from '@/components/ui/ColorPicker';
import { HoverCard } from '@/components/ui/HoverCard';

interface SelectionToolboxProps {
  /** Canvas-space X of the horizontal center of the transform box in screen coords */
  boxScreenCenterX: number;
  /** Canvas-space Y of the top edge of the transform box in screen coords */
  boxScreenTop: number;
  /** Canvas-space Y of the bottom edge of the transform box in screen coords */
  boxScreenBottom: number;
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
  /** Current stroke size of the selection */
  currentSize?: number;
  /** Current bounding box dimensions */
  currentWidth?: number;
  currentHeight?: number;
  /** Number of selected strokes */
  selectedCount: number;
  /** Whether the selected strokes are already grouped */
  isGrouped: boolean;
}

const BAR_GAP = 12; // gap between the selection box and the toolbar
const BAR_PADDING = 4;
const BAR_EDGE_MARGIN = 8; // keep the bar on-screen

const SelectionToolbox: React.FC<SelectionToolboxProps> = ({
  boxScreenCenterX,
  boxScreenTop,
  boxScreenBottom,
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
  currentSize = 8,
  currentWidth = 0,
  currentHeight = 0,
  selectedCount,
  isGrouped,
}) => {
  const [colorMode, setColorMode] = useState<'stroke' | 'fill'>('stroke');
  const [brushSize, setBrushSize] = useState(currentSize);
  const [customAngle, setCustomAngle] = useState(currentRotation);
  const [dimW, setDimW] = useState(Math.round(currentWidth));
  const [dimH, setDimH] = useState(Math.round(currentHeight));

  // Sync internal states with incoming props
  useEffect(() => {
    setBrushSize(currentSize);
  }, [currentSize]);

  useEffect(() => {
    setCustomAngle(currentRotation);
  }, [currentRotation]);

  useEffect(() => {
    setDimW(Math.round(currentWidth));
    setDimH(Math.round(currentHeight));
  }, [currentWidth, currentHeight]);

  // Stable screen-space positioning centered horizontally over the selection box.
  const BAR_ESTIMATED_HALF_WIDTH = 240;
  const clampedX = Math.max(
    BAR_EDGE_MARGIN + BAR_ESTIMATED_HALF_WIDTH,
    Math.min(window.innerWidth - BAR_ESTIMATED_HALF_WIDTH - BAR_EDGE_MARGIN, boxScreenCenterX)
  );

  const placeAbove = boxScreenTop - 56 >= BAR_EDGE_MARGIN;
  const targetY = placeAbove
    ? Math.max(BAR_EDGE_MARGIN + 48, boxScreenTop - BAR_GAP)
    : Math.min(window.innerHeight - 56, boxScreenBottom + BAR_GAP);

  const handleDimWChange = (val: string) => {
    const num = Math.max(1, parseInt(val, 10) || 0);
    setDimW(num);
  };

  const handleDimHChange = (val: string) => {
    const num = Math.max(1, parseInt(val, 10) || 0);
    setDimH(num);
  };

  const commitDimW = () => {
    if (dimW > 0 && dimH > 0 && onSetDimensions) {
      onSetDimensions(dimW, dimH);
    }
  };

  const commitDimH = () => {
    if (dimW > 0 && dimH > 0 && onSetDimensions) {
      onSetDimensions(dimW, dimH);
    }
  };

  const dropdownContentProps = {
    side: 'top' as const,
    collisionPadding: 12,
  };

  return (
    <div
      className="selection-toolbox"
      style={{
        left: `${Math.round(clampedX)}px`,
        top: `${Math.round(targetY)}px`,
        transform: placeAbove ? 'translate(-50%, -100%)' : 'translate(-50%, 0)',
      }}
    >
      <div className="sel-bar" style={{ padding: BAR_PADDING }}>
        {/* ── Color ── */}
        <DropdownMenu.Root modal={false}>
          <HoverCard content="Color" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Color">
                <Palette size={16} />
                <span className="sel-bar-color-dot" data-color={activeColor} style={{ background: activeColor }} />
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
          <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
            <p className="sel-subpanel-title">Color</p>
            <ToggleGroup.Root
              type="single"
              value={colorMode}
              onValueChange={(v) => { if (v) setColorMode(v as 'stroke' | 'fill'); }}
              className="sel-color-mode-toggle"
            >
              <HoverCard content="Stroke color" placement="top">
                <ToggleGroup.Item value="stroke" className="sel-color-mode-button" aria-label="Stroke color">
                  <PenLine size={12} />
                  Stroke
                </ToggleGroup.Item>
              </HoverCard>
              <HoverCard content="Fill color" placement="top">
                <ToggleGroup.Item value="fill" className="sel-color-mode-button" aria-label="Fill color">
                  <PaintBucket size={12} />
                  Fill
                </ToggleGroup.Item>
              </HoverCard>
            </ToggleGroup.Root>

            <ColorPicker
              value={colorMode === 'stroke' ? activeColor : (activeFillColor ?? 'transparent')}
              onChange={(color) => {
                if (colorMode === 'stroke') {
                  onColorChange(color);
                } else {
                  onFillColorChange?.(color);
                }
              }}
              allowTransparent={colorMode === 'fill'}
              onSelectTransparent={() => onFillColorChange?.('transparent')}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* ── Size ── */}
        <DropdownMenu.Root modal={false}>
          <HoverCard content="Stroke size" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Stroke size">
                <Brush size={16} />
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
          <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
            <p className="sel-subpanel-title">Stroke Size</p>
            <div className="sel-size-preview">
              <div
                className="sel-size-dot"
                data-size={Math.min(brushSize * 3, 48)}
                style={{ width: Math.min(brushSize * 3, 48), height: Math.min(brushSize * 3, 48) }}
              />
              <span className="sel-size-value">{Math.round(brushSize)}</span>
            </div>
            <Slider.Root
              className="sel-slider"
              min={1}
              max={100}
              step={1}
              value={[brushSize]}
              onValueChange={([v]) => {
                setBrushSize(v);
                onSetSize(v);
              }}
            >
              <Slider.Track className="sel-slider-track">
                <Slider.Range className="sel-slider-range" />
              </Slider.Track>
              <Slider.Thumb className="sel-slider-thumb" aria-label="Stroke size" />
            </Slider.Root>
            <div className="sel-size-stepper">
              <HoverCard content="Decrease ([)" placement="top">
                <button
                  type="button"
                  className="sel-size-btn"
                  aria-label="Decrease size"
                  onClick={onDecreaseSize}
                >
                  <Minus size={14} />
                </button>
              </HoverCard>
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
              <HoverCard content="Increase (])" placement="top">
                <button
                  type="button"
                  className="sel-size-btn"
                  aria-label="Increase size"
                  onClick={onIncreaseSize}
                >
                  <Plus size={14} />
                </button>
              </HoverCard>
            </div>
            <p className="sel-size-hint">Use <kbd className="sel-kbd">[ ]</kbd> keys to change size</p>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* ── Dimensions ── */}
        <DropdownMenu.Root modal={false}>
          <HoverCard content="Dimensions" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Dimensions">
                <Frame size={16} />
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
          <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
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
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* ── Rotate ── */}
        <DropdownMenu.Root modal={false}>
          <HoverCard content="Rotate" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Rotate">
                <RotateCw size={16} />
                {currentRotation !== 0 && (
                  <span className="sel-bar-badge">{Math.round(currentRotation)}°</span>
                )}
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
          <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
            <p className="sel-subpanel-title">
              Rotate
              <span className="sel-rotation-value sel-rotation-value-inline">
                {Math.round(currentRotation)}°
              </span>
            </p>
            <div className="sel-rotate-presets" role="group" aria-label="Rotation presets">
              <HoverCard content="Rotate 45° CCW" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 45° counter-clockwise"
                  onClick={() => onRotate?.(-45)}
                >
                  <RotateCcw size={13} />
                  45°
                </button>
              </HoverCard>
              <HoverCard content="Rotate 90° CCW (Ctrl+[)" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 90° counter-clockwise (Ctrl+[)"
                  onClick={() => onRotate?.(-90)}
                >
                  <RotateCcw size={13} />
                  90°
                </button>
              </HoverCard>
              <HoverCard content="Rotate 180°" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 180°"
                  onClick={() => onRotate?.(180)}
                >
                  <RotateCw size={13} />
                  180°
                </button>
              </HoverCard>
              <HoverCard content="Rotate 90° CW (Ctrl+])" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 90° clockwise (Ctrl+])"
                  onClick={() => onRotate?.(90)}
                >
                  <RotateCw size={13} />
                  90°
                </button>
              </HoverCard>
              <HoverCard content="Rotate 45° CW" placement="top">
                <button
                  type="button"
                  className="sel-rotate-preset-btn"
                  aria-label="Rotate 45° clockwise"
                  onClick={() => onRotate?.(45)}
                >
                  <RotateCw size={13} />
                  45°
                </button>
              </HoverCard>
            </div>
            <Slider.Root
              className="sel-slider"
              min={-180}
              max={180}
              step={1}
              value={[customAngle]}
              onValueChange={([v]) => {
                const delta = v - customAngle;
                setCustomAngle(v);
                if (delta !== 0) onRotate?.(delta);
              }}
            >
              <Slider.Track className="sel-slider-track">
                <Slider.Range className="sel-slider-range" />
              </Slider.Track>
              <Slider.Thumb className="sel-slider-thumb" aria-label="Rotation angle" />
            </Slider.Root>
            <div className="sel-rotate-labels">
              <span>-180°</span>
              <span className="sel-rotate-current">{Math.round(customAngle)}°</span>
              <span>180°</span>
            </div>
            <div className="sel-divider sel-divider-spaced" />
            <button
              type="button"
              className="sel-toolbox-row sel-action-row sel-wide-action"
              onClick={onResetRotation}
            >
              <Undo2 size={14} className="sel-action-icon" />
              Reset Rotation
              <kbd className="sel-kbd sel-kbd-auto">Ctrl+Shift+R</kbd>
            </button>
            <p className="sel-size-hint sel-size-hint-spaced">Or drag the rotate handle below selection</p>
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        {/* ── Crop ── */}
        <DropdownMenu.Root modal={false}>
          <HoverCard content="Crop" placement="above" sideOffset={6}>
            <DropdownMenu.Trigger asChild>
              <button type="button" className="sel-bar-btn" aria-label="Crop">
                <Crop size={16} />
              </button>
            </DropdownMenu.Trigger>
          </HoverCard>
          <DropdownMenu.Content className="sel-subpanel" align="start" sideOffset={8} {...dropdownContentProps}>
            <p className="sel-subpanel-title">Crop</p>
            <div className="sel-rotate-actions">
              <button
                type="button"
                className="sel-toolbox-row sel-action-row sel-wide-action"
                onClick={() => onTrim?.()}
              >
                <Crop size={14} className="sel-action-icon" />
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
          </DropdownMenu.Content>
        </DropdownMenu.Root>

        <div className="sel-bar-divider" />

        {/* ── Copy / Duplicate / Cut ── */}
        <HoverCard content="Copy (Ctrl+C)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn" aria-label="Copy (Ctrl+C)" onClick={onCopy}>
            <Copy size={16} />
          </button>
        </HoverCard>

        <HoverCard content="Duplicate (Ctrl+D)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn" aria-label="Duplicate (Ctrl+D)" onClick={onDuplicate}>
            <CopyPlus size={16} />
          </button>
        </HoverCard>

        <HoverCard content="Cut (Ctrl+X)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn" aria-label="Cut (Ctrl+X)" onClick={onCut}>
            <Scissors size={16} />
          </button>
        </HoverCard>

        <div className="sel-bar-divider" />

        {/* ── Group / Ungroup ── */}
        <HoverCard content="Group (Ctrl+G)" placement="above" sideOffset={6}>
          <button
            type="button"
            className={`sel-bar-btn ${selectedCount < 2 || isGrouped ? 'sel-bar-btn-disabled' : ''}`}
            aria-label="Group (Ctrl+G)"
            disabled={selectedCount < 2 || isGrouped}
            onClick={onGroup}
          >
            <Group size={16} />
          </button>
        </HoverCard>

        <HoverCard content="Ungroup (Ctrl+Shift+G)" placement="above" sideOffset={6}>
          <button
            type="button"
            className={`sel-bar-btn ${!isGrouped || selectedCount < 1 ? 'sel-bar-btn-disabled' : ''}`}
            aria-label="Ungroup (Ctrl+Shift+G)"
            disabled={!isGrouped || selectedCount < 1}
            onClick={onUngroup}
          >
            <Ungroup size={16} />
          </button>
        </HoverCard>

        <div className="sel-bar-divider" />

        {/* ── Delete / Deselect ── */}
        <HoverCard content="Delete (Del)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn sel-bar-btn-danger" aria-label="Delete (Del)" onClick={onDelete}>
            <Trash2 size={16} />
          </button>
        </HoverCard>

        <HoverCard content="Deselect (Esc)" placement="above" sideOffset={6}>
          <button type="button" className="sel-bar-btn" aria-label="Deselect (Esc)" onClick={onDeselect}>
            <X size={16} />
          </button>
        </HoverCard>
      </div>
    </div>
  );
};

export default SelectionToolbox;
