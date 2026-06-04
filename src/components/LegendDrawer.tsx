"use client";

import { useEffect } from "react";
import { PANEL_META, FRESHNESS } from "@/lib/panelMeta";

/**
 * "How to read this dashboard" drawer. Closed by default; opened from the header button.
 * Renders the full legend (all panels + detail bullets) and the freshness table from panelMeta.
 * Side panel on desktop, bottom sheet under 680px (Tailwind `max-[680px]:` variants).
 */
export default function LegendDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 z-[90] bg-[rgba(3,7,16,0.62)] backdrop-blur-[2px] transition-opacity duration-200 ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      {/* drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="How to read this dashboard"
        className={`fixed right-0 top-0 z-[100] flex h-full w-[420px] max-w-[92vw] flex-col border-l border-[#00d4ff] bg-[#0f1629] shadow-[-18px_0_50px_rgba(0,0,0,0.5)] transition-transform duration-[260ms] ease-[cubic-bezier(0.4,0,0.2,1)] max-[680px]:bottom-0 max-[680px]:top-auto max-[680px]:h-[82vh] max-[680px]:w-full max-[680px]:max-w-full max-[680px]:rounded-t-[14px] max-[680px]:border-l-0 max-[680px]:border-t ${
          open
            ? "translate-x-0 max-[680px]:translate-y-0"
            : "translate-x-full max-[680px]:translate-x-0 max-[680px]:translate-y-full"
        }`}
      >
        <div className="flex flex-shrink-0 items-center justify-between border-b border-[#1e2d4a] px-4 py-3.5">
          <h3 className="m-0 text-[0.82rem] font-semibold tracking-[0.06em] text-[#00d4ff]">
            How to read this dashboard
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="h-[26px] w-[26px] rounded-[5px] border border-[#1e2d4a] bg-transparent text-[#6b85a0] hover:border-[#ff4757] hover:text-[#ff4757]"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 py-3.5">
          {PANEL_META.map((m) => (
            <div key={m.id} className="mb-4">
              <h4 className="m-0 mb-[3px] text-[0.72rem] uppercase tracking-[0.07em] text-[#c8d8f0]">
                {m.label}
              </h4>
              <div className="text-[0.72rem] leading-[1.45] text-[#6b85a0]">{m.meaning}</div>
              <div className="mt-[3px] text-[0.66rem] text-[#4a6080]">⏱ {m.cadence}</div>
              {m.detail && m.detail.length > 0 && (
                <ul className="mt-[7px] list-none p-0">
                  {m.detail.map((d, i) => (
                    <li key={i} className="pl-[2px] text-[0.69rem] leading-[1.6] text-[#6b85a0]">
                      {d}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}

          <div className="mt-1.5 border-t border-[#1e2d4a] pt-3">
            <h4 className="m-0 mb-[3px] text-[0.72rem] uppercase tracking-[0.07em] text-[#00d4ff]">
              Data freshness
            </h4>
            {FRESHNESS.map(([k, v]) => (
              <div
                key={k}
                className="flex justify-between border-b border-dashed border-[rgba(30,45,74,0.5)] py-[3px] text-[0.69rem]"
              >
                <span className="text-[#6b85a0]">{k}</span>
                <span className="text-[#c8d8f0]">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </aside>
    </>
  );
}
