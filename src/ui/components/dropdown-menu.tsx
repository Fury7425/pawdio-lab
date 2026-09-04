import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChevronDown } from "lucide-react";

type DropdownMenuProps = {
  label: string;
  disabled?: boolean;
  children: ReactNode;
};

export function DropdownMenu({ label, disabled, children }: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  /** True when there is no room above the trigger and the menu drops down. */
  const [below, setBelow] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // The menu opens upward by default, which clips off the top of the window
  // when the trigger sits in a page header. Measure once per open and flip.
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = wrapperRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return;
    const room = trigger.getBoundingClientRect().top;
    setBelow(room < menu.offsetHeight + 12);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function handleOutside(event: MouseEvent) {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Escape is also the global `stop_test` binding. Closing this menu must
      // not abort the run behind it, so the event stops here.
      event.stopPropagation();
      setOpen(false);
    }

    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="dropdown-wrapper" ref={wrapperRef}>
      <button
        type="button"
        className="skin-btn secondary dropdown-trigger"
        disabled={disabled}
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
      >
        {label}
        <ChevronDown size={14} />
      </button>
      {open && (
        <div
          className={`dropdown-menu${below ? " is-below" : ""}`}
          role="menu"
          tabIndex={-1}
          ref={menuRef}
          onClick={() => setOpen(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") setOpen(false);
          }}
        >
          {children}
        </div>
      )}
    </div>
  );
}
