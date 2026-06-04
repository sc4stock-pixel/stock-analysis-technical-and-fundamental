"use client";

import { useEffect, useRef, useState } from "react";
import { getPanelMeta } from "@/lib/panelMeta";

/**
 * Small ℹ️ affordance shown next to a panel title.
 * Click/tap toggles a popover with the panel's meaning + cadence.
 * Closes on Esc, outside-click, or a second click. Tap-friendly (not hover-only).
 */
export default function InfoTooltip({ id }: { id: string }) {
  const meta = getPanelMeta(id);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!meta) return null;

  return (
    <span ref={wrapRef} className="relative inline-flex align-middle">
      <button
        type="button"
        aria-label={`About ${meta.label}`}
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className={`inline-flex h-[15px] w-[15px] items-center justify-center rounded-full border text-[9px] font-bold leading-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#00d4ff] ${
          open
            ? "border-[#00d4ff] text-[#00d4ff]"
            : "border-[#4a6080] text-[#6b85a0] hover:border-[#00d4ff] hover:text-[#00d4ff]"
        }`}
      >
        i
      </button>
      {open && (
        <span
          role="dialog"
          aria-label={meta.label}
          className="absolute left-[-8px] top-[22px] z-[95] w-[248px] rounded-[7px] border border-[#00d4ff] bg-[#0c1424] p-[10px_11px] shadow-[0_10px_30px_rgba(0,0,0,0.55)]"
        >
          <span className="mb-[5px] block text-[0.62rem] uppercase tracking-[0.1em] text-[#00d4ff]">
            {meta.label}
          </span>
          <span className="mb-[7px] block text-[0.72rem] leading-[1.45] text-[#c8d8f0]">
            {meta.meaning}
          </span>
          <span className="block border-t border-dashed border-[#1e2d4a] pt-[6px] text-[0.66rem] leading-[1.4] text-[#6b85a0]">
            ⏱ {meta.cadence}
          </span>
        </span>
      )}
    </span>
  );
}
