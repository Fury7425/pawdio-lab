import { LIBRARY_TEST_LABELS, type MeasurementRecord } from "../../model";
import { CompareCurves } from "./compare-curves";
import { CompareLatency } from "./compare-latency";

export type CompareEntry = {
  record: MeasurementRecord;
  deviceName: string;
  color: string;
};

/**
 * Renders the right comparison view for the selected records. All entries share
 * one `testType` (enforced by the library page's selection model). sweep_fr/anc
 * overlay as curves, latency as a metric table; other types are saved but get a
 * "coming soon" placeholder in v1.
 */
export function ComparisonPanel({ entries }: { entries: CompareEntry[] }) {
  if (entries.length < 2) return null;
  const testType = entries[0].record.testType;

  if (testType === "sweep_fr" || testType === "anc") {
    return <CompareCurves entries={entries} kind={testType} />;
  }
  if (testType === "latency") {
    return <CompareLatency entries={entries} />;
  }
  return (
    <div className="empty-state">
      <span>
        Side-by-side comparison for {LIBRARY_TEST_LABELS[testType]} is coming
        soon. These records are saved and will compare once the table view
        ships.
      </span>
    </div>
  );
}
