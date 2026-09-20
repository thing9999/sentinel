"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * 네이티브 <dialog> 모달 공통 부분.
 * showModal() 로 top layer 에 올려 포커스 가둠·배경 inert 를 브라우저가 처리한다.
 * Esc(cancel) 와 배경 클릭은 onClose 로만 알린다(열림 상태는 호출 측이 제어).
 */
export function ModalBase({
  open,
  onClose,
  className,
  labelledBy,
  describedBy,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  labelledBy: string;
  describedBy?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement | null>(null);
  const onCloseRef = useRef(onClose);
  useLayoutEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      const opener = document.activeElement as HTMLElement | null;
      if (typeof el.showModal === "function") el.showModal();
      else el.setAttribute("open", "");
      return () => {
        if (el.open) {
          if (typeof el.close === "function") el.close();
          else el.removeAttribute("open");
        }
        opener?.focus?.();
      };
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onCloseRef.current();
    };
    el.addEventListener("cancel", onCancel);
    return () => el.removeEventListener("cancel", onCancel);
  }, []);

  if (!open) return null;
  return (
    <dialog
      ref={ref}
      className={className}
      aria-labelledby={labelledBy}
      aria-describedby={describedBy}
      aria-modal="true"
      onKeyDown={(e) => {
        // showModal 이 없는 환경(jsdom 등)에서도 Esc 로 닫히게
        if (e.key === "Escape") {
          e.preventDefault();
          onCloseRef.current();
        }
      }}
      onClick={(e) => {
        // 배경(::backdrop) 클릭은 dialog 자신이 target 이 된다
        if (e.target === e.currentTarget) onCloseRef.current();
      }}
    >
      {children}
    </dialog>
  );
}
