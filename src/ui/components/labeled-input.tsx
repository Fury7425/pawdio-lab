import { ChangeEvent } from "react";

type LabeledNumberInputProps = {
  label: string;
  value: number;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  min?: number;
  max?: number;
  step?: number;
};

export function LabeledNumberInput({
  label,
  value,
  onChange,
  min,
  max,
  step,
}: LabeledNumberInputProps) {
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <input
        className="skin-input"
        type="number"
        value={value}
        onChange={onChange}
        min={min}
        max={max}
        step={step}
      />
    </label>
  );
}

type LabeledTextInputProps = {
  label: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
};

export function LabeledTextInput({
  label,
  value,
  onChange,
  placeholder,
}: LabeledTextInputProps) {
  return (
    <label className="field-row">
      <span className="field-label">{label}</span>
      <input
        className="skin-input"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
      />
    </label>
  );
}
