type ChipOption<K extends string> = { key: K; label: string };

type ChipGroupProps<K extends string> = {
  options: ReadonlyArray<ChipOption<K>>;
  selected: Readonly<Record<K, boolean>>;
  onToggle: (key: K) => void;
  ariaLabel?: string;
  className?: string;
};

export function ChipGroup<K extends string>({
  options,
  selected,
  onToggle,
  ariaLabel,
  className,
}: ChipGroupProps<K>) {
  return (
    <div
      className={`chip-row ${className ?? ""}`.trim()}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className={`chip-btn ${selected[option.key] ? "is-on" : ""}`.trim()}
          aria-pressed={selected[option.key]}
          onClick={() => onToggle(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
