import type { ReactNode } from "react";

export { LabeledNumberInput, LabeledTextInput } from "./labeled-input";

type SelectOption = { value: string; label: string; disabled?: boolean };

type SelectFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: SelectOption[];
  disabled?: boolean;
  /** Custom <option> nodes when a flat options array isn't enough. */
  children?: ReactNode;
};

export function SelectField({
  label,
  value,
  onChange,
  options,
  disabled,
  children,
}: SelectFieldProps) {
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <select
        className="skin-select"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {options
          ? options.map((option) => (
              <option
                key={option.value}
                value={option.value}
                disabled={option.disabled}
              >
                {option.label}
              </option>
            ))
          : children}
      </select>
    </label>
  );
}

type RangeFieldProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  className?: string;
};

export function RangeField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  className,
}: RangeFieldProps) {
  return (
    <div className={`range-line ${className ?? ""}`.trim()}>
      <span className="field-label">{label}</span>
      <input
        className="skin-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span>{format ? format(value) : value}</span>
    </div>
  );
}

type CheckboxFieldProps = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
};

export function CheckboxField({
  label,
  checked,
  onChange,
  disabled,
}: CheckboxFieldProps) {
  return (
    <label className="toggle-line">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}
