import { describe, expect, it } from 'vitest';
import { buildClusterCrosstab, buildClusterHeatmap } from '../clusterBreakdown';
import type { DataTable } from '../table';

const table: DataTable = {
  columns: ['Cluster', 'Species'],
  data: {
    Cluster: ['Cluster 1', 'Cluster 1', 'Cluster 2', 'Cluster 2', 'Cluster 2', 'Noise'],
    Species: ['setosa', 'setosa', 'setosa', 'virginica', 'virginica', 'virginica'],
  },
  nRows: 6,
};

describe('cluster composition heatmaps', () => {
  it('preserves counts and normalizes rows by cluster for % of cluster', () => {
    const cross = buildClusterCrosstab(table, 'Species')!;
    const heatmap = buildClusterHeatmap(cross, 'cluster');
    expect(heatmap.rowLabels).toEqual(['Cluster 1', 'Cluster 2', 'Noise']);
    expect(heatmap.columnLabels).toEqual(['setosa', 'virginica']);
    expect(heatmap.counts).toEqual([[2, 0], [1, 2], [0, 1]]);
    expect(heatmap.percentages[0]).toEqual([100, 0]);
    expect(heatmap.percentages[1][0]).toBeCloseTo(100 / 3, 12);
    expect(heatmap.percentages[1][1]).toBeCloseTo(200 / 3, 12);
    expect(heatmap.percentages[2]).toEqual([0, 100]);
  });

  it('changes the denominator for % of group', () => {
    const cross = buildClusterCrosstab(table, 'Species')!;
    const heatmap = buildClusterHeatmap(cross, 'group');
    expect(heatmap.rowLabels).toEqual(['setosa', 'virginica']);
    expect(heatmap.columnLabels).toEqual(['Cluster 1', 'Cluster 2', 'Noise']);
    expect(heatmap.counts).toEqual([[2, 1, 0], [0, 2, 1]]);
    expect(heatmap.percentages[0][0]).toBeCloseTo(200 / 3, 12);
    expect(heatmap.percentages[0][1]).toBeCloseTo(100 / 3, 12);
    expect(heatmap.percentages[0][2]).toBe(0);
    expect(heatmap.percentages[1][0]).toBe(0);
    expect(heatmap.percentages[1][1]).toBeCloseTo(200 / 3, 12);
    expect(heatmap.percentages[1][2]).toBeCloseTo(100 / 3, 12);
  });
});
