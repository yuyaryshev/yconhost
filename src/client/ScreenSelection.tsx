import React, { useEffect, useRef, useState } from "react";

export interface ScreenSnapshot {
  text: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  background: string;
  foreground: string;
}

export function ScreenSelection({ snapshot, onClose }: { snapshot: ScreenSnapshot; onClose: () => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(true);
  const copying = useRef(false);
  const [error, setError] = useState("");
  useEffect(() => {
    mounted.current = true;
    textarea.current?.focus({ preventScroll: true });
    textarea.current?.setSelectionRange(0, 0);
    return () => { mounted.current = false; };
  }, []);

  const selectedText = () => {
    const field = textarea.current;
    return field ? snapshot.text.slice(field.selectionStart, field.selectionEnd) : "";
  };
  function close() { mounted.current = false; onClose(); }
  async function copySelection() {
    const text = selectedText();
    if (!text || copying.current) return;
    copying.current = true;
    try {
      await navigator.clipboard.writeText(text);
      if (mounted.current) close();
    } catch {
      if (mounted.current) setError("Нет доступа к буферу обмена.");
    } finally { copying.current = false; }
  }

  return <section className="screen-selection" role="region" aria-label="Выделение экрана"
    style={{ background: snapshot.background, color: snapshot.foreground }}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); }
    }}
    onKeyUp={(event) => event.stopPropagation()}
    onPointerDown={(event) => event.stopPropagation()}>
    <div className="screen-selection-toolbar">
      <span>Выделить</span>
      <button type="button" className="secondary-button" onMouseDown={(event) => event.preventDefault()} onClick={() => void copySelection()}>Копировать</button>
      <button type="button" className="secondary-button screen-selection-close" title="Закрыть выделение" aria-label="Закрыть выделение" onClick={close}>&#215;</button>
    </div>
    <textarea ref={textarea} className="screen-selection-text" aria-label="Текст текущего экрана" readOnly spellCheck={false}
      value={snapshot.text} style={{ fontFamily: snapshot.fontFamily, fontSize: snapshot.fontSize, lineHeight: `${snapshot.lineHeight}px` }}
      onPointerUp={(event) => { if (event.button === 0 && (event.pointerType === "mouse" || event.pointerType === "pen")) void copySelection(); }}
      onCopy={(event) => {
        const text = selectedText();
        if (!text) return;
        event.preventDefault();
        event.clipboardData.setData("text/plain", text);
        close();
      }} />
    {error ? <div className="screen-selection-error" role="alert">{error}</div> : null}
  </section>;
}
