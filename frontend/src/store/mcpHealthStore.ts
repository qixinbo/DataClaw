import { create } from 'zustand';
import { api } from '@/lib/api';

interface MCPServerStatus {
  status?: string;
}

interface MCPHealthState {
  hasMcpError: boolean;
  currentProjectId: number | null;
  startPolling: (projectId: number | null) => void;
  stopPolling: () => void;
  refresh: (projectId?: number | null) => Promise<void>;
}

let pollingTimer: ReturnType<typeof setInterval> | null = null;

export const useMcpHealthStore = create<MCPHealthState>((set, get) => ({
  hasMcpError: false,
  currentProjectId: null,

  refresh: async (projectIdArg?: number | null) => {
    const projectId = projectIdArg ?? get().currentProjectId;
    if (!projectId) {
      set({ hasMcpError: false, currentProjectId: null });
      return;
    }
    try {
      const data = await api.get<MCPServerStatus[]>(`/api/v1/mcp?project_id=${projectId}`);
      const hasError = data.some((mcp) => Boolean(mcp.status && mcp.status.startsWith('error')));
      set({ hasMcpError: hasError, currentProjectId: projectId });
    } catch (error) {
      console.error('Failed to check MCP health', error);
      set({ hasMcpError: true, currentProjectId: projectId });
    }
  },

  startPolling: (projectId: number | null) => {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
    if (!projectId) {
      set({ hasMcpError: false, currentProjectId: null });
      return;
    }
    set({ currentProjectId: projectId });
    void get().refresh(projectId);
    pollingTimer = setInterval(() => {
      void get().refresh(projectId);
    }, 60000);
  },

  stopPolling: () => {
    if (pollingTimer) {
      clearInterval(pollingTimer);
      pollingTimer = null;
    }
  },
}));
