import React from 'react';
import { money } from '../theme';
import { Slider, SliderAnchor } from './Slider';

/**
 * Price slider for counteroffers.
 *
 * The generic control plus the one thing this call site adds: ends labelled in
 * dollars, so the track shows where their offer sits, where your ask is, and
 * that values snap to prices a person would say out loud. See `Slider` for the
 * gesture handling and why it is hand-rolled.
 */
export function PriceSlider({
  min,
  max,
  step,
  value,
  onChange,
  minLabel,
  maxLabel,
}: {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (next: number) => void;
  minLabel?: string;
  maxLabel?: string;
}) {
  return (
    <Slider
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={onChange}
      minLabel={<SliderAnchor value={money(min)} label={minLabel} />}
      maxLabel={<SliderAnchor value={money(max)} label={maxLabel} align="flex-end" />}
    />
  );
}
