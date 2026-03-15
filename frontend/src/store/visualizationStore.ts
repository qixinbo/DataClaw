import { create } from 'zustand';

export interface ChartSpec {
  $schema?: string;
  title?: string;
  description?: string;
  mark?: string | { type?: string; [key: string]: unknown };
  encoding?: Record<string, unknown>;
  transform?: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface ChartInfo {
  canVisualize: boolean;
  reasoning?: string;
  chartType?: string;
  description?: string;
}

export interface VisualizationState {
  currentData: any[] | null;
  currentSQL: string | null;
  currentChartSpec: ChartSpec | null;
  currentChartInfo: ChartInfo | null;
  isLoading: boolean;
  error: string | null;
  setVisualization: (data: any[], sql: string, chartSpec?: ChartSpec | null, chartInfo?: ChartInfo | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearVisualization: () => void;
}

export const useVisualizationStore = create<VisualizationState>((set) => ({
  currentData: null,
  currentSQL: null,
  currentChartSpec: null,
  currentChartInfo: null,
  isLoading: false,
  error: null,
  setVisualization: (data, sql, chartSpec = null, chartInfo = null) => set({
    currentData: data,
    currentSQL: sql,
    currentChartSpec: chartSpec,
    currentChartInfo: chartInfo,
    error: null,
  }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),
  clearVisualization: () => set({ currentData: null, currentSQL: null, currentChartSpec: null, currentChartInfo: null, error: null }),
}));
