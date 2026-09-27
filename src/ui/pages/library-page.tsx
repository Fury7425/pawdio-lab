import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronRight,
  GitCompareArrows,
  Library as LibraryIcon,
  Pencil,
  Search,
  StickyNote,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  ANC_MODE_ORDERED,
  LIBRARY_TEST_LABELS,
  LIBRARY_TEST_ORDER,
  type LibraryTestType,
  type MeasurementRecord,
  type MeasurementSummary,
} from "../model";
import { deriveDeviceName } from "../hooks/use-results-log";
import { Modal } from "../components/modal";
import { ExportMenu } from "../components/export-menu";
import { EmptyState } from "../components/empty-state";
import { exportTimestampTag, objectsToCsv } from "../lib/export-files";
import {
  buildLibraryExport,
  findDeviceByName,
  formatCaptured,
  parseLibraryExport,
} from "../lib/library";
import { saveCsvFile, saveJsonFile } from "../lib/save-text";
import { usePawdioLabContext } from "../pawdio-context";
import { ComparisonPanel, type CompareEntry } from "./compare/comparison-panel";
import { ancCurve, sweepCurve, type Channel } from "./compare/compare-curves";
import { compareColor } from "./compare/compare-colors";

type SessionItem = {
  key: string;
  label: string;
  testType: LibraryTestType;
  payload: MeasurementRecord["payload"];
  defaultLabel: string;
  /** Device the result was measured on, when the results log recorded it. */
  deviceName?: string;
};

type SaveDraft = {
  key: string;
  testType: LibraryTestType;
  payload: MeasurementRecord["payload"];
  label: string;
  notes: string;
};

type PendingDelete =
  | { kind: "measurement"; id: number; name: string }
  | { kind: "device"; id: number; name: string; count: number };

/** Label for a stored test type, including ones this version no longer runs. */
function testLabel(testType: string): string {
  return LIBRARY_TEST_LABELS[testType as LibraryTestType] ?? testType;
}

function includesText(value: string | null | undefined, query: string) {
  return !!value && value.toLowerCase().includes(query);
}

export function LibraryPage() {
  const ctx = usePawdioLabContext();
  const { devices, measurements } = ctx.library;

  const [activeType, setActiveType] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Selection spans test types; only the active type's entries are compared,
  // so switching tabs and back keeps what was picked.
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [referenceId, setReferenceId] = useState<number | null>(null);
  const [recordsById, setRecordsById] = useState<
    Record<number, MeasurementRecord>
  >({});
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const [saveDraft, setSaveDraft] = useState<SaveDraft | null>(null);
  const [saveDeviceMode, setSaveDeviceMode] = useState<"existing" | "new">(
    "existing",
  );
  const [saveDeviceId, setSaveDeviceId] = useState<number | null>(null);
  const [saveDeviceName, setSaveDeviceName] = useState("");
  // Blocks a second click from saving the same measurement twice.
  const [saving, setSaving] = useState(false);
  const [savedKeys, setSavedKeys] = useState<Set<string>>(new Set());

  const [renameDraft, setRenameDraft] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [editDraft, setEditDraft] = useState<{
    id: number;
    label: string;
    notes: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Drop selections whose measurement was deleted (or whose device was removed).
  useEffect(() => {
    const present = new Set(measurements.map((s) => s.id));
    setSelectedIds((prev) => prev.filter((id) => present.has(id)));
  }, [measurements]);

  // Lazily fetch full records (with payload) for the current selection.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const id of selectedIds) {
        if (recordsById[id]) continue;
        const record = await ctx.library.getMeasurement(id);
        if (!cancelled && record) {
          setRecordsById((prev) => ({ ...prev, [id]: record }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // ctx.library identity changes each render; selection drives the fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds]);

  const deviceNames = useMemo(
    () => new Map(devices.map((d) => [d.id, d.name])),
    [devices],
  );
  const deviceName = (id: number) => deviceNames.get(id) ?? `Device ${id}`;

  const typeCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of measurements) {
      counts.set(s.testType, (counts.get(s.testType) ?? 0) + 1);
    }
    return counts;
  }, [measurements]);

  // Known types in a fixed order, then anything older versions saved.
  const tabs = useMemo(() => {
    const known = LIBRARY_TEST_ORDER.filter((t) => typeCounts.has(t));
    const other = Array.from(typeCounts.keys()).filter(
      (t) => !LIBRARY_TEST_ORDER.includes(t as LibraryTestType),
    );
    return [...known, ...other];
  }, [typeCounts]);

  const currentType =
    activeType && typeCounts.has(activeType) ? activeType : (tabs[0] ?? null);

  const totalsByDevice = useMemo(() => {
    const totals = new Map<number, number>();
    for (const s of measurements) {
      totals.set(s.deviceId, (totals.get(s.deviceId) ?? 0) + 1);
    }
    return totals;
  }, [measurements]);

  // Devices with measurements of the active type that match the search. A
  // device with nothing saved stays listed so it can still be renamed or
  // deleted.
  const deviceGroups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return devices
      .map((device) => {
        const ofType = measurements.filter(
          (s) => s.deviceId === device.id && s.testType === currentType,
        );
        const items =
          !q || includesText(device.name, q)
            ? ofType
            : ofType.filter(
                (s) => includesText(s.label, q) || includesText(s.notes, q),
              );
        return { device, items };
      })
      .filter(
        ({ device, items }) =>
          items.length > 0 || (!q && !totalsByDevice.get(device.id)),
      );
  }, [devices, measurements, currentType, query, totalsByDevice]);

  const visibleSelected = useMemo(() => {
    const byId = new Map(measurements.map((s) => [s.id, s]));
    return selectedIds.filter((id) => byId.get(id)?.testType === currentType);
  }, [selectedIds, measurements, currentType]);

  const colorOf = (id: number) => {
    const index = visibleSelected.indexOf(id);
    return index >= 0 ? compareColor(index) : undefined;
  };

  const entries: CompareEntry[] = useMemo(
    () =>
      visibleSelected.flatMap((id, index) => {
        const record = recordsById[id];
        return record
          ? [
              {
                record,
                deviceName: deviceNames.get(record.deviceId) ?? "Device",
                color: compareColor(index),
              },
            ]
          : [];
      }),
    [visibleSelected, recordsById, deviceNames],
  );
  const entriesReady =
    visibleSelected.length > 0 && entries.length === visibleSelected.length;
  const effectiveReferenceId = visibleSelected.includes(referenceId ?? -1)
    ? referenceId
    : (visibleSelected[0] ?? null);

  // Savable items from the current session: result buffer + latest latency +
  // current ANC captures. (Sweep FR results already live in the result buffer.)
  const sessionItems = useMemo(() => {
    const items: SessionItem[] = [];
    for (const entry of ctx.results) {
      const testType = entry.payload.test as LibraryTestType;
      const typeLabel = testLabel(testType);
      items.push({
        key: `res-${entry.id}`,
        label: `${typeLabel}${entry.deviceName ? ` · ${entry.deviceName}` : ""}`,
        testType,
        payload: entry.payload,
        defaultLabel: entry.label ?? "",
        deviceName: entry.deviceName,
      });
    }
    if (ctx.latencyReport) {
      items.push({
        key: `latency-${ctx.latencyReport.timestampUtc}`,
        label: "Latency · latest run",
        testType: "latency",
        payload: ctx.latencyReport,
        defaultLabel: "",
      });
    }
    const ancCaptured = ANC_MODE_ORDERED.filter(
      (m) => ctx.ancCaptures[m] !== undefined,
    );
    if (ancCaptured.length > 0) {
      items.push({
        key: `anc-${ancCaptured
          .map((m) => ctx.ancCaptures[m]?.timestamp)
          .join("|")}`,
        label: `ANC / Transparency · ${ancCaptured.length} capture${
          ancCaptured.length === 1 ? "" : "s"
        }`,
        testType: "anc",
        payload: ctx.ancCaptures,
        defaultLabel: "",
      });
    }
    return items;
  }, [ctx.results, ctx.latencyReport, ctx.ancCaptures]);

  const unsavedCount = sessionItems.filter((i) => !savedKeys.has(i.key)).length;

  function toggleSelect(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function clearSelection() {
    setSelectedIds((prev) => prev.filter((id) => !visibleSelected.includes(id)));
  }

  /** Newest measurement of the active type from every device on screen. */
  function selectLatestPerDevice() {
    const latest = deviceGroups.flatMap(({ items }) =>
      items.length > 0 ? [items[0].id] : [],
    );
    setSelectedIds((prev) => [
      ...prev.filter((id) => !visibleSelected.includes(id)),
      ...latest,
    ]);
  }

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openSave(item: SessionItem) {
    // Preselect the library device named like the current output device, so
    // repeat saves land under one device instead of spawning duplicates.
    const guess =
      item.deviceName ?? deriveDeviceName(ctx.settings, ctx.inventory);
    const derived = guess === "Unknown Device" ? "" : guess;
    const match = findDeviceByName(devices, derived);
    setSaveDraft({
      key: item.key,
      testType: item.testType,
      payload: item.payload,
      label: item.defaultLabel,
      notes: "",
    });
    setSaveDeviceMode(
      match || (!derived && devices.length > 0) ? "existing" : "new",
    );
    setSaveDeviceId(match?.id ?? devices[0]?.id ?? null);
    setSaveDeviceName(derived);
  }

  async function confirmSave() {
    if (!saveDraft || saving) return;
    setSaving(true);
    try {
      let deviceId = saveDeviceId;
      if (saveDeviceMode === "new") {
        const name = saveDeviceName.trim();
        if (!name) {
          ctx.setError("Enter a device name.");
          return;
        }
        // Typing an existing name files under that device.
        const existing = findDeviceByName(devices, name);
        const device = existing ?? (await ctx.library.createDevice(name));
        if (!device) return;
        deviceId = device.id;
      }
      if (deviceId == null) {
        ctx.setError("Select a device to save into.");
        return;
      }
      const record = await ctx.library.saveMeasurement({
        deviceId,
        testType: saveDraft.testType,
        label: saveDraft.label.trim() || undefined,
        notes: saveDraft.notes.trim() || undefined,
        payload: saveDraft.payload,
      });
      if (record) {
        setSavedKeys((prev) => new Set(prev).add(saveDraft.key));
        setRecordsById((prev) => ({ ...prev, [record.id]: record }));
        setActiveType(record.testType);
        setSaveDraft(null);
      }
    } finally {
      setSaving(false);
    }
  }

  async function confirmRename() {
    if (!renameDraft) return;
    const name = renameDraft.name.trim();
    if (!name) {
      ctx.setError("Enter a device name.");
      return;
    }
    await ctx.library.renameDevice(renameDraft.id, name);
    setRenameDraft(null);
  }

  async function confirmEdit() {
    if (!editDraft) return;
    const record = await ctx.library.updateMeasurement(
      editDraft.id,
      editDraft.label,
      editDraft.notes,
    );
    if (record) {
      setRecordsById((prev) => ({ ...prev, [record.id]: record }));
      setEditDraft(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "measurement") {
      await ctx.library.deleteMeasurement(pendingDelete.id);
    } else {
      await ctx.library.deleteDevice(pendingDelete.id);
    }
    setPendingDelete(null);
  }

  async function importFile(file: File) {
    setImporting(true);
    try {
      const records = parseLibraryExport(await file.text());
      if (records.length === 0) {
        ctx.setError("That library export has no measurements to import.");
        return;
      }
      const result = await ctx.library.importRecords(records);
      if (result && result.added > 0) setActiveType(records[0].testType);
    } catch (err) {
      ctx.setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }

  function exportSelectedJson() {
    return saveJsonFile(
      `library_${currentType ?? "records"}_${exportTimestampTag()}.json`,
      buildLibraryExport(entries, currentType),
    );
  }

  async function exportWholeLibrary() {
    const all: Array<{ record: MeasurementRecord; deviceName: string }> = [];
    for (const summary of measurements) {
      const record = await ctx.library.getMeasurement(summary.id);
      if (record) all.push({ record, deviceName: deviceName(record.deviceId) });
    }
    return saveJsonFile(
      `library_all_${exportTimestampTag()}.json`,
      buildLibraryExport(all, null),
    );
  }

  /**
   * Frequency/dB rows for the record types that carry a curve, so the CSV holds
   * the actual measurement instead of a JSON payload blob. sweep_fr exports
   * magnitude, anc exports attenuation against its own baseline mode.
   */
  function curveRowsFor(
    record: MeasurementRecord,
    name: string,
  ): Record<string, unknown>[] {
    const curve = (channel: Channel) =>
      record.testType === "sweep_fr"
        ? sweepCurve(record, channel)
        : record.testType === "anc"
          ? ancCurve(record, channel, null)
          : null;
    const left = curve("L");
    const right = curve("R");
    const freqs = left?.freqs ?? right?.freqs ?? [];
    return freqs.map((hz, index) => ({
      deviceName: name,
      id: record.id,
      testType: record.testType,
      label: record.label ?? null,
      capturedAt: record.capturedAt,
      frequencyHz: hz,
      leftDb: left?.values[index] ?? null,
      rightDb: right?.values[index] ?? null,
    }));
  }

  function exportSelectedCsv() {
    const filename = `library_${currentType ?? "records"}_${exportTimestampTag()}.csv`;
    const curveRows = entries.flatMap(({ record, deviceName: name }) =>
      curveRowsFor(record, name),
    );
    if (curveRows.length > 0) {
      return saveCsvFile(filename, objectsToCsv(curveRows));
    }
    const rows = entries.map(({ record, deviceName: name }) => ({
      deviceName: name,
      id: record.id,
      deviceId: record.deviceId,
      testType: record.testType,
      capturedAt: record.capturedAt,
      label: record.label ?? null,
      notes: record.notes ?? null,
      schemaVer: record.schemaVer,
      payload: record.payload,
    }));
    return saveCsvFile(filename, objectsToCsv(rows));
  }

  function renderRow(summary: MeasurementSummary) {
    const color = colorOf(summary.id);
    const selected = color !== undefined;
    const name = summary.label || "Untitled";
    return (
      <li
        key={summary.id}
        className={`lib-row${selected ? " is-selected" : ""}`}
      >
        <button
          type="button"
          className="lib-row-main"
          aria-pressed={selected}
          onClick={() => toggleSelect(summary.id)}
        >
          <span
            className="lib-dot"
            aria-hidden="true"
            style={
              selected ? { background: color, borderColor: color } : undefined
            }
          >
            {selected && <Check size={10} strokeWidth={3} />}
          </span>
          <span className="lib-row-text">
            <span className={`lib-row-label${summary.label ? "" : " is-untitled"}`}>
              {name}
            </span>
            <span className="lib-row-meta">
              {formatCaptured(summary.capturedAt)}
              {summary.notes && (
                <span className="lib-row-note" title={summary.notes}>
                  <StickyNote size={11} aria-hidden="true" />
                  Note
                </span>
              )}
            </span>
          </span>
        </button>
        <span className="lib-row-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label={`Edit ${name}`}
            title="Edit label and notes"
            onClick={() =>
              setEditDraft({
                id: summary.id,
                label: summary.label ?? "",
                notes: summary.notes ?? "",
              })
            }
          >
            <Pencil size={13} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-btn danger"
            aria-label={`Delete ${name}`}
            title="Delete measurement"
            onClick={() =>
              setPendingDelete({
                kind: "measurement",
                id: summary.id,
                name: summary.label || testLabel(summary.testType),
              })
            }
          >
            <Trash2 size={13} aria-hidden="true" />
          </button>
        </span>
      </li>
    );
  }

  const libraryEmpty = devices.length === 0 && measurements.length === 0;
  const notedEntries = entries.filter((e) => e.record.notes);

  return (
    <div className="page-stack library-page">
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) importFile(file);
        }}
      />

      {saveDraft && (
        <Modal
          open
          onClose={() => setSaveDraft(null)}
          title="Save to Library"
          footer={
            <>
              <button
                type="button"
                className="skin-btn secondary"
                onClick={() => setSaveDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="skin-btn"
                disabled={saving}
                onClick={() => {
                  confirmSave();
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 12 }}>
            Saving a {testLabel(saveDraft.testType)} measurement.
          </p>

          <label className="field-row" style={{ marginBottom: 10 }}>
            <span className="field-label">Device</span>
            {devices.length > 0 ? (
              <select
                className="skin-select"
                value={
                  saveDeviceMode === "new" ? "__new__" : String(saveDeviceId)
                }
                onChange={(e) => {
                  if (e.target.value === "__new__") {
                    setSaveDeviceMode("new");
                  } else {
                    setSaveDeviceMode("existing");
                    setSaveDeviceId(Number(e.target.value));
                  }
                }}
              >
                {devices.map((d) => (
                  <option key={d.id} value={String(d.id)}>
                    {d.name}
                  </option>
                ))}
                <option value="__new__">＋ New device…</option>
              </select>
            ) : (
              <span className="muted">First device: name it below.</span>
            )}
          </label>

          {saveDeviceMode === "new" && (
            <label className="field-row" style={{ marginBottom: 10 }}>
              <span className="field-label">New device name</span>
              <input
                className="skin-input"
                type="text"
                value={saveDeviceName}
                placeholder="e.g. AirPods Pro 2"
                onChange={(e) => setSaveDeviceName(e.target.value)}
              />
            </label>
          )}

          <label className="field-row" style={{ marginBottom: 10 }}>
            <span className="field-label">Label (optional)</span>
            <input
              className="skin-input"
              type="text"
              value={saveDraft.label}
              placeholder="e.g. ANC on, firmware 6.1"
              onChange={(e) =>
                setSaveDraft((prev) =>
                  prev ? { ...prev, label: e.target.value } : prev,
                )
              }
            />
          </label>

          <label className="field-row" style={{ marginBottom: 4 }}>
            <span className="field-label">Notes (optional)</span>
            <textarea
              className="skin-textarea"
              rows={3}
              value={saveDraft.notes}
              placeholder="Fit, ear tips, seal, anything that explains this result"
              onChange={(e) =>
                setSaveDraft((prev) =>
                  prev ? { ...prev, notes: e.target.value } : prev,
                )
              }
            />
          </label>
        </Modal>
      )}

      {editDraft && (
        <Modal
          open
          onClose={() => setEditDraft(null)}
          title="Edit Measurement"
          footer={
            <>
              <button
                type="button"
                className="skin-btn secondary"
                onClick={() => setEditDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="skin-btn"
                onClick={() => {
                  confirmEdit();
                }}
              >
                Save
              </button>
            </>
          }
        >
          <label className="field-row" style={{ marginBottom: 10 }}>
            <span className="field-label">Label</span>
            <input
              className="skin-input"
              type="text"
              value={editDraft.label}
              placeholder="e.g. Foam tips, deep fit"
              onChange={(e) =>
                setEditDraft((prev) =>
                  prev ? { ...prev, label: e.target.value } : prev,
                )
              }
            />
          </label>
          <label className="field-row" style={{ marginBottom: 4 }}>
            <span className="field-label">Notes</span>
            <textarea
              className="skin-textarea"
              rows={4}
              value={editDraft.notes}
              onChange={(e) =>
                setEditDraft((prev) =>
                  prev ? { ...prev, notes: e.target.value } : prev,
                )
              }
            />
          </label>
          <p className="muted compact-note">
            The measured data itself is never edited.
          </p>
        </Modal>
      )}

      {renameDraft && (
        <Modal
          open
          onClose={() => setRenameDraft(null)}
          title="Rename Device"
          footer={
            <>
              <button
                type="button"
                className="skin-btn secondary"
                onClick={() => setRenameDraft(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="skin-btn"
                onClick={() => {
                  confirmRename();
                }}
              >
                Save
              </button>
            </>
          }
        >
          <label className="field-row" style={{ marginBottom: 4 }}>
            <span className="field-label">Name</span>
            <input
              className="skin-input"
              type="text"
              value={renameDraft.name}
              onChange={(e) =>
                setRenameDraft((prev) =>
                  prev ? { ...prev, name: e.target.value } : prev,
                )
              }
            />
          </label>
        </Modal>
      )}

      {pendingDelete && (
        <Modal
          open
          onClose={() => setPendingDelete(null)}
          title={
            pendingDelete.kind === "device"
              ? "Delete Device"
              : "Delete Measurement"
          }
          footer={
            <>
              <button
                type="button"
                className="skin-btn secondary"
                onClick={() => setPendingDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="skin-btn danger"
                onClick={() => {
                  confirmDelete();
                }}
              >
                Delete
              </button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 12 }}>
            {pendingDelete.kind === "device" ? (
              <>
                Delete <strong>{pendingDelete.name}</strong> and its{" "}
                {pendingDelete.count} measurement
                {pendingDelete.count === 1 ? "" : "s"}? This cannot be undone.
              </>
            ) : (
              <>
                Delete <strong>{pendingDelete.name}</strong>? This cannot be
                undone.
              </>
            )}
          </p>
        </Modal>
      )}

      {sessionItems.length > 0 && (
        <section className="page-card lib-unsaved">
          <div className="lib-unsaved-head">
            <div>
              <h2 className="section-subheading">This session</h2>
              <p className="muted page-header-desc">
                {unsavedCount > 0
                  ? `${unsavedCount} result${unsavedCount === 1 ? "" : "s"} not in the library yet. Session results are lost when the app closes.`
                  : "Everything from this session is saved."}
              </p>
            </div>
          </div>
          <ul className="lib-unsaved-list">
            {sessionItems.map((item) => {
              const saved = savedKeys.has(item.key);
              return (
                <li key={item.key} className="lib-unsaved-item">
                  <span className="lib-unsaved-label">{item.label}</span>
                  {saved ? (
                    <span className="lib-saved-tag">
                      <Check size={13} aria-hidden="true" /> Saved
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="skin-btn secondary compact"
                      onClick={() => openSave(item)}
                    >
                      Save
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="page-card lib-shell">
        <header className="page-header">
          <div>
            <h2 className="section-heading">Library</h2>
            <p className="muted page-header-desc">
              {devices.length} device{devices.length === 1 ? "" : "s"} ·{" "}
              {measurements.length} measurement
              {measurements.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="page-header-actions">
            <button
              type="button"
              className="skin-btn secondary"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              title="Add measurements from a Pawdio Lab library export"
            >
              <Upload size={14} aria-hidden="true" />
              {importing ? "Importing…" : "Import"}
            </button>
            <ExportMenu
              label="Export"
              disabled={measurements.length === 0}
              items={[
                {
                  label: `Selected as JSON (${visibleSelected.length})`,
                  disabled: !entriesReady,
                  onSelect: () => ctx.run(exportSelectedJson()),
                },
                {
                  label: `Selected as CSV (${visibleSelected.length})`,
                  disabled: !entriesReady,
                  onSelect: () => ctx.run(exportSelectedCsv()),
                },
                {
                  label: "Whole library as JSON",
                  onSelect: () => ctx.run(exportWholeLibrary()),
                },
              ]}
            />
          </div>
        </header>

        {libraryEmpty ? (
          <EmptyState
            icon={<LibraryIcon size={28} aria-hidden="true" />}
            message="Your library is empty."
            hint="Run a test, then save it from the This session panel. Saved results stay across restarts and can be compared side by side. You can also import a library export."
          />
        ) : (
          <>
            {tabs.length > 0 && (
              <div
                className="lib-tabs"
                role="tablist"
                aria-label="Test type"
              >
                {tabs.map((type) => (
                  <button
                    key={type}
                    type="button"
                    role="tab"
                    aria-selected={type === currentType}
                    className={`lib-tab${type === currentType ? " is-active" : ""}`}
                    onClick={() => setActiveType(type)}
                  >
                    {testLabel(type)}
                    <span className="lib-tab-count">
                      {typeCounts.get(type)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="lib-layout">
              <aside className="lib-browser" aria-label="Saved measurements">
                <div className="lib-search">
                  <Search size={14} aria-hidden="true" />
                  <input
                    type="search"
                    className="skin-input"
                    value={query}
                    placeholder="Search devices, labels, notes"
                    aria-label="Search the library"
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <div className="lib-browser-actions">
                  <button
                    type="button"
                    className="chip-btn"
                    disabled={deviceGroups.every((g) => g.items.length === 0)}
                    onClick={selectLatestPerDevice}
                    title="Select the newest measurement from each device"
                  >
                    Latest per device
                  </button>
                  {visibleSelected.length > 0 && (
                    <button
                      type="button"
                      className="chip-btn"
                      onClick={clearSelection}
                    >
                      Clear ({visibleSelected.length})
                    </button>
                  )}
                </div>

                <div className="lib-list">
                  {deviceGroups.length === 0 && (
                    <p className="muted lib-list-empty">
                      Nothing matches &ldquo;{query}&rdquo;.
                    </p>
                  )}
                  {deviceGroups.map(({ device, items }) => {
                    const open = !collapsed.has(device.id);
                    return (
                      <section className="lib-device" key={device.id}>
                        <div className="lib-device-head">
                          <button
                            type="button"
                            className="lib-device-toggle"
                            aria-expanded={open}
                            onClick={() => toggleCollapse(device.id)}
                          >
                            <ChevronRight
                              size={14}
                              className="lib-chevron"
                              aria-hidden="true"
                            />
                            <span className="lib-device-name">
                              {device.name}
                            </span>
                            <span className="lib-count">{items.length}</span>
                          </button>
                          <span className="lib-row-actions">
                            <button
                              type="button"
                              className="icon-btn"
                              aria-label={`Rename device ${device.name}`}
                              title="Rename device"
                              onClick={() =>
                                setRenameDraft({
                                  id: device.id,
                                  name: device.name,
                                })
                              }
                            >
                              <Pencil size={13} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="icon-btn danger"
                              aria-label={`Delete device ${device.name}`}
                              title="Delete device and its measurements"
                              onClick={() =>
                                setPendingDelete({
                                  kind: "device",
                                  id: device.id,
                                  name: device.name,
                                  count: totalsByDevice.get(device.id) ?? 0,
                                })
                              }
                            >
                              <Trash2 size={13} aria-hidden="true" />
                            </button>
                          </span>
                        </div>
                        {open &&
                          (items.length === 0 ? (
                            <p className="muted lib-device-empty">
                              No measurements saved.
                            </p>
                          ) : (
                            <ul className="lib-rows">{items.map(renderRow)}</ul>
                          ))}
                      </section>
                    );
                  })}
                </div>
              </aside>

              <div className="lib-compare">
                {visibleSelected.length === 0 ? (
                  <EmptyState
                    icon={<GitCompareArrows size={28} aria-hidden="true" />}
                    message="Pick measurements to compare"
                    hint="Select one to inspect it, or two and more to see them together. Latest per device is a quick start."
                  />
                ) : (
                  <>
                    <div className="lib-compare-head">
                      <h3 className="section-subheading">
                        {visibleSelected.length === 1
                          ? testLabel(currentType ?? "")
                          : `Comparing ${visibleSelected.length} · ${testLabel(currentType ?? "")}`}
                      </h3>
                      {entries.length > 1 && (
                        <label className="chart-control-field">
                          <span className="muted">Reference</span>
                          <select
                            className="skin-select compact"
                            value={String(effectiveReferenceId)}
                            onChange={(e) =>
                              setReferenceId(Number(e.target.value))
                            }
                          >
                            {entries.map(({ record, deviceName: name }) => (
                              <option key={record.id} value={record.id}>
                                {name}
                                {record.label ? ` · ${record.label}` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>

                    <ul className="lib-chips" aria-label="Selected measurements">
                      {entries.map(({ record, deviceName: name, color }) => (
                        <li key={record.id} className="lib-chip">
                          <span
                            className="chart-swatch"
                            aria-hidden="true"
                            style={{ background: color }}
                          />
                          <span className="lib-chip-name">{name}</span>
                          <span className="lib-chip-meta">
                            {record.label || formatCaptured(record.capturedAt)}
                          </span>
                          <button
                            type="button"
                            className="lib-chip-remove"
                            aria-label={`Remove ${name} from the comparison`}
                            onClick={() => toggleSelect(record.id)}
                          >
                            <X size={12} aria-hidden="true" />
                          </button>
                        </li>
                      ))}
                    </ul>

                    {entriesReady ? (
                      <ComparisonPanel
                        entries={entries}
                        referenceId={effectiveReferenceId}
                      />
                    ) : (
                      <p className="muted lib-loading">Loading measurements…</p>
                    )}

                    {notedEntries.length > 0 && (
                      <ul className="lib-notes">
                        {notedEntries.map(({ record, deviceName: name, color }) => (
                          <li key={record.id}>
                            <span
                              className="chart-swatch"
                              aria-hidden="true"
                              style={{ background: color }}
                            />
                            <span>
                              <strong>{name}</strong> {record.notes}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                )}
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
