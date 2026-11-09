import React, { useState } from "react";
import { expandPinnedText, pinnedTextParts } from "./pinnedText.js";

export function PinnedText({ text, variables }: { text?: string; variables?: Record<string, string> }) {
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);
  if (!text?.trim()) return null;
  async function copy(path: string) {
    try {
      await navigator.clipboard.writeText(path);
      setFailed(false); setStatus("Скопировано");
    } catch { setFailed(true); setStatus("Нет доступа к буферу обмена."); }
  }
  return <section className="pinned-text" aria-label="Закреплённый текст">
    <div className="pinned-text-content">{pinnedTextParts(expandPinnedText(text, variables)).map((part, index) => part.kind === "text" ? <React.Fragment key={index}>{part.text}</React.Fragment> :
      part.kind === "url" ? <a key={index} href={part.text} target="_blank" rel="noopener noreferrer">{part.text}</a> :
        <button key={index} type="button" className="pinned-path" title="Копировать путь" onClick={() => void copy(part.text)}>{part.text}</button>)}</div>
    <div className={`pinned-text-status${failed ? " failed" : ""}`} role="status" aria-live="polite">{status}</div>
  </section>;
}
