import { describe, expect, it } from "vitest";
import {
  csvCell,
  exportTimestampTag,
  objectsToCsv,
  rowsToCsv,
} from "../lib/export-files";

describe("export files", () => {
  it("quotes CSV punctuation and neutralizes spreadsheet formulas", () => {
    expect(csvCell('a,"b"')).toBe('"a,""b"""');
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell(-4)).toBe("-4");
  });

  it("writes rectangular rows with CRLF endings", () => {
    expect(rowsToCsv(["a", "b"], [[1], [2, 3]])).toBe(
      "a,b\r\n1,\r\n2,3\r\n",
    );
  });

  it("flattens objects while retaining arrays as JSON", () => {
    const csv = objectsToCsv([{ test: "fr", data: { points: [1, 2] } }]);
    expect(csv).toContain("test,data.points");
    expect(csv).toContain('fr,"[1,2]"');
  });

  it("creates stable timestamp tags", () => {
    expect(exportTimestampTag(new Date(2026, 6, 16, 9, 8, 7))).toBe(
      "20260716_090807",
    );
  });
});
