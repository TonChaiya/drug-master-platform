/** A worksheet flattened to text cells. `null` means the cell was empty. */
export interface SheetGrid {
  sheetName: string;
  rows: (string | null)[][];
}

export function cellText(grid: SheetGrid, row: number, column: number): string {
  return grid.rows[row]?.[column]?.trim() ?? "";
}
