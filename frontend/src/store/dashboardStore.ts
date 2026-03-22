import { create } from 'zustand';
import type { ChartSpec } from './visualizationStore';

type ChartRow = Record<string, unknown>;
type GridLayout = { i: string; x: number; y: number; w: number; h: number };

export interface ChartConfig {
  id: string;
  title: string;
  type: 'bar' | 'line' | 'table';
  data: ChartRow[];
  sql: string;
  chartSpec?: ChartSpec | null;
  layout: GridLayout;
}

export interface DashboardConfig {
  id: string;
  name: string;
  createdAt: number;
  charts: ChartConfig[];
}

interface DashboardState {
  dashboards: DashboardConfig[];
  activeDashboardId: string | null;
  loadDashboards: (projectId: number) => void;
  createDashboard: (name: string, projectId: number) => string;
  deleteDashboard: (id: string, projectId: number) => void;
  renameDashboard: (id: string, newName: string, projectId: number) => void;
  setActiveDashboard: (id: string | null) => void;
  addChart: (chart: Omit<ChartConfig, 'layout'>, dashboardId: string, projectId: number) => void;
  removeChart: (chartId: string, dashboardId: string, projectId: number) => void;
  updateLayout: (layouts: GridLayout[], dashboardId: string, projectId: number) => void;
}

const DASHBOARD_STORAGE_KEY_PREFIX = 'dashboards_v2_project_';

function getStorageKey(projectId: number) {
  return `${DASHBOARD_STORAGE_KEY_PREFIX}${projectId}`;
}

function loadDashboardsFromStorage(projectId: number): DashboardConfig[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(getStorageKey(projectId));
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.map((d: any) => ({
          ...d,
          charts: Array.isArray(d.charts) ? d.charts.map((item: any) => ({
            ...item,
            layout: {
              i: item.layout?.i || item.id,
              x: Number.isFinite(item.layout?.x) ? item.layout.x : 0,
              y: Number.isFinite(item.layout?.y) ? item.layout.y : 0,
              w: Number.isFinite(item.layout?.w) ? item.layout.w : 4,
              h: Number.isFinite(item.layout?.h) ? item.layout.h : 4,
            },
          })) : []
        }));
      }
    }

    // Migration from v1
    const oldRaw = window.localStorage.getItem(`dashboard_charts_v1_project_${projectId}`);
    if (oldRaw) {
      const parsed = JSON.parse(oldRaw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const defaultDashboard: DashboardConfig = {
          id: 'default',
          name: 'Default Dashboard',
          createdAt: Date.now(),
          charts: parsed.map((item: any) => ({
            ...item,
            layout: {
              i: item.layout?.i || item.id,
              x: Number.isFinite(item.layout?.x) ? item.layout.x : 0,
              y: Number.isFinite(item.layout?.y) ? item.layout.y : 0,
              w: Number.isFinite(item.layout?.w) ? item.layout.w : 4,
              h: Number.isFinite(item.layout?.h) ? item.layout.h : 4,
            },
          })),
        };
        saveDashboardsToStorage([defaultDashboard], projectId);
        return [defaultDashboard];
      }
    }
    return [];
  } catch {
    return [];
  }
}

function saveDashboardsToStorage(dashboards: DashboardConfig[], projectId: number) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(getStorageKey(projectId), JSON.stringify(dashboards));
}

export const useDashboardStore = create<DashboardState>((set) => ({
  dashboards: [],
  activeDashboardId: null,
  loadDashboards: (projectId) => {
    const dashboards = loadDashboardsFromStorage(projectId);
    set({ dashboards, activeDashboardId: dashboards.length > 0 ? dashboards[0].id : null });
  },
  createDashboard: (name, projectId) => {
    const newId = Date.now().toString();
    set((state) => {
      const newDashboard: DashboardConfig = {
        id: newId,
        name,
        createdAt: Date.now(),
        charts: [],
      };
      const nextDashboards = [...state.dashboards, newDashboard];
      saveDashboardsToStorage(nextDashboards, projectId);
      return { dashboards: nextDashboards, activeDashboardId: newId };
    });
    return newId;
  },
  deleteDashboard: (id, projectId) => set((state) => {
    const nextDashboards = state.dashboards.filter((d) => d.id !== id);
    saveDashboardsToStorage(nextDashboards, projectId);
    return {
      dashboards: nextDashboards,
      activeDashboardId: state.activeDashboardId === id ? (nextDashboards.length > 0 ? nextDashboards[0].id : null) : state.activeDashboardId,
    };
  }),
  renameDashboard: (id, newName, projectId) => set((state) => {
    const nextDashboards = state.dashboards.map((d) => d.id === id ? { ...d, name: newName } : d);
    saveDashboardsToStorage(nextDashboards, projectId);
    return { dashboards: nextDashboards };
  }),
  setActiveDashboard: (id) => set({ activeDashboardId: id }),
  addChart: (chart, dashboardId, projectId) => set((state) => {
    const nextDashboards = state.dashboards.map((d) => {
      if (d.id !== dashboardId) return d;
      const colSize = 4;
      const cols = 12 / colSize;
      const index = d.charts.length;
      const newLayout: GridLayout = {
        i: chart.id,
        x: (index % cols) * colSize,
        y: Math.floor(index / cols) * 4,
        w: colSize,
        h: 4,
      };
      return { ...d, charts: [...d.charts, { ...chart, layout: newLayout }] };
    });
    saveDashboardsToStorage(nextDashboards, projectId);
    return { dashboards: nextDashboards };
  }),
  removeChart: (chartId, dashboardId, projectId) => set((state) => {
    const nextDashboards = state.dashboards.map((d) => {
      if (d.id !== dashboardId) return d;
      return { ...d, charts: d.charts.filter((c) => c.id !== chartId) };
    });
    saveDashboardsToStorage(nextDashboards, projectId);
    return { dashboards: nextDashboards };
  }),
  updateLayout: (layouts, dashboardId, projectId) => set((state) => {
    const nextDashboards = state.dashboards.map((d) => {
      if (d.id !== dashboardId) return d;
      return {
        ...d,
        charts: d.charts.map((chart) => {
          const layout = layouts.find((l) => l.i === chart.id);
          return layout ? { ...chart, layout } : chart;
        })
      };
    });
    saveDashboardsToStorage(nextDashboards, projectId);
    return { dashboards: nextDashboards };
  }),
}));
