import { Text, TextField } from "@radix-ui/themes";
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
  step
}: LabeledNumberInputProps) {
  return (
    <label className="field-row">
      <Text size="2" color="gray">
        {label}
      </Text>
      <TextField.Root
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
  placeholder
}: LabeledTextInputProps) {
  return (
    <label className="field-row">
      <Text size="2" color="gray">
        {label}
      </Text>
      <TextField.Root value={value} onChange={onChange} placeholder={placeholder} />
    </label>
  );
}
