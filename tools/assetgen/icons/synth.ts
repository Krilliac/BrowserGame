/**
 * ASSET-ICON — packed item-icon sheet + cell map matching `item-icons.ts` (`ITEMS_SHEET` +
 * `ITEM_ICON_CELLS`). Parametric silhouettes per item type with a rarity-tinted border; packed into a
 * square-cell grid. The engine keeps its fail-soft fallback for unmapped ids, so partial maps are fine.
 */

import { Raster, type RGBA } from '../shared/raster.ts';
import { numToRgba, RARITY, shade } from '../shared/palette.ts';

export type IconKind =
  | 'sword'
  | 'axe'
  | 'bow'
  | 'staff'
  | 'shield'
  | 'helm'
  | 'chest'
  | 'potion'
  | 'scroll'
  | 'gem'
  | 'ring'
  | 'amulet';

const STEEL: RGBA = [200, 206, 214, 255];
const WOOD: RGBA = [120, 84, 50, 255];
const GOLD: RGBA = [220, 180, 70, 255];

function drawIcon(r: Raster, cell: number, kind: IconKind, rarity: keyof typeof RARITY): void {
  const c = cell / 2;
  const rim = numToRgba(RARITY[rarity] ?? RARITY.common!);
  // rarity ring
  r.ellipse(c, c, cell * 0.46, cell * 0.46, [rim[0], rim[1], rim[2], 60]);
  r.ellipse(c, c, cell * 0.46, cell * 0.46, [0, 0, 0, 0]);
  const gem: RGBA = [rim[0], rim[1], rim[2], 255];
  switch (kind) {
    case 'sword':
      r.line(c, cell * 0.82, c, cell * 0.24, cell * 0.05, STEEL);
      r.polygon(
        [
          [c - 2, cell * 0.24],
          [c + 2, cell * 0.24],
          [c, cell * 0.14],
        ],
        shade(STEEL, 0.2),
      );
      r.fillRect(c - cell * 0.16, cell * 0.74, cell * 0.32, cell * 0.05, GOLD); // guard
      r.disc(c, cell * 0.84, cell * 0.05, GOLD); // pommel
      break;
    case 'axe':
      r.line(c, cell * 0.85, c, cell * 0.2, cell * 0.045, WOOD);
      r.polygon(
        [
          [c, cell * 0.22],
          [c + cell * 0.28, cell * 0.3],
          [c + cell * 0.22, cell * 0.46],
          [c, cell * 0.42],
        ],
        STEEL,
      );
      break;
    case 'bow':
      for (let i = 0; i < 24; i++) {
        const a = -Math.PI / 2 + (i / 23 - 0.5) * Math.PI * 1.1;
        r.disc(
          c - cell * 0.1 + Math.cos(a) * cell * 0.34,
          c + Math.sin(a) * cell * 0.34,
          0.9,
          WOOD,
        );
      }
      r.line(c + cell * 0.2, cell * 0.2, c + cell * 0.2, cell * 0.8, 0.6, [230, 230, 230, 200]);
      break;
    case 'staff':
      r.line(c, cell * 0.88, c, cell * 0.22, cell * 0.045, WOOD);
      r.disc(c, cell * 0.2, cell * 0.1, gem);
      break;
    case 'shield':
      r.polygon(
        [
          [c, cell * 0.16],
          [cell * 0.82, cell * 0.3],
          [c, cell * 0.86],
          [cell * 0.18, cell * 0.3],
        ],
        shade(STEEL, -0.1),
      );
      r.polygon(
        [
          [c, cell * 0.26],
          [cell * 0.7, cell * 0.36],
          [c, cell * 0.74],
          [cell * 0.3, cell * 0.36],
        ],
        gem,
      );
      break;
    case 'helm':
      r.ellipse(c, c, cell * 0.3, cell * 0.26, shade(STEEL, -0.05));
      r.fillRect(c - cell * 0.04, c - cell * 0.2, cell * 0.08, cell * 0.4, [20, 20, 28, 255]); // visor slit
      break;
    case 'chest':
      r.fillRect(cell * 0.24, cell * 0.3, cell * 0.52, cell * 0.42, shade(STEEL, -0.08));
      r.fillRect(cell * 0.34, cell * 0.22, cell * 0.32, cell * 0.12, shade(STEEL, 0.1));
      break;
    case 'potion':
      r.fillRect(c - cell * 0.06, cell * 0.2, cell * 0.12, cell * 0.12, [220, 220, 230, 255]); // neck
      r.ellipse(c, cell * 0.6, cell * 0.22, cell * 0.24, [230, 230, 240, 120]); // glass
      r.ellipse(c, cell * 0.64, cell * 0.16, cell * 0.16, gem); // liquid
      break;
    case 'scroll':
      r.fillRect(cell * 0.26, cell * 0.28, cell * 0.48, cell * 0.44, [225, 210, 170, 255]);
      for (let i = 0; i < 3; i++)
        r.line(
          cell * 0.32,
          cell * (0.4 + i * 0.1),
          cell * 0.68,
          cell * (0.4 + i * 0.1),
          0.6,
          [120, 100, 70, 255],
        );
      break;
    case 'gem':
      r.polygon(
        [
          [c, cell * 0.22],
          [cell * 0.74, cell * 0.46],
          [c, cell * 0.78],
          [cell * 0.26, cell * 0.46],
        ],
        gem,
      );
      r.polygon(
        [
          [c, cell * 0.22],
          [cell * 0.74, cell * 0.46],
          [c, cell * 0.5],
        ],
        shade(gem, 0.25),
      );
      break;
    case 'ring':
      r.ellipse(c, cell * 0.6, cell * 0.2, cell * 0.2, GOLD);
      r.ellipse(c, cell * 0.6, cell * 0.12, cell * 0.12, [0, 0, 0, 0]);
      r.disc(c, cell * 0.38, cell * 0.08, gem);
      break;
    case 'amulet':
      for (let i = 0; i < 20; i++) {
        const a = (i / 20) * Math.PI - Math.PI;
        r.disc(c + Math.cos(a) * cell * 0.24, cell * 0.42 + Math.sin(a) * cell * 0.24, 0.8, GOLD);
      }
      r.disc(c, cell * 0.66, cell * 0.12, gem);
      break;
  }
}

export interface IconSheet {
  png: Uint8Array;
  manifest: { src: string; cell: number; cells: Record<string, { col: number; row: number }> };
}

/** Render a packed icon sheet for (itemId → kind, rarity) entries. */
export function synthIcons(
  src: string,
  cell: number,
  entries: Array<{ id: string; kind: IconKind; rarity: keyof typeof RARITY }>,
): IconSheet {
  const perRow = 8;
  const rows = Math.ceil(entries.length / perRow);
  const sheet = new Raster(perRow * cell, rows * cell);
  const cells: Record<string, { col: number; row: number }> = {};
  entries.forEach((e, i) => {
    const col = i % perRow;
    const row = Math.floor(i / perRow);
    const tile = new Raster(cell, cell);
    drawIcon(tile, cell, e.kind, e.rarity);
    sheet.paste(tile, col * cell, row * cell);
    cells[e.id] = { col, row };
  });
  return { png: sheet.toPng(), manifest: { src, cell, cells } };
}
