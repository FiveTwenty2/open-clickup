import { expect, it } from "vitest";
import { encodeCsv, parseCsv } from "@/lib/csv";

it("reads Excel-style CSV with quoted commas, escaped quotes, and embedded newlines", () => {
  expect(parseCsv('\uFEFFName,Description\r\n"Review, please","Line one\n""Line two"""\r\n'))
    .toEqual([["Name", "Description"], ["Review, please", 'Line one\n"Line two"']]);
});

it("rejects malformed CSV and oversized input by row count", () => {
  expect(() => parseCsv('Name\n"unclosed')).toThrow();
  expect(() => parseCsv("Name\nA\nB", 2)).toThrow("at most");
});

it("exports spreadsheet formulas as literal text", () => {
  expect(parseCsv(encodeCsv([["Name", "Hours"], ["=1+1", -1]])))
    .toEqual([["Name", "Hours"], ["'=1+1", "-1"]]);
});
