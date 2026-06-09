import { useEffect, useMemo, useState } from "react";
import {
  ANC_MODE_ORDERED,
  COMPARABLE_TEST_TYPES,
  LIBRARY_TEST_LABELS,
  type LibraryTestType,
  type MeasurementRecord,
  type MeasurementSummary,
} from "../model";
import { deriveDeviceName } from "../hooks/use-results-log";
import { Modal } from "../components/modal";
import { PageHeader } from "../components/page-header";
import { usePawdioLabContext } from "../pawdio-context";
import { ComparisonPanel, type CompareEntry } from "./compare/comparison-panel";
import { compareColor } from "./compare/compare-colors";

type SaveDraft = {
  testType: LibraryTestType;
  payload: MeasurementRecord["payload"];
  label: string;
};

type PendingDelete =
  | { kind: "measurement"; id: number; name: string }
  | { kind: "device"; id: number; name: string; count: number };

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function LibraryPage() {
  const ctx = usePawdioLabContext();
  const { devices, measurements } = ctx.library;

  const [selectedIds, setSelectedIds] = useState<number[]>([]);
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

  const [renameDraft, setRenameDraft] = useState<{
    id: number;
    name: string;
  } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

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

  const measurementsByDevice = useMemo(() => {
    const map = new Map<number, MeasurementSummary[]>();
    for (const summary of measurements) {
      const arr = map.get(summary.deviceId);
      if (arr) arr.push(summary);
      else map.set(summary.deviceId, [summary]);
    }
    return map;
  }, [measurements]);

  const selectedType: LibraryTestType | null = useMemo(() => {
    if (selectedIds.length === 0) return null;
    const first = measurements.find((s) => s.id === selectedIds[0]);
    return first?.testType ?? null;
  }, [selectedIds, measurements]);

  const selectedEntries: CompareEntry[] = useMemo(() => {
    const out: CompareEntry[] = [];
    selectedIds.forEach((id, index) => {
      const record = recordsById[id];
      if (!record) return;
      const device = devices.find((d) => d.id === record.deviceId);
      out.push({
        record,
        deviceName: device?.name ?? `Device ${record.deviceId}`,
        color: compareColor(index),
      });
    });
    return out;
  }, [selectedIds, recordsById, devices]);

  // Savable items from the current session: result buffer + latest latency +
  // current ANC captures. (Sweep FR results already live in the result buffer.)
  const sessionItems = useMemo(() => {
    const items: Array<{
      key: string;
      label: string;
      testType: LibraryTestType;
      payload: MeasurementRecord["payload"];
      defaultLabel: string;
    }> = [];
    for (const entry of ctx.results) {
      const testType = entry.payload.test as LibraryTestType;
      const typeLabel = LIBRARY_TEST_LABELS[testType] ?? entry.payload.test;
      items.push({
        key: `res-${entry.id}`,
        label: `${typeLabel}${entry.deviceName ? ` · ${entry.deviceName}` : ""}`,
        testType,
        payload: entry.payload,
        defaultLabel: typeLabel,
      });
    }
    if (ctx.latencyReport) {
      items.push({
        key: "latency-current",
        label: "Latency (latest run)",
        testType: "latency",
        payload: ctx.latencyReport,
        defaultLabel: "Latency",
      });
    }
    const ancHasCapture = ANC_MODE_ORDERED.some(
      (m) => ctx.ancCaptures[m] !== undefined,
    );
    if (ancHasCapture) {
      items.push({
        key: "anc-current",
        label: "ANC captures (current session)",
        testType: "anc",
        payload: ctx.ancCaptures,
        defaultLabel: "ANC / Transparency",
      });
    }
    return items;
  }, [ctx.results, ctx.latencyReport, ctx.ancCaptures]);

  function canSelect(summary: MeasurementSummary): boolean {
    if (!COMPARABLE_TEST_TYPES.has(summary.testType)) return false;
    if (selectedType && summary.testType !== selectedType) return false;
    return true;
  }

  function toggleSelect(id: number) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function openSave(item: (typeof sessionItems)[number]) {
    setSaveDraft({
      testType: item.testType,
      payload: item.payload,
      label: item.defaultLabel,
    });
    setSaveDeviceMode(devices.length > 0 ? "existing" : "new");
    setSaveDeviceId(devices[0]?.id ?? null);
    setSaveDeviceName(deriveDeviceName(ctx.settings, ctx.inventory));
  }

  async function confirmSave() {
    if (!saveDraft) return;
    let deviceId = saveDeviceId;
    if (saveDeviceMode === "new") {
      const name = saveDeviceName.trim();
      if (!name) {
        ctx.setError("Enter a device name.");
        return;
      }
      const device = await ctx.library.createDevice(name);
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
      payload: saveDraft.payload,
    });
    if (record) setSaveDraft(null);
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

  async function confirmDelete() {
    if (!pendingDelete) return;
    if (pendingDelete.kind === "measurement") {
      await ctx.library.deleteMeasurement(pendingDelete.id);
    } else {
      await ctx.library.deleteDevice(pendingDelete.id);
    }
    setPendingDelete(null);
  }

  function renderGroups(list: MeasurementSummary[]) {
    const groups = new Map<LibraryTestType, MeasurementSummary[]>();
    for (const summary of list) {
      const arr = groups.get(summary.testType);
      if (arr) arr.push(summary);
      else groups.set(summary.testType, [summary]);
    }
    return Array.from(groups.entries()).map(([testType, items]) => (
      <div key={testType} style={{ marginTop: 8 }}>
        <h3 className="section-subheading">{LIBRARY_TEST_LABELS[testType]}</h3>
        {items.map((summary) => {
          const checked = selectedIds.includes(summary.id);
          const selectable = canSelect(summary);
          return (
            <div
              key={summary.id}
              className="section-header-row"
              style={{ padding: "4px 0" }}
            >
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  opacity: selectable || checked ? 1 : 0.45,
                }}
                title={
                  COMPARABLE_TEST_TYPES.has(summary.testType)
                    ? undefined
                    : "Comparison for this test type is coming soon"
                }
              >
                <input
                  type="checkbox"
                  disabled={!selectable && !checked}
                  checked={checked}
                  onChange={() => toggleSelect(summary.id)}
                />
                <span>
                  {summary.label || "(unlabeled)"}{" "}
                  <span className="muted">· {fmtDate(summary.capturedAt)}</span>
                </span>
              </label>
              <button
                type="button"
                className="skin-btn danger"
                onClick={() =>
                  setPendingDelete({
                    kind: "measurement",
                    id: summary.id,
                    name:
                      summary.label || LIBRARY_TEST_LABELS[summary.testType],
                  })
                }
              >
                Delete
              </button>
            </div>
          );
        })}
      </div>
    ));
  }

  return (
    <div className="page-stack">
      {/* Save modal */}
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
                onClick={() => {
                  confirmSave();
                }}
              >
                Save
              </button>
            </>
          }
        >
          <p className="muted" style={{ marginBottom: 12 }}>
            Saving a {LIBRARY_TEST_LABELS[saveDraft.testType]} measurement.
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
              <span className="muted">First device — name it below.</span>
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

          <label className="field-row" style={{ marginBottom: 4 }}>
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
        </Modal>
      )}

      {/* Rename modal */}
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

      {/* Delete confirm modal */}
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

      {/* Session strip */}
      <section className="page-card">
        <PageHeader
          title="Save to Library"
          description="Persist session results per device to compare them later."
        />
        {sessionItems.length === 0 ? (
          <div className="empty-state">
            <span>
              Run a test (Latency, Sweep FR, ANC…) then save it here to build a
              comparison library.
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sessionItems.map((item) => (
              <div key={item.key} className="section-header-row">
                <span style={{ fontSize: 13 }}>{item.label}</span>
                <button
                  type="button"
                  className="skin-btn"
                  onClick={() => openSave(item)}
                >
                  Save to Library
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Library browser */}
      <section className="page-card">
        <PageHeader
          title="Library"
          actions={
            selectedIds.length > 0 ? (
              <button
                type="button"
                className="skin-btn secondary"
                onClick={() => setSelectedIds([])}
              >
                Clear selection ({selectedIds.length})
              </button>
            ) : undefined
          }
        />

        {devices.length === 0 ? (
          <div className="empty-state">
            <span>No saved devices yet.</span>
          </div>
        ) : (
          devices.map((device) => {
            const list = measurementsByDevice.get(device.id) ?? [];
            const open = !collapsed.has(device.id);
            return (
              <section className="page-section" key={device.id}>
                <div className="section-header-row">
                  <button
                    type="button"
                    className="chip-btn"
                    aria-expanded={open}
                    onClick={() => toggleCollapse(device.id)}
                  >
                    {open ? "▾" : "▸"} {device.name}{" "}
                    <span className="muted">({list.length})</span>
                  </button>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="skin-btn secondary"
                      onClick={() =>
                        setRenameDraft({ id: device.id, name: device.name })
                      }
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      className="skin-btn danger"
                      onClick={() =>
                        setPendingDelete({
                          kind: "device",
                          id: device.id,
                          name: device.name,
                          count: list.length,
                        })
                      }
                    >
                      Delete
                    </button>
                  </div>
                </div>
                {open &&
                  (list.length === 0 ? (
                    <p className="muted" style={{ marginTop: 8 }}>
                      No measurements saved for this device.
                    </p>
                  ) : (
                    renderGroups(list)
                  ))}
              </section>
            );
          })
        )}
      </section>

      {/* Comparison */}
      {selectedEntries.length >= 2 && selectedType && (
        <section className="page-card">
          <h2 className="section-heading">
            Comparison · {LIBRARY_TEST_LABELS[selectedType]}
          </h2>
          <ComparisonPanel entries={selectedEntries} />
        </section>
      )}
    </div>
  );
}
