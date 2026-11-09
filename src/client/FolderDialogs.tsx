import React, { useEffect, useState } from "react";
import { Button, Dialog, DialogDismiss, DialogHeading, useDialogStore } from "@ariakit/react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { colorHex, resolveConsoleBackground, standardColors } from "../shared/colors.js";
import type { FolderConfig, FolderField, FolderInfo } from "../server/folderTypes.js";

type DialogStore = ReturnType<typeof useDialogStore>;
type Theme = "dark" | "light";

export async function requestJson<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(url, { method, headers: body === undefined ? undefined : { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value as T;
}

export function ColorField({ name, label, value, theme, onChange }: { name: string; label: string; value: string; theme: Theme; onChange: (value: string) => void }) {
  const dialog = useDialogStore();
  const [draft, setDraft] = useState(value);
  const background = resolveConsoleBackground(value)?.[theme];
  return <div className="color-field">
    <span id={`${name}-label`}>{label}</span>
    <div className="color-field-value">
      <button type="button" className="color-swatch" style={{ background }} aria-label={`Choose ${label.toLowerCase()}`} title={value || "Default"} onClick={() => { setDraft(value); dialog.show(); }} />
      <code>{value || "Default"}</code>
    </div>
    <Dialog store={dialog} className="dialog color-dialog" backdrop={<div className="backdrop color-backdrop" />}>
      <DialogHeading className="dialog-title">{label}</DialogHeading>
      <div className="standard-colors" role="group" aria-label="Standard colors">
        {Object.keys(standardColors).map((preset) => <button key={preset} type="button" className="color-swatch" title={preset} aria-label={preset} aria-pressed={draft.toUpperCase().replace(/^STD_GR(?:AY|EY)$/, "STD_WHITE") === preset} style={{ background: resolveConsoleBackground(preset)?.[theme] }} onClick={() => setDraft(preset)} />)}
      </div>
      <output className="selected-color">{draft || "Default"}</output>
      <HexColorPicker color={colorHex(draft, theme)} onChange={setDraft} aria-label="Custom color" />
      <label>HEX<HexColorInput color={colorHex(draft, theme)} onChange={setDraft} prefixed aria-label="HEX color" /></label>
      <div className="dialog-actions">
        <Button className="secondary-button" onClick={() => setDraft("")}>Default</Button>
        <DialogDismiss className="secondary-button">Cancel</DialogDismiss>
        <Button className="primary-button" onClick={() => { onChange(draft); dialog.hide(); }}>Apply</Button>
      </div>
    </Dialog>
  </div>;
}

export function FolderEntryDialog({ dialog, project, id, theme, onSaved }: { dialog: DialogStore; project: string; id?: string; theme: Theme; onSaved: () => Promise<void> }) {
  const [fields, setFields] = useState<FolderField[]>([]);
  const [original, setOriginal] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState<string>();
  const [folderType, setFolderType] = useState<FolderConfig["type"]>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let disposed = false;
    requestJson<{ fields: FolderField[]; values: Record<string, string>; revision?: string; folder: FolderInfo }>(id ? `/api/consoles/${id}/entry` : `/api/projects/${encodeURIComponent(project)}/fields`)
      .then((form) => { if (!disposed) { setFields(form.fields); setOriginal(form.values); setValues(form.values); setRevision(form.revision); setFolderType(form.folder.type); } })
      .catch((reason: Error) => { if (!disposed) setError(reason.message); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [project, id]);
  async function save() {
    setSaving(true); setError("");
    try {
      await requestJson(id ? `/api/consoles/${id}/entry` : `/api/projects/${encodeURIComponent(project)}/entries`, id ? "PUT" : "POST", { values, revision });
      dialog.hide();
      await onSaved();
    } catch (reason) { setValues(original); setError((reason as Error).message); }
    finally { setSaving(false); }
  }
  return <Dialog store={dialog} className="dialog preferences-dialog folder-dialog" backdrop={<div className="backdrop" />}>
    <DialogHeading className="dialog-title">{id ? "Console settings" : "Add console"}</DialogHeading>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={loading || saving} className="settings-grid fields-grid">
        {fields.map((field) => field.type === "color" ? <ColorField key={field.name} name={field.name} label={field.label} theme={theme} value={values[field.name] ?? ""} onChange={(value) => { setError(""); setValues((current) => ({ ...current, [field.name]: value })); }} /> :
          folderType === "my_wins" && ["no_run", "ansiParserEnabled"].includes(field.name) ? <label key={field.name} className="checkbox-label"><input type="checkbox" checked={values[field.name] === "true"} onChange={(event) => setValues((current) => ({ ...current, [field.name]: String(event.target.checked) }))} />{field.name === "no_run" ? "no_run" : "ANSI parser"}</label> :
          field.multiline ? <label key={field.name}>{field.label}<textarea name={field.name} rows={4} maxLength={field.name === "pinned_text" ? 65536 : undefined} required={field.required} value={values[field.name] ?? ""} onChange={(event) => { setError(""); setValues((current) => ({ ...current, [field.name]: event.target.value })); }} /></label> :
          <label key={field.name}>{field.label}<input name={field.name} required={field.required} value={values[field.name] ?? ""} onChange={(event) => { setError(""); setValues((current) => ({ ...current, [field.name]: event.target.value })); }} /></label>)}
      </fieldset>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions"><DialogDismiss type="button" className="secondary-button" disabled={saving}>Cancel</DialogDismiss><Button type="submit" className="primary-button" disabled={loading || saving}>{saving ? "Saving..." : "Save"}</Button></div>
    </form>
  </Dialog>;
}

export function FolderSettingsDialog({ dialog, project, onSaved }: { dialog: DialogStore; project?: string; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<FolderConfig>({ name: "", type: "manual", intervalSeconds: 60, gatherErrors: true, closeRemoves: false });
  const [original, setOriginal] = useState<FolderInfo>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(project));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!project) return;
    let disposed = false;
    requestJson<FolderInfo>(`/api/projects/${encodeURIComponent(project)}/settings`)
      .then((folder) => { if (!disposed) { setDraft(folder); setOriginal(folder); } })
      .catch((reason: Error) => { if (!disposed) setError(reason.message); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [project]);
  const update = <K extends keyof FolderConfig>(key: K, value: FolderConfig[K]) => setDraft((current) => ({ ...current, [key]: value }));
  async function save() {
    const recreate = original && (draft.type !== original.type || draft.type === "scripted" && draft.scriptPath !== original.scriptPath || draft.type === "my_wins" && draft.projectPath !== original.projectPath);
    if (recreate && !window.confirm(`Recreate "${original.name}" with this source/type?\nOwned running consoles will be stopped. Source files and external processes will not be deleted.`)) return;
    setSaving(true); setError("");
    try {
      await requestJson(project ? `/api/projects/${encodeURIComponent(project)}/settings` : "/api/projects", project ? "PUT" : "POST", { ...draft, confirmed: Boolean(recreate) });
      dialog.hide();
      await onSaved();
    } catch (reason) { setError((reason as Error).message); }
    finally { setSaving(false); }
  }
  return <Dialog store={dialog} className="dialog preferences-dialog folder-dialog" backdrop={<div className="backdrop" />}>
    <DialogHeading className="dialog-title">{project ? "Folder settings" : "New folder"}</DialogHeading>
    <form onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset className="settings-grid fields-grid" disabled={loading || saving}>
        <label>Name<input required value={draft.name} disabled={Boolean(project)} onChange={(event) => update("name", event.target.value)} /></label>
        <label>Type<select value={draft.type} onChange={(event) => update("type", event.target.value as FolderConfig["type"])}><option value="manual">manual</option><option value="my_wins">my_wins</option><option value="scripted">scripted</option></select></label>
        {draft.type === "scripted" ? <label>JS file<input required value={draft.scriptPath ?? ""} onChange={(event) => update("scriptPath", event.target.value)} /></label> : null}
        {draft.type === "my_wins" ? <label>Project directory<input required value={draft.projectPath ?? ""} onChange={(event) => update("projectPath", event.target.value)} /></label> : null}
        {draft.type !== "manual" ? <label>Update interval (seconds; 0 = manual)<input type="number" min="0" max="86400" step="1" value={draft.intervalSeconds ?? 60} onChange={(event) => update("intervalSeconds", Number(event.target.value))} /></label> : null}
        <label className="checkbox-label"><input type="checkbox" checked={draft.gatherErrors !== false} onChange={(event) => update("gatherErrors", event.target.checked)} />Gather errors by default</label>
        {draft.type === "manual" ? <label className="checkbox-label"><input type="checkbox" checked={draft.closeRemoves === true} onChange={(event) => update("closeRemoves", event.target.checked)} />Remove slot on Close</label> : null}
      </fieldset>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="dialog-actions"><DialogDismiss type="button" className="secondary-button" disabled={saving}>Cancel</DialogDismiss><Button type="submit" className="primary-button" disabled={loading || saving}>{saving ? "Saving..." : "Save"}</Button></div>
    </form>
  </Dialog>;
}
