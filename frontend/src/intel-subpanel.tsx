import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";

type IntelSubpanelProps = {
  title: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  children: ReactNode;
  dataTestId?: string;
};

export function IntelSubpanel({
  title,
  isExpanded,
  onToggleExpanded,
  children,
  dataTestId
}: IntelSubpanelProps) {
  const bodyId = useId();
  const bodyShellRef = useRef<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  useEffect(() => {
    const shell = bodyShellRef.current;
    if (!shell) {
      return;
    }

    const updateHeight = () => {
      setBodyHeight(shell.scrollHeight);
    };

    updateHeight();

    if (typeof ResizeObserver !== "undefined") {
      const resizeObserver = new ResizeObserver(() => {
        updateHeight();
      });
      resizeObserver.observe(shell);

      return () => {
        resizeObserver.disconnect();
      };
    }

    window.addEventListener("resize", updateHeight);

    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, [children]);

  const bodyWrapStyle = {
    maxHeight: isExpanded ? `${bodyHeight}px` : "0px"
  } as CSSProperties;

  return (
    <section
      className={isExpanded ? "intel-subpanel intel-subpanel-expanded" : "intel-subpanel intel-subpanel-collapsed"}
      data-testid={dataTestId}
    >
      <div className="intel-subpanel-header">
        <p className="intel-subpanel-title">{title}</p>
        <button
          type="button"
          className="desktop-window-collapse intel-subpanel-toggle"
          aria-controls={bodyId}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${title}`}
          onClick={onToggleExpanded}
        >
          {isExpanded ? "-" : "+"}
        </button>
      </div>

      <div
        className="intel-subpanel-body-wrap"
        id={bodyId}
        aria-hidden={!isExpanded}
        style={bodyWrapStyle}
      >
        <div className="intel-subpanel-body-shell" ref={bodyShellRef}>
          <div className="intel-subpanel-body">{children}</div>
        </div>
      </div>
    </section>
  );
}