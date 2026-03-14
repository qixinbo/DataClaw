import { create } from 'zustand';

export interface VisualizationState {
  currentData: any[] | null;
  currentSQL: string | null;
  currentChartType: 'bar' | 'line';
  isLoading: boolean;
  error: string | null;
  setVisualization: (data: any[], sql: string) => void;
  setChartType: (type: 'bar' | 'line') => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  clearVisualization: () => void;
}

export const useVisualizationStore = create<VisualizationState>((set) => ({
  currentData: null,
  currentSQL: null,
  currentChartType: 'bar',
  isLoading: false,
  error: null,
  setVisualization: (data, sql) => set({ currentData: data, currentSQL: sql, error: null }),
  setChartType: (type) => set({ currentChartType: type }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error, isLoading: false }),
  clearVisualization: () => set({ currentData: null, currentSQL: null, error: null }),
}));
