import { create } from 'zustand';

type ChartRow = Record<string, unknown>;
type GridLayout = { i: string; x: number; y: number; w: number; h: number };

export interface ChartConfig {
  id: string;
  title: string;
  type: 'bar' | 'line';
  data: ChartRow[];
  sql: string;
  layout: GridLayout;
}

interface DashboardState {
  charts: ChartConfig[];
  addChart: (chart: Omit<ChartConfig, 'layout'>) => void;
  removeChart: (id: string) => void;
  updateLayout: (layouts: GridLayout[]) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  charts: [],
  addChart: (chart) => set((state) => {
    const newLayout: GridLayout = {
      i: chart.id,
      x: (state.charts.length * 6) % 12,
      y: Infinity,
      w: 6,
      h: 8,
    };
    return { charts: [...state.charts, { ...chart, layout: newLayout }] };
  }),
  removeChart: (id) => set((state) => ({
    charts: state.charts.filter((c) => c.id !== id),
  })),
  updateLayout: (layouts) => set((state) => ({
    charts: state.charts.map((chart) => {
      const layout = layouts.find((l) => l.i === chart.id);
      return layout ? { ...chart, layout } : chart;
    }),
  })),
}));
