/**
 * Vertical drag handle used to resize the docked right work panel.
 * Ported in spirit from workagent's `workspace/panels.tsx`.
 */
export function PanelResizeHandle({
  width,
  min,
  max,
  onResize,
}: {
  width: number;
  min: number;
  max: number;
  onResize: (width: number) => void;
}) {
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(max, Math.max(min, startWidth - (moveEvent.clientX - startX)));
      onResize(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="调整工作区宽度"
      className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-[var(--accent-soft)]"
      onPointerDown={onPointerDown}
    />
  );
}
