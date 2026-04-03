import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { DesktopWindowId, DesktopWindowLayout } from "./window-layout";

type DesktopWindowProps = {
  windowId: DesktopWindowId;
  title: string;
  subtitle?: string;
  layout: DesktopWindowLayout;
  interactive: boolean;
  className?: string;
  dataTestId?: string;
  onFocus: (windowId: DesktopWindowId) => void;
  onLayoutChange: (windowId: DesktopWindowId, nextLayout: DesktopWindowLayout) => void;
  children: ReactNode;
};

type WindowInteraction = {
  mode: "move" | "resize";
  startX: number;
  startY: number;
  startLayout: DesktopWindowLayout;
};

export function DesktopWindow({
  windowId,
  title,
  subtitle,
  layout,
  interactive,
  className,
  dataTestId,
  onFocus,
  onLayoutChange,
  children
}: DesktopWindowProps) {
  const interactionRef = useRef<WindowInteraction | null>(null);
  const previousUserSelectRef = useRef("");

  useEffect(() => {
    if (!interactive) {
      return;
    }

    const endInteraction = () => {
      if (!interactionRef.current) {
        return;
      }

      interactionRef.current = null;
      document.body.style.userSelect = previousUserSelectRef.current;
      document.body.style.cursor = "";
    };

    const handlePointerMove = (event: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) {
        return;
      }

      const deltaX = event.clientX - interaction.startX;
      const deltaY = event.clientY - interaction.startY;

      if (interaction.mode === "move") {
        onLayoutChange(windowId, {
          ...interaction.startLayout,
          x: interaction.startLayout.x + deltaX,
          y: interaction.startLayout.y + deltaY
        });
        return;
      }

      onLayoutChange(windowId, {
        ...interaction.startLayout,
        width: interaction.startLayout.width + deltaX,
        height: interaction.startLayout.height + deltaY
      });
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", endInteraction);
    window.addEventListener("pointercancel", endInteraction);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", endInteraction);
      window.removeEventListener("pointercancel", endInteraction);
      endInteraction();
    };
  }, [interactive, onLayoutChange, windowId]);

  const beginInteraction = (
    event: ReactPointerEvent<HTMLDivElement | HTMLButtonElement>,
    mode: WindowInteraction["mode"]
  ) => {
    if (!interactive) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onFocus(windowId);
    interactionRef.current = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startLayout: layout
    };
    previousUserSelectRef.current = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    document.body.style.cursor = mode === "move" ? "grabbing" : "nwse-resize";
  };

  const windowClassName = [
    "panel",
    "desktop-window",
    interactive ? "desktop-window-floating" : "desktop-window-static",
    className ?? ""
  ].filter(Boolean).join(" ");

  const windowStyle = interactive ? {
    left: `${layout.x}px`,
    top: `${layout.y}px`,
    width: `${layout.width}px`,
    height: `${layout.height}px`,
    zIndex: layout.zIndex
  } as CSSProperties : undefined;

  return (
    <section
      className={windowClassName}
      style={windowStyle}
      role="region"
      aria-label={title}
      data-testid={dataTestId}
      onPointerDownCapture={() => {
        if (interactive) {
          onFocus(windowId);
        }
      }}
    >
      <div
        className={interactive ? "desktop-window-titlebar desktop-window-titlebar-draggable" : "desktop-window-titlebar"}
        onPointerDown={(event) => beginInteraction(event, "move")}
      >
        <div className="desktop-window-titlecopy">
          <p className="desktop-window-kicker">sys.node::{windowId}</p>
          <h2>{title}</h2>
          {subtitle ? <p className="desktop-window-subtitle">{subtitle}</p> : null}
        </div>
        <div className="desktop-window-badges" aria-hidden="true">
          <span className="desktop-window-led" />
          <span className="desktop-window-chip">live</span>
        </div>
      </div>
      <div className="desktop-window-body">{children}</div>
      {interactive ? (
        <button
          type="button"
          className="desktop-window-resizer"
          aria-label={`Resize ${title}`}
          onPointerDown={(event) => beginInteraction(event, "resize")}
        />
      ) : null}
    </section>
  );
}