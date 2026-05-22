import * as XLSX from 'xlsx';
import { dateUsCompact } from '@/lib/formatters';
import type { Grain } from '@/lib/types';

export interface ExportSheet {
  name: string;
  // Each row is a flat object — keys become column headers, values become cells.
  rows: Array<Record<string, string | number>>;
}

const GRAIN_ZH: Record<Grain, string> = {
  city: '城市',
  region: '区域',
  store: '门店',
};

export function buildFilename(
  base: string,
  grain: Grain,
  startDate: string,
  endDate: string,
  ext: 'xlsx' | 'csv',
): string {
  return `${base}_${GRAIN_ZH[grain]}_${dateUsCompact(startDate)}_${dateUsCompact(endDate)}.${ext}`;
}

// Download as XLSX. SheetJS streams the binary directly to a Blob URL — no server round-trip.
export function downloadXlsx(sheets: ExportSheet[], filename: string): void {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.json_to_sheet(s.rows);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  XLSX.writeFile(wb, filename);
}

export function downloadCsv(sheet: ExportSheet, filename: string): void {
  const ws = XLSX.utils.json_to_sheet(sheet.rows);
  const csv = XLSX.utils.sheet_to_csv(ws);
  // Prepend a BOM so Excel opens UTF-8 Chinese correctly.
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
