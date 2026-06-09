import { DropdownMenu } from "./dropdown-menu";

export type ExportMenuItem = {
  label: string;
  onSelect: () => void;
  disabled?: boolean;
};

type ExportMenuProps = {
  label?: string;
  disabled?: boolean;
  items: ExportMenuItem[];
};

export function ExportMenu({
  label = "Export",
  disabled,
  items,
}: ExportMenuProps) {
  return (
    <DropdownMenu label={label} disabled={disabled}>
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          className="dropdown-item"
          disabled={item.disabled}
          onClick={item.onSelect}
        >
          {item.label}
        </button>
      ))}
    </DropdownMenu>
  );
}
