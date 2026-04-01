import { api } from "@/lib/api";

export interface A2ARemoteAgent {
  id: number;
  project_id: number;
  name: string;
  base_url: string;
  auth_scheme: "none" | "bearer";
  protocol_version?: string | null;
  capabilities: string[];
  healthy: boolean;
  failure_count: number;
  circuit_open_until?: string | null;
  card_fetched_at?: string | null;
}

export interface A2ATask {
  id: string;
  project_id: number;
  source: string;
  state: string;
  remote_agent_id?: number | null;
  input_text: string;
  output_text?: string | null;
  error_message?: string | null;
  compatibility_mode: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
}

export interface A2ASendMessagePayload {
  project_id: number;
  message: string;
  session_id?: string;
  remote_agent_id?: number;
  route_mode?: "auto" | "local" | "a2a" | "a2a_first" | "local_first" | "mcp_first";
  fallback_chain?: Array<"a2a" | "local" | "mcp">;
  idempotency_key?: string;
  metadata?: Record<string, unknown>;
}

export interface A2ASendMessageResponse {
  task: A2ATask;
  routing?: {
    selected?: string;
    fallback_chain?: string[];
    canary_hit?: boolean;
    reason?: string;
  };
}

export interface A2ASubscribeEvent {
  type?: string;
  event?: string;
  task_id?: string;
  task_status?: string;
  status?: string;
  artifact?: {
    content?: string;
  };
  output?: string;
  source?: string;
  timestamp?: string;
}

type SubscribeHandler = (event: A2ASubscribeEvent) => void;

const parseSseEvents = (chunk: string): A2ASubscribeEvent[] => {
  const blocks = chunk.split("\n\n");
  const events: A2ASubscribeEvent[] = [];
  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split("\n");
    const dataLine = lines.find((line) => line.startsWith("data:"));
    if (!dataLine) continue;
    const raw = dataLine.slice(5).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as A2ASubscribeEvent;
      events.push(parsed);
    } catch {
      continue;
    }
  }
  return events;
};

const getAuthHeaders = (): Record<string, string> => {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
};

export const a2aApi = {
  listRemoteAgents(projectId: number) {
    return api.get<A2ARemoteAgent[]>(`/api/v1/a2a/remote-agents?project_id=${projectId}`);
  },
  createRemoteAgent(payload: {
    project_id: number;
    name: string;
    base_url: string;
    auth_scheme: "none" | "bearer";
    auth_token?: string;
  }) {
    return api.post<A2ARemoteAgent>("/api/v1/a2a/remote-agents", payload);
  },
  updateRemoteAgent(agentId: number, payload: {
    name?: string;
    base_url?: string;
    auth_scheme?: "none" | "bearer";
    auth_token?: string;
  }) {
    return api.put<A2ARemoteAgent>(`/api/v1/a2a/remote-agents/${agentId}`, payload);
  },
  deleteRemoteAgent(agentId: number) {
    return api.delete<{ status: string }>(`/api/v1/a2a/remote-agents/${agentId}`);
  },
  refreshRemoteAgentCard(agentId: number) {
    return api.post<A2ARemoteAgent>(`/api/v1/a2a/remote-agents/${agentId}/refresh-card`, {});
  },
  healthCheckRemoteAgent(agentId: number) {
    return api.post<{ healthy: boolean; failure_count: number }>(`/api/v1/a2a/remote-agents/${agentId}/health-check`, {});
  },
  listTasks(projectId: number, state?: string) {
    const params = new URLSearchParams({ project_id: String(projectId), limit: "100" });
    if (state && state !== "all") {
      params.set("state", state);
    }
    return api.get<A2ATask[]>(`/api/v1/a2a/tasks?${params.toString()}`);
  },
  getTask(taskId: string) {
    return api.get<A2ATask>(`/api/v1/a2a/tasks/${taskId}`);
  },
  cancelTask(taskId: string) {
    return api.post<{ task_id: string; state: string }>(`/api/v1/a2a/tasks/${taskId}/cancel`, {});
  },
  sendMessage(payload: A2ASendMessagePayload) {
    return api.post<A2ASendMessageResponse>("/api/v1/a2a/messages/send", payload);
  },
  async subscribeTask(taskId: string, onEvent: SubscribeHandler, signal?: AbortSignal): Promise<void> {
    const response = await fetch(`/api/v1/a2a/tasks/${taskId}/subscribe`, {
      method: "GET",
      headers: {
        ...getAuthHeaders(),
      },
      signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`Subscribe failed: ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const splitIndex = buffer.lastIndexOf("\n\n");
      if (splitIndex === -1) continue;
      const complete = buffer.slice(0, splitIndex);
      buffer = buffer.slice(splitIndex + 2);
      const events = parseSseEvents(complete);
      for (const event of events) {
        onEvent(event);
      }
    }
    if (buffer.trim()) {
      const events = parseSseEvents(buffer);
      for (const event of events) {
        onEvent(event);
      }
    }
  },
};
