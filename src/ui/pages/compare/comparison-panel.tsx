import type { MeasurementRecord } from "../../model";
import { CompareCurves } from "./compare-curves";
import {
  CompareBalance,
  CompareCrosstalk,
  CompareLatency,
  CompareThd,
} from "./compare-metrics";

export type CompareEntry = {
  record: MeasurementRecord;
  deviceName: string;
  color: string;
};

/**
 * Renders the right comparison view for the selected records. All entries share
 * one `testType` (the library page shows one test type at a time). sweep_fr and
 * anc overlay as curves, the rest compare as metric tables. One entry shows
 * that measurement on its own.
 */
export function ComparisonPanel({
  entries,
  referenceId,
}: {
  entries: CompareEntry[];
  referenceId: number | null;
}) {
  if (entries.length === 0) return null;
  const testType = entries[0].record.testType;
  const referenceIndex = Math.max(
    0,
    entries.findIndex((entry) => entry.record.id === referenceId),
  );
  const props = { entries, referenceIndex };

  switch (testType) {
    case "sweep_fr":
    case "anc":
      return (
        <CompareCurves
          entries={entries}
          kind={testType}
          referenceIndex={referenceIndex}
        />
      );
    case "latency":
      return <CompareLatency {...props} />;
    case "thd":
      return <CompareThd {...props} />;
    case "balance":
      return <CompareBalance {...props} />;
    case "crosstalk":
      return <CompareCrosstalk {...props} />;
    default:
      return (
        <div className="empty-state">
          <span>
            &ldquo;{String(testType)}&rdquo; is a test this version no longer
            runs. Its records can still be exported.
          </span>
        </div>
      );
  }
}
