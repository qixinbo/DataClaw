import { api } from "@/lib/api";

export interface A2APartText {
  kind: "text";
  text: string;
}

export interface A2APartUrl {
  kind: "url";
  url: string;
}

export interface A2APartFile {
  kind: "file";
  data: string;
  mediaType?: string;
  filename?: string;
}

export type A2APart = A2APartText | A2APartUrl | A2APartFile;

export interface A2AMessage {
  messageId?: string;
  contextId?: string;
  taskId?: string;
  role: "user" | "agent" | "system";
  parts: A2APart[];
  extensions?: Record<string, unknown>[];
  referenceTaskIds?: string[];
}

export interface A2AArtifact {
  artifactId?: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: Record<string, unknown>[];
}

export interface A2ATask {
  id: string;
  project_id?: number;
  context_id?: string;
  source: string;
  state: string;
  remote_agent_id?: number | null;
  input_text: string;
  input_parts?: A2APart[];
  output_text?: string | null;
  output_parts?: A2APart[];
  error_message?: string | null;
  compatibility_mode: boolean;
  metadata: Record<string, unknown>;
  artifacts?: A2AArtifact[];
  history?: A2AMessage[];
  history_length?: number;
  created_at: string;
  updated_at: string;
  finished_at?: string | null;
}

export interface A2AAgentCard {
  id?: string;
  name: string;
  description?: string;
  url?: string;
  provider?: {
    organization?: string;
    url?: string;
  };
  skills?: Array<{
    id?: string;
    name: string;
    description?: string;
    tags?: string[];
    examples?: string[];
    inputModes?: string[];
    outputModes?: string[];
    securityRequirements?: Array<Record<string, unknown>>;
  }>;
  supportedInterfaces?: Array<{
    type: string;
    url?: string;
    protocolBinding?: string;
    protocolVersion?: string;
    tenant?: string;
  }>;
  defaultInputModes?: string[];
  defaultOutputModes?: string[];
  securitySchemes?: Record<string, unknown>;
  security?: Array<Record<string, unknown>>;
  signatures?: string[];
  iconUrl?: string;
  documentationUrl?: string;
}

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
  agent_card?: A2AAgentCard;
}

export interface A2ASendMessagePayload {
  project_id: number;
  message: A2AMessage;
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
  context_id?: string;
  task_status?: string;
  status?: string;
  artifact?: A2AArtifact;
  append?: boolean;
  last_chunk?: boolean;
  message?: A2AMessage;
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
  listTasks(projectId: number, state?: string, contextId?: string) {
    const params = new URLSearchParams({ project_id: String(projectId), limit: "100" });
    if (state && state !== "all") {
      params.set("state", state);
    }
    if (contextId) {
      params.set("context_id", contextId);
    }
    return api.get<A2ATask[]>(`/api/v1/a2a/tasks?${params.toString()}`);
  },
  getTask(taskId: string, historyLength?: number) {
    const params = new URLSearchParams();
    if (historyLength !== undefined) {
      params.set("historyLength", String(historyLength));
    }
    const queryString = params.toString();
    return api.get<A2ATask>(`/api/v1/a2a/tasks/${taskId}${queryString ? `?${queryString}` : ""}`);
  },
  cancelTask(taskId: string) {
    return api.post<{ task_id: string; state: string }>(`/api/v1/a2a/tasks/${taskId}:cancel`, {});
  },
  sendMessage(payload: A2ASendMessagePayload) {
    return api.post<A2ASendMessageResponse>("/api/v1/a2a/message:send", payload);
  },
  streamMessage(payload: A2ASendMessagePayload) {
    return api.post<A2ASendMessageResponse>("/api/v1/a2a/message:stream", payload);
  },
  subscribeTask(taskId: string, onEvent: SubscribeHandler, signal?: AbortSignal): () => void {
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(`/api/v1/a2a/tasks/${taskId}:subscribe`, {
        method: "GET",
        headers: {
          ...getAuthHeaders(),
        },
        signal: signal || controller.signal,
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
    })();
    return () => controller.abort();
  },
  subscribeTaskSSE(taskId: string, onEvent: SubscribeHandler, signal?: AbortSignal): () => void {
    const controller = new AbortController();
    void (async () => {
      const response = await fetch(`/api/v1/a2a/tasks/${taskId}/subscribe`, {
        method: "GET",
        headers: {
          ...getAuthHeaders(),
        },
        signal: signal || controller.signal,
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
    })();
    return () => controller.abort();
  },
};

export function renderPart(part: A2APart): string {
  switch (part.kind) {
    case "text":
      return part.text;
    case "url":
      return `[URL: ${part.url}]`;
    case "file":
      if (part.mediaType?.startsWith("image/")) {
        return `[Image: ${part.filename || "image"}]`;
      }
      if (part.mediaType?.includes("json")) {
        try {
          const decoded = atob(part.data);
          return `[JSON File: ${part.filename || "data.json"}]\n${decoded}`;
        } catch {
          return `[Binary File: ${part.filename || "data"}]`;
        }
      }
      return `[File: ${part.filename || "file"}]`;
    default:
      return "[Unknown Part]";
  }
}

export function renderParts(parts: A2APart[]): string {
  return parts.map(renderPart).join("\n");
}

export function extractTextFromParts(parts: A2APart[]): string {
  return parts
    .filter((p): p is A2APartText => p.kind === "text")
    .map((p) => p.text)
    .join("\n");
}

export function getArtifactPreview(artifact: A2AArtifact): { type: "text" | "image" | "html" | "json" | "unknown"; content: string } {
  if (!artifact.parts || artifact.parts.length === 0) {
    return { type: "unknown", content: "" };
  }

  const firstPart = artifact.parts[0];

  if (firstPart.kind === "text") {
    return { type: "text", content: firstPart.text };
  }

  if (firstPart.kind === "url") {
    const url = firstPart.url.toLowerCase();
    if (url.endsWith(".png") || url.endsWith(".jpg") || url.endsWith(".jpeg") || url.endsWith(".gif") || url.endsWith(".webp")) {
      return { type: "image", content: firstPart.url };
    }
    if (url.endsWith(".html") || url.endsWith(".htm")) {
      return { type: "html", content: firstPart.url };
    }
    return { type: "unknown", content: firstPart.url };
  }

  if (firstPart.kind === "file") {
    const mediaType = firstPart.mediaType || "";
    if (mediaType.startsWith("image/")) {
      return { type: "image", content: `data:${mediaType};base64,${firstPart.data}` };
    }
    if (mediaType.includes("html")) {
      try {
        const decoded = atob(firstPart.data);
        return { type: "html", content: decoded };
      } catch {
        return { type: "unknown", content: "[HTML content]" };
      }
    }
    if (mediaType.includes("json")) {
      try {
        const decoded = atob(firstPart.data);
        return { type: "json", content: decoded };
      } catch {
        return { type: "unknown", content: "[JSON content]" };
      }
    }
    return { type: "unknown", content: `[File: ${firstPart.filename || "file"}]` };
  }

  return { type: "unknown", content: "" };
}

export function groupTasksByContextId(tasks: A2ATask[]): Map<string, A2ATask[]> {
  const grouped = new Map<string, A2ATask[]>();
  for (const task of tasks) {
    const contextId = task.context_id || "no-context";
    const existing = grouped.get(contextId) || [];
    existing.push(task);
    grouped.set(contextId, existing);
  }
  return grouped;
}