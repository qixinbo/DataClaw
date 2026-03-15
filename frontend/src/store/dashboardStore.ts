import { create } from 'zustand';
import type { ChartSpec } from './visualizationStore';

type ChartRow = Record<string, unknown>;
type GridLayout = { i: string; x: number; y: number; w: number; h: number };

export interface ChartConfig {
  id: string;
  title: string;
  type: 'bar' | 'line';
  data: ChartRow[];
  sql: string;
  chartSpec?: ChartSpec | null;
  layout: GridLayout;
}

interface DashboardState {
  charts: ChartConfig[];
  addChart: (chart: Omit<ChartConfig, 'layout'>) => void;
  removeChart: (id: string) => void;
  updateLayout: (layouts: GridLayout[]) => void;
}

const DASHBOARD_STORAGE_KEY = 'dashboard_charts_v1';

function loadChartsFromStorage(): ChartConfig[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(DASHBOARD_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is ChartConfig => Boolean(item?.id && item?.layout))
      .map((item) => ({
        ...item,
        layout: {
          i: item.layout.i,
          x: Number.isFinite(item.layout.x) ? item.layout.x : 0,
          y: Number.isFinite(item.layout.y) ? item.layout.y : 0,
          w: Number.isFinite(item.layout.w) ? item.layout.w : 4,
          h: Number.isFinite(item.layout.h) ? item.layout.h : 4,
        },
      }));
  } catch {
    return [];
  }
}

function saveChartsToStorage(charts: ChartConfig[]) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify(charts));
}

export const useDashboardStore = create<DashboardState>((set) => ({
  charts: loadChartsFromStorage(),
  addChart: (chart) => set((state) => {
    const colSize = 4;
    const cols = 12 / colSize;
    const index = state.charts.length;
    const newLayout: GridLayout = {
      i: chart.id,
      x: (index % cols) * colSize,
      y: Math.floor(index / cols) * 4,
      w: colSize,
      h: 4,
    };
    const nextCharts = [...state.charts, { ...chart, layout: newLayout }];
    saveChartsToStorage(nextCharts);
    return { charts: nextCharts };
  }),
  removeChart: (id) => set((state) => ({
    charts: (() => {
      const nextCharts = state.charts.filter((c) => c.id !== id);
      saveChartsToStorage(nextCharts);
      return nextCharts;
    })(),
  })),
  updateLayout: (layouts) => set((state) => {
    const nextCharts = state.charts.map((chart) => {
      const layout = layouts.find((l) => l.i === chart.id);
      return layout ? { ...chart, layout } : chart;
    });
    saveChartsToStorage(nextCharts);
    return { charts: nextCharts };
  }),
}));
