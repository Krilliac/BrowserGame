import { describe, expect, it } from 'vitest';

import { SKILL_TREE, skillNode } from '../shared/skilltree.js';
import { skillNodeLayout } from './skilltree-panel.js';

/** Infer a node's branch column key from its id prefix (mirrors the panel's own grouping). */
function branchKey(nodeId: string): string {
  return nodeId.split('-')[0] ?? nodeId;
}

const VIEWPORTS = [
  { w: 1280, h: 720 }, // desktop
  { w: 800, h: 600 }, // small window
  { w: 390, h: 844 }, // phone portrait (forces a fit-to-viewport scale down)
];

describe('skillNodeLayout', () => {
  for (const view of VIEWPORTS) {
    describe(`viewport ${view.w}x${view.h}`, () => {
      const layout = skillNodeLayout(view);

      it('gives every SKILL_TREE node a box', () => {
        for (const node of SKILL_TREE) {
          expect(layout.has(node.id)).toBe(true);
        }
        expect(layout.size).toBe(SKILL_TREE.length);
      });

      it('keeps every box fully inside the viewport', () => {
        for (const box of layout.values()) {
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.y).toBeGreaterThanOrEqual(0);
          expect(box.x + box.w).toBeLessThanOrEqual(view.w);
          expect(box.y + box.h).toBeLessThanOrEqual(view.h);
          expect(box.w).toBeGreaterThan(0);
          expect(box.h).toBeGreaterThan(0);
        }
      });

      it('places nodes of the same branch in a shared column (same x)', () => {
        const xByBranch = new Map<string, number>();
        for (const node of SKILL_TREE) {
          const box = layout.get(node.id)!;
          const key = branchKey(node.id);
          const prior = xByBranch.get(key);
          if (prior === undefined) {
            xByBranch.set(key, box.x);
          } else {
            expect(box.x).toBeCloseTo(prior, 5);
          }
        }
        // The three branches must occupy three distinct columns.
        expect(new Set(xByBranch.values()).size).toBe(xByBranch.size);
      });

      it('places higher tiers strictly lower than tier 0 in the same branch', () => {
        for (const node of SKILL_TREE) {
          if (node.tier === 0) continue;
          const box = layout.get(node.id)!;
          const root = SKILL_TREE.find(
            (n) => n.tier === 0 && branchKey(n.id) === branchKey(node.id),
          );
          expect(root).toBeDefined();
          const rootBox = layout.get(root!.id)!;
          expect(box.y).toBeGreaterThan(rootBox.y);
        }
      });

      it('does not let boxes in the same column overlap vertically', () => {
        const byColumn = new Map<string, { y: number; h: number }[]>();
        for (const node of SKILL_TREE) {
          const box = layout.get(node.id)!;
          const key = branchKey(node.id);
          const arr = byColumn.get(key) ?? [];
          arr.push({ y: box.y, h: box.h });
          byColumn.set(key, arr);
        }
        for (const boxes of byColumn.values()) {
          boxes.sort((a, b) => a.y - b.y);
          for (let i = 1; i < boxes.length; i++) {
            const prev = boxes[i - 1]!;
            const cur = boxes[i]!;
            // Two boxes that share a tier row share a y; distinct rows must not overlap.
            if (cur.y !== prev.y) {
              expect(cur.y).toBeGreaterThanOrEqual(prev.y + prev.h);
            }
          }
        }
      });
    });
  }

  it('orders deeper tiers below shallower ones across the whole tree', () => {
    const layout = skillNodeLayout({ w: 1280, h: 720 });
    for (const node of SKILL_TREE) {
      const box = layout.get(node.id)!;
      for (const req of node.requires) {
        const parent = skillNode(req);
        expect(parent).toBeDefined();
        const parentBox = layout.get(req)!;
        // A prerequisite (lower tier) must sit above its dependant.
        expect(parentBox.y).toBeLessThan(box.y);
      }
    }
  });
});
