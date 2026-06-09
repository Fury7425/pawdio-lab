import { useEffect, useRef, type ReactNode } from "react";

type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  closeOnOverlay?: boolean;
};

const FOCUSABLE_SELECTOR =
  'input, select, textarea, button, [tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  closeOnOverlay = false,
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

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }

    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
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
        className="modal-box"
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
