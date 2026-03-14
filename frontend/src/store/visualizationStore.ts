import { create } from 'zustand';

export interface ChartSpec {
  chart_type: string;
  title: string;
  x_axis: string;
  y_axis: string;
  color?: string;
  description?: string;
}

export interface VisualizationState {
  currentData: any[] | null;
  currentSQL: string | null;
  currentChartSpec: ChartSpec | null;
  isLoading: boolean;
  error: string | null;
  setVisualization: (data: any[], sql: string, chartSpec?: ChartSpec | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearVisualization: () => void;
}

export const useVisualizationStore = create<VisualizationState>((set) => ({
  currentData: null,
  currentSQL: null,
  currentChartSpec: null,
  isLoading: false,
  error: null,
  setVisualization: (data, sql, chartSpec = null) => set({ currentData: data, currentSQL: sql, currentChartSpec: chartSpec, error: null }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),
  clearVisualization: () => set({ currentData: null, currentSQL: null, currentChartSpec: null, error: null }),
}));
