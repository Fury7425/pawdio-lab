import { useEffect, useRef, type ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Accessible dialog name when no visible title is rendered. */
  ariaLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeOnOverlay?: boolean;
  className?: string;
};

const FOCUSABLE_SELECTOR =
  'input, select, textarea, button, [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  ariaLabel,
  children,
  footer,
  closeOnOverlay = false,
  className,
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  // Keep the latest onClose in a ref so the focus/escape effect only runs on
  // open/close transitions, not on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const firstFocusable = box?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? box)?.focus();

    function handleKeydown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      // Cycle Tab focus inside the dialog.
      if (event.key === "Tab" && boxRef.current) {
        const focusables = Array.from(
          boxRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusables.length === 0) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        const atStart = active === first || active === boxRef.current;
        if (event.shiftKey && atStart) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }

    document.addEventListener("keydown", handleKeydown);
    return () => {
      document.removeEventListener("keydown", handleKeydown);
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onMouseDown={
        closeOnOverlay
          ? (event) => {
              if (event.target === event.currentTarget) onClose();
            }
          : undefined
      }
    >
      <div
        className={`modal-box${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? ariaLabel ?? "Dialog"}
        ref={boxRef}
        tabIndex={-1}
      >
        {title && (
          <h3 className="section-heading" style={{ marginBottom: 12 }}>
            {title}
          </h3>
        )}
        {children}
        {footer && <div className="modal-actions">{footer}</div>}
      </div>
    </div>
  );
}
