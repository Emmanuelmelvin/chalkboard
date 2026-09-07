/**
 * @file Slider.tsx
 * @description Astryx Slider component implementation.
 * Complies with Astryx Design System (https://astryx.atmeta.com/components/Slider)
 * built on top of Radix UI Slider primitive.
 */

import React from 'react';
import * as RadixSlider from '@radix-ui/react-slider';
import '@/styles/Slider.css';

export interface SliderProps {
  value?: number | number[];
  defaultValue?: number | number[];
  onChange?: (value: number) => void;
  onValueChange?: (value: number[]) => void;
  min?: number;
  max?: number;
  step?: number;
  label?: string | React.ReactNode;
  showValue?: boolean;
  formatValue?: (value: number) => string;
  showInput?: boolean;
  disabled?: boolean;
  orientation?: 'horizontal' | 'vertical';
  className?: string;
  style?: React.CSSProperties;
  'aria-label'?: string;
}

/**
 * Astryx Slider component with track, range, draggable thumb, and optional numerical input.
 */
export const Slider: React.FC<SliderProps> & {
  Root: typeof RadixSlider.Root;
  Track: typeof RadixSlider.Track;
  Range: typeof RadixSlider.Range;
  Thumb: typeof RadixSlider.Thumb;
} = ({
  value,
  defaultValue,
  onChange,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  label,
  showValue = false,
  formatValue,
  showInput = false,
  disabled = false,
  orientation = 'horizontal',
  className = '',
  style,
  'aria-label': ariaLabel,
}) => {
  // Normalize value to array for Radix Slider
  const currentValArray: number[] = Array.isArray(value)
    ? value
    : typeof value === 'number'
    ? [value]
    : typeof defaultValue === 'number'
    ? [defaultValue]
    : Array.isArray(defaultValue)
    ? defaultValue
    : [min];

  const primaryValue = currentValArray[0] ?? min;

  const handleRadixValueChange = (vals: number[]) => {
    onValueChange?.(vals);
    if (vals.length > 0 && onChange) {
      onChange(vals[0]);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    let num = parseFloat(e.target.value);
    if (isNaN(num)) num = min;
    num = Math.min(max, Math.max(min, num));
    onChange?.(num);
    onValueChange?.([num]);
  };

  const formattedDisplay = formatValue
    ? formatValue(primaryValue)
    : `${primaryValue}`;

  return (
    <div className={`astryx-slider-container ${className}`} style={style}>
      {(label || showValue) && (
        <div className="astryx-slider-header">
          {label && <span className="astryx-slider-label">{label}</span>}
          {showValue && <span className="astryx-slider-value">{formattedDisplay}</span>}
        </div>
      )}

      <div className="astryx-slider-control-row">
        <RadixSlider.Root
          className="astryx-slider-root"
          value={currentValArray}
          onValueChange={handleRadixValueChange}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          orientation={orientation}
          aria-label={typeof label === 'string' ? label : ariaLabel}
        >
          <RadixSlider.Track className="astryx-slider-track">
            <RadixSlider.Range className="astryx-slider-range" />
          </RadixSlider.Track>
          {currentValArray.map((_, i) => (
            <RadixSlider.Thumb
              key={i}
              className="astryx-slider-thumb"
              aria-label={typeof label === 'string' ? label : ariaLabel}
            />
          ))}
        </RadixSlider.Root>

        {showInput && (
          <input
            type="number"
            className="astryx-slider-number-input"
            min={min}
            max={max}
            step={step}
            value={primaryValue}
            onChange={handleInputChange}
            disabled={disabled}
            aria-label={typeof label === 'string' ? `${label} input` : 'Value input'}
          />
        )}
      </div>
    </div>
  );
};

Slider.Root = RadixSlider.Root;
Slider.Track = RadixSlider.Track;
Slider.Range = RadixSlider.Range;
Slider.Thumb = RadixSlider.Thumb;

export default Slider;
