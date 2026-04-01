import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Loader2, ArrowUp, ChevronDown, Check, Square, Plus, Database, Wand2, CheckCircle2, Table, XCircle, Settings, ExternalLink, Download, Copy, Mic, X, Compass, RotateCcw } from "lucide-react";
import { api } from "@/lib/api";
import { a2aApi, type A2ARemoteAgent, type A2ATask, type A2ASubscribeEvent } from "@/api/a2a";
import { type ChartSpec } from "@/store/visualizationStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { InlineVisualizationCard } from "./InlineVisualizationCard";
import { useProjectStore } from "@/store/projectStore";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { ArtifactPanel } from "./ArtifactPanel";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  awaitingFirstToken?: boolean;
  viz?: MessageViz;
  progressLogs?: string[];
  routeInfo?: string;
  reasoningContent?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  artifacts?: MessageArtifact[];
  kbCitations?: KnowledgeCitation[];
  a2aTaskId?: string;
  a2aTaskState?: string;
  a2aRouteMode?: string;
  a2aRemoteAgentId?: number | null;
  a2aInputText?: string;
  a2aError?: string;
}

interface MessageViz {
  sql: string;
  rows: unknown[];
  chartSpec: ChartSpec | null;
  canVisualize: boolean;
  reasoning?: string;
  error?: string | null;
}

interface MessageArtifact {
  name: string;
  mime_type: string;
  size: number;
  download_url: string;
  previewable: boolean;
  preview_url?: string;
}

interface KnowledgeCitation {
  doc_id: string;
  title: string;
  score: number;
  chunk: string;
  metadata?: Record<string, unknown>;
}

interface ArtifactPreviewTarget {
  name: string;
  mimeType: string;
  previewUrl: string;
  downloadUrl: string;
}

const REPORT_HTML_BLOCK_REGEX = /<!--\s*REPORT_HTML_START\s*-->([\s\S]*?)<!--\s*REPORT_HTML_END\s*-->/i;

const splitReportHtml = (content: string): { markdown: string; reportHtml: string | null } => {
  if (!content) {
    return { markdown: "", reportHtml: null };
  }
  const match = content.match(REPORT_HTML_BLOCK_REGEX);
  if (!match) {
    return { markdown: content, reportHtml: null };
  }
  const reportHtml = (match[1] || "").trim();
  const markdown = content.replace(REPORT_HTML_BLOCK_REGEX, "").trim();
  return { markdown, reportHtml: reportHtml || null };
};

const HTML_FILE_REGEX = /data[\\/]data[\\/]([a-zA-Z0-9_-]+\.html?)/i;

const extractExternalReport = (content: string): string | null => {
  if (!content) return null;
  const match = content.match(HTML_FILE_REGEX);
  if (match && match[1]) {
    return `/reports/${match[1]}`;
  }
  return null;
};

interface ModelConfig {
  id: string;
  name?: string;
  model: string;
  provider: string;
  is_active: boolean;
}

interface DataFileContext {
  filename: string;
  url: string;
  columns?: string[];
  summary?: string;
}

interface Skill {
  id: string;
  name: string;
  description?: string;
  type: string;
}

interface KnowledgeBaseOption {
  id: string;
  name: string;
}

const dedupeSkillsById = (skills: Skill[]): Skill[] => {
  const map = new Map<string, Skill>();
  for (const skill of skills) {
    const id = (skill.id || "").trim();
    if (!id || map.has(id)) continue;
    map.set(id, skill);
  }
  return Array.from(map.values());
};

interface SessionData {
  key: string;
  metadata?: {
    active_data_file?: DataFileContext | null;
    selected_data_source?: string | null;
    selected_knowledge_base_id?: string | null;
    [key: string]: unknown;
  };
  messages: SessionMessage[];
}

interface SessionMessage {
  role: string;
  content: string;
  tool_calls?: unknown[];
  viz?: unknown;
  reasoning_content?: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  artifacts?: unknown;
  kb_citations?: unknown;
  [key: string]: unknown;
}

const normalizeArtifacts = (raw: unknown): MessageArtifact[] => {
  if (!Array.isArray(raw)) return [];
  return raw.reduce<MessageArtifact[]>((acc, item) => {
    if (!item || typeof item !== "object") return acc;
    const source = item as Record<string, unknown>;
    const name = typeof source.name === "string" ? source.name : "";
    const mimeType = typeof source.mime_type === "string"
      ? source.mime_type
      : typeof source.mimeType === "string"
        ? source.mimeType
        : "application/octet-stream";
    const size = typeof source.size === "number" ? source.size : 0;
    const downloadUrl = typeof source.download_url === "string"
      ? source.download_url
      : typeof source.downloadUrl === "string"
        ? source.downloadUrl
        : "";
    const previewable = Boolean(source.previewable);
    const previewUrl = typeof source.preview_url === "string"
      ? source.preview_url
      : typeof source.previewUrl === "string"
        ? source.previewUrl
        : undefined;
    if (!name || !downloadUrl) return acc;
    const normalized: MessageArtifact = {
      name,
      mime_type: mimeType,
      size,
      download_url: downloadUrl,
      previewable,
      preview_url: previewUrl,
    };
    acc.push(normalized);
    return acc;
  }, []);
};

const normalizeKnowledgeCitations = (raw: unknown): KnowledgeCitation[] => {
  if (!Array.isArray(raw)) return [];
  return raw.reduce<KnowledgeCitation[]>((acc, item) => {
    if (!item || typeof item !== "object") return acc;
    const source = item as Record<string, unknown>;
    const title = typeof source.title === "string" ? source.title : "";
    const chunk = typeof source.chunk === "string" ? source.chunk : "";
    const score = typeof source.score === "number" ? source.score : Number(source.score || 0);
    if (!title || !chunk) return acc;
    acc.push({
      doc_id: typeof source.doc_id === "string" ? source.doc_id : "",
      title,
      score: Number.isFinite(score) ? score : 0,
      chunk,
      metadata: source.metadata && typeof source.metadata === "object" ? source.metadata as Record<string, unknown> : undefined,
    });
    return acc;
  }, []);
};

const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
};

export function ChatInterface() {
  const { t } = useTranslation();
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [selectedDataSource, setSelectedDataSource] = useState<string>("");
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState<string>("");
  const [availableKnowledgeBases, setAvailableKnowledgeBases] = useState<KnowledgeBaseOption[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewTarget | null>(null);
  const [collapsedThinkingByMessage, setCollapsedThinkingByMessage] = useState<Record<string, boolean>>({});
  const [thinkingCopiedByMessage, setThinkingCopiedByMessage] = useState<Record<string, boolean>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { currentProject } = useProjectStore();
  
  // Slash Command State
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [a2aEnabled, setA2aEnabled] = useState(false);
  const [a2aRouteMode, setA2aRouteMode] = useState<"auto" | "local" | "a2a" | "a2a_first" | "local_first">("auto");
  const [a2aRemoteAgents, setA2aRemoteAgents] = useState<A2ARemoteAgent[]>([]);
  const [selectedA2aAgentId, setSelectedA2aAgentId] = useState<string>("");
  const [a2aTaskStateFilter, setA2aTaskStateFilter] = useState<string>("all");
  const [a2aTasks, setA2aTasks] = useState<A2ATask[]>([]);
  const [isA2aTaskLoading, setIsA2aTaskLoading] = useState(false);
  const filteredSlashSkills = slashQuery !== null 
    ? availableSkills.filter(s => s.name.toLowerCase().includes(slashQuery.toLowerCase()))
    : [];

  const handleSelectSlashSkill = (skill: Skill) => {
    if (!selectedSkillIds.includes(skill.id)) {
      setSelectedSkillIds(prev => [...prev, skill.id]);
    }
    
    // Remove the slash command from input
    // Match the last occurrence of /query
    const match = input.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (match && match.index !== undefined) {
       // match[0] includes the leading space if present
       const prefix = input.slice(0, match.index);
       const suffix = input.slice(match.index + match[0].length);
       setInput((prefix + suffix).trim());
    }
    setSlashQuery(null);
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Avoid triggering Enter when using IME (Input Method Editor) for CJK characters
    if (e.nativeEvent.isComposing) {
      return;
    }

    if (slashQuery !== null && filteredSlashSkills.length > 0) {
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSlashIndex(prev => Math.max(0, prev - 1));
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSlashIndex(prev => Math.min(filteredSlashSkills.length - 1, prev + 1));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSelectSlashSkill(filteredSlashSkills[slashIndex]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setSlashQuery(null);
        return;
      }
    }
    
    if (e.key === 'Enter' && !isLoading) {
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);
    
    // Simple slash detection: if the last word starts with /
    const match = val.match(/(?:^|\s)\/([a-zA-Z0-9_-]*)$/);
    if (match) {
      setSlashQuery(match[1]);
      setSlashIndex(0);
    } else {
      setSlashQuery(null);
    }
  };

  const setMessagesForSession = (sessionKey: string, updater: React.SetStateAction<Message[]>) => {
    setMessagesBySession(prev => {
      const current = prev[sessionKey] || [];
      const next = typeof updater === 'function' ? (updater as (msgs: Message[]) => Message[])(current) : updater;
      return { ...prev, [sessionKey]: next };
    });
  };

  const setIsLoadingForSession = (sessionKey: string, loading: boolean) => {
    setLoadingBySession(prev => ({ ...prev, [sessionKey]: loading }));
  };
  const queryParams = new URLSearchParams(location.search);
  const activeSessionKey = queryParams.get("session") || "api:default";

  const messages = messagesBySession[activeSessionKey] || [];
  const [loadingBySession, setLoadingBySession] = useState<Record<string, boolean>>({});
  const isLoading = loadingBySession[activeSessionKey] || false;
  
  const generatingSessionsRef = useRef<Record<string, boolean>>({});
  const abortControllersRef = useRef<Record<string, AbortController>>({});
  const a2aSubscribeControllersRef = useRef<Record<string, AbortController>>({});
  const a2aActiveTaskBySessionRef = useRef<Record<string, string>>({});

  // Model selection state
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");

  const isTerminalA2aState = (state?: string) => {
    return state ? ["COMPLETED", "FAILED", "CANCELED", "REJECTED"].includes(state) : false;
  };

  const parseA2aErrorMessage = (raw?: string | null) => {
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw) as { message?: string };
      return parsed.message || raw;
    } catch {
      return raw;
    }
  };

  const fetchA2aAgentsAndTasks = async (projectId: number, stateFilter: string = a2aTaskStateFilter) => {
    setIsA2aTaskLoading(true);
    try {
      const [agents, tasks] = await Promise.all([
        a2aApi.listRemoteAgents(projectId),
        a2aApi.listTasks(projectId, stateFilter),
      ]);
      setA2aRemoteAgents(agents || []);
      setA2aTasks(tasks || []);
      if (selectedA2aAgentId && !(agents || []).some((agent) => String(agent.id) === selectedA2aAgentId)) {
        setSelectedA2aAgentId("");
      }
    } catch (error) {
      console.error("Failed to fetch A2A agents or tasks", error);
    } finally {
      setIsA2aTaskLoading(false);
    }
  };

  // Listen for model changes from the ProjectSwitcher
  useEffect(() => {
    const handleModelChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      if (customEvent.detail) {
        setSelectedModelId(customEvent.detail);
      }
    };
    window.addEventListener('nanobot:model-changed', handleModelChange);
    return () => {
      window.removeEventListener('nanobot:model-changed', handleModelChange);
    };
  }, []);
  
  // Data Source selection state
  const [availableDataSources, setAvailableDataSources] = useState<{id: string, name: string}[]>([]);

  // File upload state
  const [attachedFile, setAttachedFile] = useState<DataFileContext | null>(null);
  const [activeDataFile, setActiveDataFile] = useState<DataFileContext | null>(null);
  const [, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Speech Recognition State
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const shouldTranscribeRef = useRef(true);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioAnimationRef = useRef<number | null>(null);

  const stopAudioMeter = () => {
    if (audioAnimationRef.current) {
      cancelAnimationFrame(audioAnimationRef.current);
      audioAnimationRef.current = null;
    }
    if (audioContextRef.current) {
      void audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setRecordingLevel(0);
  };

  const startAudioMeter = (stream: MediaStream) => {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    audioContextRef.current = audioContext;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);

    const tick = () => {
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i += 1) {
        const normalized = (dataArray[i] - 128) / 128;
        sum += normalized * normalized;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      const level = Math.min(1, rms * 7);
      setRecordingLevel(level);
      audioAnimationRef.current = requestAnimationFrame(tick);
    };

    tick();
  };

  const startRecording = async () => {
    try {
      const voiceEnabled = localStorage.getItem("whisper_enabled") === "true";
      if (!voiceEnabled) {
        alert(t('voiceInputNotEnabled', '语音输入未开启，请先到左下角用户名 -> 更多 -> 语音输入配置中开启'));
        return;
      }
      const configuredWhisperUrl = (localStorage.getItem("whisper_url") || "").trim();
      if (!configuredWhisperUrl) {
        alert(t('voiceServerNotConfigured', '请先配置语音识别服务地址：点击左下角用户名 -> 更多 -> 语音输入配置'));
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      shouldTranscribeRef.current = true;
      startAudioMeter(stream);

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stopAudioMeter();
        if (!shouldTranscribeRef.current) {
          shouldTranscribeRef.current = true;
          return;
        }
        setIsTranscribing(true);
        try {
          const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
          const formData = new FormData();
          formData.append("file", audioBlob, "audio.webm");

          const baseUrl = configuredWhisperUrl;
          const response = await fetch(`${baseUrl.replace(/\/$/, '')}/transcribe`, {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const output = await response.json();
          if (output && output.text) {
            setInput((prev) => prev + (prev ? " " : "") + output.text.trim());
          }
        } catch (err) {
          console.error("Transcription error:", err);
        } finally {
          setIsTranscribing(false);
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Microphone access denied:", err);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const confirmRecording = () => {
    shouldTranscribeRef.current = true;
    stopRecording();
  };

  const cancelRecording = () => {
    shouldTranscribeRef.current = false;
    stopRecording();
  };

  useEffect(() => {
    return () => {
      stopAudioMeter();
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    if (currentProject) {
      fetchDataSources();
      fetchKnowledgeBases();
      void fetchA2aAgentsAndTasks(currentProject.id, a2aTaskStateFilter);
    } else {
      setAvailableKnowledgeBases([]);
      setSelectedKnowledgeBaseId("");
      setA2aRemoteAgents([]);
      setA2aTasks([]);
      setSelectedA2aAgentId("");
    }
  }, [currentProject, a2aTaskStateFilter]);

  const fetchDataSources = async () => {
    if (!currentProject) return;
    try {
      const data = await api.get<Array<{id: number, name: string}>>(`/api/v1/datasources?project_id=${currentProject.id}`);
      const projectSources = data.map(d => ({ id: `ds:${d.id}`, name: d.name }));
      setAvailableDataSources(projectSources);
      if (selectedDataSource && !projectSources.find(ds => ds.id === selectedDataSource)) {
        setSelectedDataSource("");
        void syncSessionContext({ selected_data_source: null });
      }
    } catch (e) {
      console.error("Failed to fetch data sources", e);
    }
  };

  const fetchKnowledgeBases = async () => {
    if (!currentProject) return;
    try {
      const data = await api.get<Array<{ id: string; name: string }>>(`/api/v1/knowledge-bases?project_id=${currentProject.id}`);
      const projectKnowledgeBases = (data || []).map((item) => ({ id: item.id, name: item.name }));
      setAvailableKnowledgeBases(projectKnowledgeBases);
      if (selectedKnowledgeBaseId && !projectKnowledgeBases.find((item) => item.id === selectedKnowledgeBaseId)) {
        setSelectedKnowledgeBaseId("");
        void syncSessionContext({ selected_knowledge_base_id: null });
      }
    } catch (e) {
      console.error("Failed to fetch knowledge bases", e);
    }
  };

  const syncSessionContext = async (payload: {
    active_data_file?: DataFileContext | null;
    selected_data_source?: string | null;
    selected_knowledge_base_id?: string | null;
  }) => {
    try {
      await api.put(`/nanobot/sessions/${encodeURIComponent(activeSessionKey)}/context-file`, payload);
    } catch (e) {
      console.error("Failed to sync session context", e);
    }
  };

  const handleSelectKnowledgeBase = async (knowledgeBaseId: string) => {
    setSelectedKnowledgeBaseId(knowledgeBaseId);
    await syncSessionContext({ selected_knowledge_base_id: knowledgeBaseId });
  };

  const handleClearKnowledgeBase = async () => {
    setSelectedKnowledgeBaseId("");
    await syncSessionContext({ selected_knowledge_base_id: null });
  };

  const handleSelectDataSource = async (sourceId: string) => {
    setSelectedDataSource(sourceId);
    await syncSessionContext({ selected_data_source: sourceId });
  };

  const handleClearDataSource = async () => {
    setSelectedDataSource("");
    await syncSessionContext({ selected_data_source: null });
  };

  useEffect(() => {
    const fetchSessionData = async () => {
      if (generatingSessionsRef.current[activeSessionKey]) {
        return; // Do not fetch if we are currently generating for this session
      }
      setIsLoadingForSession(activeSessionKey, true);
      setSelectedSkillIds([]);
      try {
        const data = await api.get<SessionData>(`/nanobot/sessions/${activeSessionKey}`);
        if (data.messages && data.messages.length > 0) {
          const formattedMessages = data.messages
            .filter((m) => {
              if (m.role === 'system' || m.role === 'tool' || m.role === 'function') return false;
              if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0 && !m.viz && (!m.content || m.content.trim() === '')) return false;
              return true;
            })
            .map((m, idx) => {
              let cleanContent = m.content || "";
              // Remove injected system prompt instructions from user messages if present
              if (m.role === 'user') {
                if (cleanContent.startsWith("[Runtime Context")) {
                  const splitIndex = cleanContent.indexOf("\n\n");
                  if (splitIndex !== -1) {
                    cleanContent = cleanContent.substring(splitIndex + 2);
                  } else {
                    cleanContent = "";
                  }
                } else if (cleanContent.startsWith("[System:")) {
                  // Fallback for older messages containing [System: ...] wrapper
                  cleanContent = cleanContent.replace(/^\[System:[\s\S]*?\]\n*/i, '');
                }
                cleanContent = cleanContent.trim();
              }
              return {
                id: `${Date.now()}-${idx}`,
                role: m.role as 'user' | 'assistant',
                content: cleanContent,
                viz: m.viz ? buildMessageViz(m.viz) : undefined,
                reasoningContent: typeof m.reasoning_content === "string" ? m.reasoning_content : undefined,
                usage: m.usage,
                artifacts: normalizeArtifacts(m.artifacts),
                kbCitations: normalizeKnowledgeCitations(m.kb_citations),
              };
            });
          setMessagesForSession(activeSessionKey, formattedMessages);
        } else {
          setMessagesForSession(activeSessionKey, []);
        }
        const restoredFile = data.metadata?.active_data_file || null;
        const restoredSource = data.metadata?.selected_data_source || "";
        const restoredKnowledgeBaseId = data.metadata?.selected_knowledge_base_id || "";
        setActiveDataFile(restoredFile);
        setSelectedDataSource(restoredSource);
        setSelectedKnowledgeBaseId(restoredKnowledgeBaseId);
        setAttachedFile(null);
      } catch (e) {
        console.error("Failed to fetch session messages", e);
        setMessagesForSession(activeSessionKey, []);
        setActiveDataFile(null);
        setSelectedDataSource("");
        setSelectedKnowledgeBaseId("");
        setAttachedFile(null);
      } finally {
        setIsLoadingForSession(activeSessionKey, false);
      }
    };
    
    fetchSessionData();
  }, [activeSessionKey]);

  const fetchModels = async () => {
    try {
      const data = await api.get<ModelConfig[]>("/api/v1/llm");
      setModels(data);
      // Set default model if available
      const active = data.find(m => m.is_active);
      if (active) {
        setSelectedModelId(active.id);
      } else if (data.length > 0) {
        setSelectedModelId(data[0].id);
      }
    } catch (e) {
      console.error("Failed to fetch models", e);
    }
  };

  const currentModel = models.find(m => m.id === selectedModelId);
  
  const chartIntentPattern = new RegExp(t('chartIntentPattern'), 'i');

  const buildMessageViz = (payload: {
    sql?: string;
    result?: unknown;
    error?: string | null;
    chart?: { chart_spec?: ChartSpec | null; reasoning?: string; can_visualize?: boolean; chart_type?: string } | null;
  }): MessageViz => {
    const rows = Array.isArray(payload.result) ? payload.result : [];
    const chart = payload.chart ?? undefined;
    const canVisualize = chart?.can_visualize ?? Boolean(chart?.chart_spec);
    const chartSpec = chart?.chart_spec ?? null;
    return {
      sql: typeof payload.sql === "string" ? payload.sql : "",
      rows,
      chartSpec,
      canVisualize,
      reasoning: chart?.reasoning,
      error: payload.error ?? null,
    };
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/v1/upload/file", {
        method: "POST",
        body: formData,
        headers: {
          ...(localStorage.getItem("token") ? { Authorization: `Bearer ${localStorage.getItem("token")}` } : {}),
        }
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      const data = await response.json();
      const uploadedFile = {
        filename: file.name,
        url: data.url,
        columns: data.columns,
        summary: data.summary,
      };
      setAttachedFile(uploadedFile);
      setActiveDataFile(uploadedFile);
      setSelectedDataSource("");
      await syncSessionContext({ active_data_file: uploadedFile, selected_data_source: null });
    } catch (error) {
      console.error("File upload error:", error);
      // Could show a toast notification here
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRemoveFile = async () => {
    setAttachedFile(null);
    setActiveDataFile(null);
    await syncSessionContext({ active_data_file: null });
  };

  const selectedDataSourceName = availableDataSources.find(ds => ds.id === selectedDataSource)?.name || "";
  const selectedKnowledgeBaseName = availableKnowledgeBases.find((item) => item.id === selectedKnowledgeBaseId)?.name || "";
  const selectedSkills = availableSkills.filter(skill => selectedSkillIds.includes(skill.id));
  const isThinkingCollapsed = (messageId: string) => collapsedThinkingByMessage[messageId] ?? true;
  const toggleThinkingCollapsed = (messageId: string) => {
    setCollapsedThinkingByMessage((prev) => ({ ...prev, [messageId]: !(prev[messageId] ?? true) }));
  };
  const copyThinkingContent = async (messageId: string, content: string) => {
    if (!content.trim()) return;
    try {
      await navigator.clipboard.writeText(content);
      setThinkingCopiedByMessage((prev) => ({ ...prev, [messageId]: true }));
      window.setTimeout(() => {
        setThinkingCopiedByMessage((prev) => ({ ...prev, [messageId]: false }));
      }, 1200);
    } catch (e) {
      console.error("Failed to copy thinking content", e);
    }
  };

  const updateA2aMessageByTaskId = (sessionKey: string, taskId: string, updater: (msg: Message) => Message) => {
    setMessagesForSession(sessionKey, (prev) =>
      prev.map((msg) => (msg.a2aTaskId === taskId ? updater(msg) : msg))
    );
  };

  const syncTaskSnapshotToMessage = (sessionKey: string, task: A2ATask) => {
    updateA2aMessageByTaskId(sessionKey, task.id, (msg) => ({
      ...msg,
      a2aTaskState: task.state,
      content: task.output_text || msg.content,
      a2aError: parseA2aErrorMessage(task.error_message),
      awaitingFirstToken: !isTerminalA2aState(task.state),
    }));
  };

  const applyA2aSubscribeEvent = (sessionKey: string, taskId: string, event: A2ASubscribeEvent) => {
    if (event.type === "TaskStatusUpdateEvent") {
      const state = event.task_status || event.status || "";
      updateA2aMessageByTaskId(sessionKey, taskId, (msg) => {
        const currentLogs = msg.progressLogs || [];
        const nextLog = state ? `${t('a2aStatus')}: ${state}` : "";
        const logs = nextLog && currentLogs[currentLogs.length - 1] !== nextLog ? [...currentLogs, nextLog] : currentLogs;
        return {
          ...msg,
          a2aTaskState: state || msg.a2aTaskState,
          progressLogs: logs,
          awaitingFirstToken: state ? !isTerminalA2aState(state) : msg.awaitingFirstToken,
        };
      });
      return;
    }
    if (event.type === "TaskArtifactUpdateEvent") {
      const content = event.artifact?.content || event.output || "";
      if (!content) return;
      updateA2aMessageByTaskId(sessionKey, taskId, (msg) => ({
        ...msg,
        content,
        awaitingFirstToken: false,
      }));
    }
  };

  const runA2aMessageFlow = async (sessionKey: string, assistantId: string, inputText: string) => {
    if (!currentProject) return;
    const payload = {
      project_id: currentProject.id,
      message: inputText,
      session_id: sessionKey,
      route_mode: a2aRouteMode,
      ...(selectedA2aAgentId ? { remote_agent_id: Number(selectedA2aAgentId) } : {}),
      metadata: { from_chat: true },
    } as const;
    const response = await a2aApi.sendMessage(payload);
    const task = response.task;
    a2aActiveTaskBySessionRef.current[sessionKey] = task.id;
    setMessagesForSession(sessionKey, (prev) =>
      prev.map((msg) =>
        msg.id === assistantId
          ? {
              ...msg,
              a2aTaskId: task.id,
              a2aTaskState: task.state,
              a2aRouteMode: a2aRouteMode,
              a2aRemoteAgentId: task.remote_agent_id || null,
              a2aInputText: inputText,
              routeInfo: response.routing?.selected || msg.routeInfo,
              progressLogs: [...(msg.progressLogs || []), `${t('a2aTaskCreated')}: ${task.id}`],
            }
          : msg
      )
    );
    await fetchA2aAgentsAndTasks(currentProject.id, a2aTaskStateFilter);
    const subscribeController = new AbortController();
    a2aSubscribeControllersRef.current[task.id] = subscribeController;
    try {
      await a2aApi.subscribeTask(
        task.id,
        (event) => {
          applyA2aSubscribeEvent(sessionKey, task.id, event);
        },
        subscribeController.signal
      );
    } catch (error) {
      if (!subscribeController.signal.aborted) {
        console.error("A2A subscribe failed", error);
      }
    } finally {
      delete a2aSubscribeControllersRef.current[task.id];
      const latestTask = await a2aApi.getTask(task.id).catch(() => null);
      if (latestTask) {
        syncTaskSnapshotToMessage(sessionKey, latestTask);
      }
      if (currentProject) {
        await fetchA2aAgentsAndTasks(currentProject.id, a2aTaskStateFilter);
      }
    }
  };

  const handleCancelA2aTask = async (taskId: string) => {
    try {
      await a2aApi.cancelTask(taskId);
      const controller = a2aSubscribeControllersRef.current[taskId];
      if (controller) {
        controller.abort();
        delete a2aSubscribeControllersRef.current[taskId];
      }
      if (currentProject) {
        await fetchA2aAgentsAndTasks(currentProject.id, a2aTaskStateFilter);
      }
      setMessagesForSession(activeSessionKey, (prev) =>
        prev.map((msg) => (msg.a2aTaskId === taskId ? { ...msg, a2aTaskState: "CANCELED", awaitingFirstToken: false } : msg))
      );
    } catch (error) {
      console.error("Failed to cancel A2A task", error);
    }
  };

  const handleRetryA2aTask = async (msg: Message) => {
    if (!msg.a2aInputText) return;
    const targetSessionKey = activeSessionKey;
    const newUserMessage: Message = { id: Date.now().toString(), role: "user", content: msg.a2aInputText };
    setMessagesForSession(targetSessionKey, (prev) => [...prev, newUserMessage]);
    const assistantId = (Date.now() + 1).toString();
    setMessagesForSession(targetSessionKey, (prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        content: "",
        awaitingFirstToken: true,
        progressLogs: [t('requestSubmittedRouting')],
      },
    ]);
    setIsLoadingForSession(targetSessionKey, true);
    generatingSessionsRef.current[targetSessionKey] = true;
    try {
      await runA2aMessageFlow(targetSessionKey, assistantId, msg.a2aInputText);
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error) || t('unknownError');
      setMessagesForSession(targetSessionKey, (prev) =>
        prev.map((item) =>
          item.id === assistantId
            ? {
                ...item,
                awaitingFirstToken: false,
                a2aTaskState: "FAILED",
                a2aError: errorMessage,
                content: item.content || `${t('a2aTaskFailed')}: ${errorMessage}`,
              }
            : item
        )
      );
    } finally {
      generatingSessionsRef.current[targetSessionKey] = false;
      setIsLoadingForSession(targetSessionKey, false);
      delete a2aActiveTaskBySessionRef.current[targetSessionKey];
    }
  };

  const renderActiveSelections = () => {
    const hasValidDataSourceSelection = Boolean(selectedDataSource && selectedDataSourceName);
    const selectedAgent = a2aRemoteAgents.find((agent) => String(agent.id) === selectedA2aAgentId);
    if (!hasValidDataSourceSelection && !selectedKnowledgeBaseId && !a2aEnabled) return null;
    return (
      <div className="px-2 pt-2">
        <div className="flex flex-wrap gap-2">
          {a2aEnabled ? (
            <div className="px-3 py-1.5 rounded-full text-xs border flex items-center gap-1.5 bg-emerald-50 text-emerald-700 border-emerald-200">
              <Database className="h-3.5 w-3.5" />
              {`A2A：${a2aRouteMode}${selectedAgent ? ` · ${selectedAgent.name}` : ""}`}
            </div>
          ) : null}
          {hasValidDataSourceSelection ? (
            <div className="px-3 py-1.5 rounded-full text-xs border flex items-center gap-1.5 bg-blue-50 text-blue-700 border-blue-200">
              <Database className="h-3.5 w-3.5" />
              {`${t('dataSource')}：${selectedDataSourceName}`}
            </div>
          ) : null}
          {selectedKnowledgeBaseId ? (
            <div className="px-3 py-1.5 rounded-full text-xs border flex items-center gap-1.5 bg-violet-50 text-violet-700 border-violet-200">
              <Database className="h-3.5 w-3.5" />
              {`${t('knowledgeBase')}：${selectedKnowledgeBaseName || selectedKnowledgeBaseId}`}
            </div>
          ) : null}
          {selectedSkills.map((skill) => (
            <div
              key={skill.id}
              className="px-3 py-1.5 rounded-full text-xs border flex items-center gap-1.5 bg-orange-50 text-orange-700 border-orange-200"
            >
              <Wand2 className="h-3.5 w-3.5" />
              {`Skill：${skill.name}`}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFileCard = () => {
    const file = attachedFile || activeDataFile;
    if (!file) return null;
    return (
      <div className="px-2 pt-2">
        <div className="p-2.5 bg-background border border-border rounded-2xl flex items-center gap-3 relative group/file shadow-sm max-w-[280px]">
          <div className="h-10 w-10 bg-emerald-600 rounded-xl flex items-center justify-center shrink-0">
            <Table className="h-6 w-6 text-primary-foreground" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <div className="text-sm font-bold text-foreground truncate">{file.filename}</div>
            <div className="text-xs text-muted-foreground">{t('spreadsheet')}</div>
          </div>
          <button 
            onClick={handleRemoveFile}
            className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full flex items-center justify-center transition-colors group/close"
          >
            <XCircle className="h-5 w-5 fill-zinc-900 text-primary-foreground" />
          </button>
        </div>
      </div>
    );
  };

  const renderInputPanel = ({
    menuSide,
    menuOffsetClass,
    recordingWaveKeyPrefix,
    showDisclaimer = false,
  }: {
    menuSide: "top" | "bottom";
    menuOffsetClass: string;
    recordingWaveKeyPrefix: string;
    showDisclaimer?: boolean;
  }) => {
    return (
      <div className="relative group max-w-4xl mx-auto">
        <div className="flex flex-col bg-background rounded-[26px] border border-border shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all duration-200">
          <div className="px-3 pt-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                className={cn(
                  "px-2.5 py-1 rounded-full border transition-colors",
                  a2aEnabled ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-muted text-muted-foreground border-border"
                )}
                onClick={() => setA2aEnabled((prev) => !prev)}
              >
                {a2aEnabled ? t('a2aModeEnabled') : t('a2aModeDisabled')}
              </button>
              {a2aEnabled ? (
                <>
                  <select
                    value={a2aRouteMode}
                    onChange={(e) => setA2aRouteMode(e.target.value as "auto" | "local" | "a2a" | "a2a_first" | "local_first")}
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                  >
                    <option value="auto">auto</option>
                    <option value="local">local</option>
                    <option value="a2a">a2a</option>
                    <option value="a2a_first">a2a_first</option>
                    <option value="local_first">local_first</option>
                  </select>
                  <select
                    value={selectedA2aAgentId}
                    onChange={(e) => setSelectedA2aAgentId(e.target.value)}
                    className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground min-w-[160px]"
                  >
                    <option value="">{t('autoSelectAgent')}</option>
                    {a2aRemoteAgents.map((agent) => (
                      <option key={agent.id} value={String(agent.id)}>
                        {agent.name} ({agent.healthy ? t('healthy') : t('unhealthy')})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="h-7 px-2 rounded-md border border-border text-muted-foreground hover:text-foreground"
                    onClick={() => {
                      if (currentProject) {
                        void fetchA2aAgentsAndTasks(currentProject.id, a2aTaskStateFilter);
                      }
                    }}
                  >
                    {t('refresh')}
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {renderFileCard()}
          {renderActiveSelections()}
          <div className="flex items-center pl-2 pr-2 py-2">
            <div className="flex items-center">
              <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                <PopoverTrigger className="flex items-center justify-center h-9 w-9 rounded-full hover:bg-muted transition-colors text-muted-foreground">
                  <Plus className="h-5 w-5" />
                </PopoverTrigger>
                <PopoverContent side={menuSide} align="start" className={`w-[480px] p-0 ${menuOffsetClass} overflow-hidden rounded-2xl border-border shadow-xl`}>
                  <div className="flex divide-x divide-zinc-100">
                    <div className="flex-1 p-3 bg-muted/50/50">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                        <Database className="h-3 w-3" />
                        {t('knowledgeBase')}
                      </div>
                      <div className="space-y-0.5">
                        {availableKnowledgeBases.length > 0 ? (
                          availableKnowledgeBases.map((kb) => (
                            <button
                              key={kb.id}
                              onClick={() => {
                                void handleSelectKnowledgeBase(kb.id);
                              }}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                                selectedKnowledgeBaseId === kb.id
                                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                                  : "text-muted-foreground hover:bg-background hover:shadow-sm"
                              )}
                            >
                              <div className="flex items-center gap-2.5">
                                <Database className={cn("h-4 w-4", selectedKnowledgeBaseId === kb.id ? "text-violet-500" : "text-muted-foreground")} />
                                <span className="font-medium">{kb.name}</span>
                              </div>
                              {selectedKnowledgeBaseId === kb.id && <CheckCircle2 className="h-4 w-4 text-violet-500" />}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-4 text-center">
                            <Database className="h-6 w-6 text-zinc-200 mx-auto mb-1" />
                            <p className="text-[11px] text-muted-foreground">{t('noKnowledgeBases')}</p>
                          </div>
                        )}
                        {selectedKnowledgeBaseId ? (
                          <div className="mt-2 pt-2 border-t border-border">
                            <button
                              onClick={() => {
                                void handleClearKnowledgeBase();
                              }}
                              className="w-full py-1.5 text-[11px] text-muted-foreground hover:text-muted-foreground transition-colors flex items-center justify-center gap-1"
                            >
                              {t('clearSelected')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex-1 p-3 bg-background">
                      <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                        <Database className="h-3 w-3" />
                        {t('dataSource')}
                      </div>
                      <div className="space-y-0.5">
                        {availableDataSources.length > 0 ? (
                          availableDataSources.map((ds) => (
                            <button
                              key={ds.id}
                              onClick={() => {
                                void handleSelectDataSource(ds.id);
                              }}
                              className={cn(
                                "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                                selectedDataSource === ds.id
                                  ? "bg-background text-foreground shadow-sm ring-1 ring-border"
                                  : "text-muted-foreground hover:bg-background hover:shadow-sm"
                              )}
                            >
                              <div className="flex items-center gap-2.5">
                                <Database className={cn("h-4 w-4", selectedDataSource === ds.id ? "text-blue-500" : "text-muted-foreground")} />
                                <span className="font-medium">{ds.name}</span>
                              </div>
                              {selectedDataSource === ds.id && <CheckCircle2 className="h-4 w-4 text-blue-500" />}
                            </button>
                          ))
                        ) : (
                          <div className="px-3 py-4 text-center">
                            <Database className="h-6 w-6 text-zinc-200 mx-auto mb-1" />
                            <p className="text-[11px] text-muted-foreground">{t('noDataSources')}</p>
                          </div>
                        )}
                        {selectedDataSource ? (
                          <div className="mt-2 pt-2 border-t border-border">
                            <button
                              onClick={() => {
                                void handleClearDataSource();
                              }}
                              className="w-full py-1.5 text-[11px] text-muted-foreground hover:text-muted-foreground transition-colors flex items-center justify-center gap-1"
                            >
                              {t('clearSelected')}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
            </div>

            {isRecording ? (
              <>
                <div className="flex-1 px-3">
                  <div className="relative h-10 flex items-center">
                    <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 border-t border-dashed border-muted-foreground/40" />
                    <div className="ml-auto flex items-center gap-[3px] pr-2">
                      {Array.from({ length: 30 }).map((_, idx) => {
                        const dynamic = Math.abs(Math.sin(Date.now() / 180 + idx * 0.85));
                        const height = Math.max(4, Math.round((4 + dynamic * 18) * (0.45 + recordingLevel)));
                        return (
                          <span
                            key={`recording-wave-${recordingWaveKeyPrefix}-${idx}`}
                            className="w-[3px] rounded-full bg-foreground/90 transition-all duration-75"
                            style={{ height: `${height}px` }}
                          />
                        );
                      })}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={cancelRecording}
                    className="flex items-center justify-center h-10 w-10 rounded-full text-foreground hover:bg-muted transition-colors"
                    title={t('cancel', '取消')}
                  >
                    <X className="h-5 w-5" />
                  </button>
                  <button
                    onClick={confirmRecording}
                    className="flex items-center justify-center h-10 w-10 rounded-full text-foreground hover:bg-muted transition-colors"
                    title={t('confirm', '确认')}
                  >
                    <Check className="h-5 w-5" />
                  </button>
                </div>
              </>
            ) : (
              <>
                <input
                  type="text"
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleInputKeyDown}
                  placeholder={isTranscribing ? t('transcribing', '正在识别...') : t('askAnything')}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-lg px-3 py-2 text-foreground placeholder:text-muted-foreground/50 outline-none"
                  disabled={isLoading || isTranscribing}
                />
                <SlashCommandMenu
                  isOpen={slashQuery !== null}
                  skills={filteredSlashSkills}
                  selectedIndex={slashIndex}
                  onSelect={handleSelectSlashSkill}
                  onClose={() => setSlashQuery(null)}
                />

                <div className="flex items-center gap-1">
                  <button
                    onClick={startRecording}
                    disabled={isLoading || isTranscribing}
                    className="flex items-center justify-center h-10 w-10 rounded-full transition-all duration-200 bg-transparent text-muted-foreground hover:bg-muted"
                    title={t('voiceInput', '语音输入')}
                  >
                    {isTranscribing ? (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    ) : (
                      <Mic className="h-5 w-5" />
                    )}
                  </button>
                  <button
                    onClick={isLoading ? handleForceStop : handleSend}
                    disabled={isLoading ? false : !input.trim()}
                    className={cn(
                      "flex items-center justify-center h-10 w-10 rounded-full transition-all duration-200",
                      (input.trim() || isLoading)
                        ? (isLoading ? "bg-red-600 text-primary-foreground hover:bg-red-700" : "bg-primary text-primary-foreground hover:bg-primary/90")
                        : "bg-muted text-muted-foreground/50"
                    )}
                  >
                    {isLoading ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <ArrowUp className="h-6 w-6" />
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        {showDisclaimer && (
          <div className="mt-2 flex justify-center">
            <p className="text-[11px] text-muted-foreground">
              {t('dataClawDisclaimer')}
            </p>
          </div>
        )}
      </div>
    );
  };

  useEffect(() => {
    const fetchSkills = async () => {
      try {
        let url = "/api/v1/skills";
        if (currentProject) {
          url += `?project_id=${currentProject.id}`;
        }
        const skills = await api.get<Skill[]>(url);
        setAvailableSkills(dedupeSkillsById(skills || []));
      } catch (err) {
        console.error("Failed to fetch skills:", err);
      }
    };
    fetchSkills();
  }, [currentProject]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleForceStop = () => {
    const activeTaskId = a2aActiveTaskBySessionRef.current[activeSessionKey];
    if (activeTaskId) {
      void handleCancelA2aTask(activeTaskId);
      delete a2aActiveTaskBySessionRef.current[activeSessionKey];
    }
    const controller = abortControllersRef.current[activeSessionKey];
    if (controller) {
      controller.abort();
    }
    setIsLoadingForSession(activeSessionKey, false);
    generatingSessionsRef.current[activeSessionKey] = false;
    setMessagesForSession(activeSessionKey, (prev) =>
      prev.map((msg) =>
        msg.awaitingFirstToken
          ? { ...msg, awaitingFirstToken: false, content: msg.content || t('outputInterrupted') }
          : msg
      )
    );
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const targetSessionKey = activeSessionKey;
    const newMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessagesForSession(targetSessionKey, prev => [...prev, newMessage]);
    setInput("");
    
    let messagePayload = newMessage.content;
    const currentAttachedFile = attachedFile;
    if (currentAttachedFile) {
      messagePayload = `[${t('userUploadedFile')}: ${currentAttachedFile.filename}]\n[${t('fileContentSummary')}: ${currentAttachedFile.summary || t('none')}]\n[${t('dataColumns')}: ${currentAttachedFile.columns?.join(", ") || t('none')}]\n[${t('fileDownloadLink')}: ${currentAttachedFile.url}]\n\n${newMessage.content}`;
      setAttachedFile(null);
    }

    if (a2aEnabled && currentProject) {
      generatingSessionsRef.current[targetSessionKey] = true;
      setIsLoadingForSession(targetSessionKey, true);
      const assistantId = (Date.now() + 1).toString();
      setMessagesForSession(targetSessionKey, (prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          awaitingFirstToken: true,
          progressLogs: [t('requestSubmittedRouting')],
          a2aRouteMode,
          a2aRemoteAgentId: selectedA2aAgentId ? Number(selectedA2aAgentId) : null,
          a2aInputText: messagePayload,
        },
      ]);
      try {
        await runA2aMessageFlow(targetSessionKey, assistantId, messagePayload);
      } catch (error: unknown) {
        const errorMessage = getErrorMessage(error) || t('unknownError');
        setMessagesForSession(targetSessionKey, (prev) =>
          prev.map((msg) =>
            msg.id === assistantId
              ? {
                  ...msg,
                  awaitingFirstToken: false,
                  a2aTaskState: "FAILED",
                  a2aError: errorMessage,
                  content: msg.content || `${t('a2aTaskFailed')}: ${errorMessage}`,
                }
              : msg
          )
        );
      } finally {
        generatingSessionsRef.current[targetSessionKey] = false;
        setIsLoadingForSession(targetSessionKey, false);
        delete a2aActiveTaskBySessionRef.current[targetSessionKey];
        window.dispatchEvent(new Event("nanobot:sessions-changed"));
      }
      return;
    }
    
    const controller = new AbortController();
    abortControllersRef.current[targetSessionKey] = controller;
    generatingSessionsRef.current[targetSessionKey] = true;
    setIsLoadingForSession(targetSessionKey, true);
    
    try {
       const assistantId = (Date.now() + 1).toString();
       setMessagesForSession(targetSessionKey, prev => [...prev, {
          id: assistantId,
          role: "assistant",
          content: "",
          awaitingFirstToken: true,
          progressLogs: [t('requestSubmittedRouting')],
       }]);

    const pushProgressLog = (text: string, isReasoningToken: boolean = false) => {
      if (!text.trim() && !isReasoningToken) return;
      setMessagesForSession(targetSessionKey, (prev) =>
        prev.map((msg) => {
          if (msg.id !== assistantId) return msg;
          
          if (isReasoningToken) {
            return msg;
          } else {
            // 对于普通的阶段性日志，取消 8 条限制，允许滚动查看所有历史
            const current = msg.progressLogs || [];
            if (current[current.length - 1] === text) return msg;
            const next = [...current, text];
            return { ...msg, progressLogs: next };
          }
        })
      );
    };

       const token = localStorage.getItem("token");
       const effectiveModelId = selectedModelId || currentModel?.id || "";
       
      let source = selectedDataSource || "postgres";
       
       const useUploadSource = Boolean(currentAttachedFile?.url?.startsWith("local://"));
       if (useUploadSource) {
         source = "upload";
       }
       
       const fileUrl = useUploadSource ? (currentAttachedFile?.url || activeDataFile?.url) : undefined;
       const preferSqlChart = chartIntentPattern.test(messagePayload);
       const response = await fetch("/nanobot/chat/stream", {
         method: "POST",
         headers: {
           "Content-Type": "application/json",
           ...(token ? { Authorization: `Bearer ${token}` } : {}),
         },
         body: JSON.stringify({
             message: messagePayload,
             session_id: targetSessionKey,
             project_id: currentProject?.id,
             model_id: effectiveModelId,
             skill_ids: selectedSkillIds,
             source,
             prefer_sql_chart: preferSqlChart,
             file_url: fileUrl,
             route_mode: "auto",
             knowledge_base_id: selectedKnowledgeBaseId || undefined,
           }),
         signal: controller.signal,
       });

       if (!response.ok || !response.body) {
         const err = await response.json().catch(() => ({}));
         throw new Error(err.detail || t('streamResponseFailed'));
       }

       const reader = response.body.getReader();
       const decoder = new TextDecoder("utf-8");
       let buffer = "";
       let streamedText = "";
       let streamedViz: MessageViz | null = null;
      let hasFinalPayload = false;
      let hasDonePayload = false;
      let rafPending = false;
      let renderedText = "";
      let reasoningBuffer = "";
      let reasoningRafPending = false;

      const flushReasoning = (force = false) => {
        if (!reasoningBuffer) return;
        if (force) {
          const content = reasoningBuffer;
          reasoningBuffer = "";
          setMessagesForSession(targetSessionKey, (prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, reasoningContent: (msg.reasoningContent || "") + content } : msg
            )
          );
          return;
        }
        if (reasoningRafPending) return;
        reasoningRafPending = true;
        requestAnimationFrame(() => {
          reasoningRafPending = false;
          if (!reasoningBuffer) return;
          const content = reasoningBuffer;
          reasoningBuffer = "";
          setMessagesForSession(targetSessionKey, (prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, reasoningContent: (msg.reasoningContent || "") + content } : msg
            )
          );
        });
      };

      const flushAssistant = (force = false) => {
        if (streamedText === renderedText && !force) return;
        if (force) {
          renderedText = streamedText;
          setMessagesForSession(targetSessionKey, (prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, content: streamedText, awaitingFirstToken: false, viz: streamedViz ?? msg.viz } : msg
            )
          );
          return;
        }
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          rafPending = false;
          if (streamedText === renderedText) return;
          renderedText = streamedText;
          setMessagesForSession(targetSessionKey, (prev) =>
            prev.map((msg) =>
              msg.id === assistantId ? { ...msg, content: streamedText, awaitingFirstToken: false, viz: streamedViz ?? msg.viz } : msg
            )
          );
        });
      };

       while (true) {
         const { done, value } = await reader.read();
         if (done) break;
         buffer += decoder.decode(value, { stream: true });
         const events = buffer.split("\n\n");
         buffer = events.pop() || "";

         for (const eventBlock of events) {
           const line = eventBlock
             .split("\n")
             .find((item) => item.startsWith("data:"));
           if (!line) continue;
           const payloadText = line.slice(5).trim();
           if (!payloadText) continue;
          const payload = JSON.parse(payloadText) as {
            type: string;
            content?: string;
            is_reasoning?: boolean;
            tool_hint?: boolean;
            sql?: string;
            result?: unknown;
            error?: string;
            selected?: string;
            reason?: string;
            chart?: { chart_spec?: ChartSpec | null; reasoning?: string; can_visualize?: boolean; chart_type?: string } | null;
            artifacts?: unknown;
            reasoning_content?: string;
            usage?: {
              prompt_tokens: number;
              completion_tokens: number;
              total_tokens: number;
            };
            kb_citations?: unknown;
          };

           if (payload.type === "delta" && payload.content) {
             streamedText = `${streamedText}${payload.content}`;
            flushAssistant(false);
           }

          if (payload.type === "routing") {
            const selected = payload.selected === "sql" ? t('sqlAnalysis') : t('generalConversation');
            const reason = payload.reason ? `（${payload.reason}）` : "";
            pushProgressLog(t('routingInfo', { selected, reason }));
            setMessagesForSession(targetSessionKey, (prev) =>
              prev.map((msg) =>
                msg.id === assistantId ? { ...msg, routeInfo: `${selected}${reason}` } : msg
              )
            );
          }

          if (payload.type === "progress" && payload.content) {
            if (payload.is_reasoning || payload.tool_hint) {
              const nextLine = payload.content.endsWith("\n") ? payload.content : `${payload.content}\n`;
              reasoningBuffer += nextLine;
              flushReasoning(false);
            } else {
              pushProgressLog(payload.content, false);
            }
          }

           if (payload.type === "final") {
            hasFinalPayload = true;
            if (typeof payload.content === "string") {
              streamedText = payload.content;
            }
            if (typeof payload.reasoning_content === "string") {
              reasoningBuffer = "";
              setMessagesForSession(targetSessionKey, (prev) =>
                prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, reasoningContent: payload.reasoning_content } : msg
                )
              );
            } else {
              flushReasoning(true);
            }
            flushAssistant(true);
            pushProgressLog(t('answerGenerationCompleted'));
            const messageArtifacts = normalizeArtifacts(payload.artifacts);
            const messageCitations = normalizeKnowledgeCitations(payload.kb_citations);
             setMessagesForSession(targetSessionKey, (prev) =>
               prev.map((msg) =>
                msg.id === assistantId ? { ...msg, content: typeof payload.content === "string" ? payload.content : msg.content || "", awaitingFirstToken: false, viz: streamedViz ?? msg.viz, usage: payload.usage, artifacts: messageArtifacts.length > 0 ? messageArtifacts : msg.artifacts, kbCitations: messageCitations.length > 0 ? messageCitations : msg.kbCitations } : msg
               )
             );
           }

          if (payload.type === "done") {
            hasDonePayload = true;
          }

           if (payload.type === "error") {
             throw new Error(payload.content || t('streamResponseError'));
           }

          if (payload.type === "viz") {
            if (payload.chart?.chart_spec) {
              pushProgressLog(t('chartGenerationCompleted'));
            } else if (payload.sql) {
              pushProgressLog(t('dataQueryCompleted'));
            }
            streamedViz = buildMessageViz(payload);
            flushAssistant(true); // 立即把 viz 状态刷入 messages
          }
         }
       }

      flushReasoning(true);
      flushAssistant(true);
      if (!streamedText && (hasFinalPayload || hasDonePayload)) {
        setMessagesForSession(targetSessionKey, (prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, content: t('noReply'), awaitingFirstToken: false, viz: streamedViz ?? msg.viz } : msg
          )
        );
       }
    } catch (error: unknown) {
        const errorMessage = getErrorMessage(error);
        if (errorMessage.toLowerCase().includes("aborted")) {
          setMessagesForSession(targetSessionKey, (prev) =>
            prev.map((msg) =>
              msg.awaitingFirstToken
                ? { ...msg, awaitingFirstToken: false, content: msg.content || t('outputInterrupted') }
                : msg
            )
          );
          return;
        }
        setMessagesForSession(targetSessionKey, prev => [...prev, { 
            id: (Date.now() + 1).toString(), 
            role: 'assistant', 
            content: `Sorry, something went wrong: ${errorMessage}` 
        }]);
    } finally {
        if (abortControllersRef.current[targetSessionKey] === controller) {
            delete abortControllersRef.current[targetSessionKey];
        }
        generatingSessionsRef.current[targetSessionKey] = false;
        setIsLoadingForSession(targetSessionKey, false);
        window.dispatchEvent(new Event("nanobot:sessions-changed"));
    }
  };

  return (
    <div className="flex h-full bg-background relative overflow-hidden">
      <div className={cn("flex flex-col h-full transition-all duration-300", artifactPreview ? "w-full md:w-1/2 border-r border-border hidden md:flex" : "w-full")}>
      <ScrollArea className="flex-1 min-h-0">
        {/* Hidden file input available in all states */}
        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept=".csv,.xls,.xlsx"
          onChange={handleFileUpload}
        />
        <div className="min-h-full">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center pt-[20vh] px-4 pb-32">
              {/* Logo Area */}
              <div className="mb-16 flex items-center justify-center gap-4 select-none">
                <div className="text-[64px] leading-none animate-bounce-slow pb-3">
                  🦞
                </div>
                <h1 className="text-[56px] font-bold bg-clip-text text-transparent bg-gradient-to-r from-red-500 via-orange-500 to-amber-500 tracking-tight">
                  DataClaw
                </h1>
              </div>

              {/* Input Area */}
              <div className="w-full px-4">
                {renderInputPanel({
                  menuSide: "bottom",
                  menuOffsetClass: "mt-2",
                  recordingWaveKeyPrefix: "empty",
                })}
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  {/* Common Questions or suggestions could go here */}
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
              {a2aEnabled ? (
                <div className="rounded-xl border border-border bg-background p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">A2A Tasks</div>
                    <div className="flex items-center gap-2">
                      <select
                        value={a2aTaskStateFilter}
                        onChange={(e) => setA2aTaskStateFilter(e.target.value)}
                        className="h-7 rounded-md border border-border bg-background px-2 text-xs text-foreground"
                      >
                        <option value="all">{t('allStates')}</option>
                        <option value="SUBMITTED">SUBMITTED</option>
                        <option value="WORKING">WORKING</option>
                        <option value="COMPLETED">COMPLETED</option>
                        <option value="FAILED">FAILED</option>
                        <option value="CANCELED">CANCELED</option>
                      </select>
                      <button
                        type="button"
                        className="h-7 px-2 rounded-md border border-border text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          if (currentProject) {
                            void fetchA2aAgentsAndTasks(currentProject.id, a2aTaskStateFilter);
                          }
                        }}
                      >
                        {isA2aTaskLoading ? t('loading') : t('refresh')}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto">
                    {a2aTasks.length === 0 ? (
                      <div className="text-xs text-muted-foreground">{t('noA2aTasks')}</div>
                    ) : (
                      a2aTasks.slice(0, 8).map((task) => (
                        <div key={task.id} className="flex items-center justify-between gap-2 rounded-md border border-border px-2.5 py-1.5">
                          <div className="min-w-0">
                            <div className="text-[11px] text-foreground font-mono truncate">{task.id}</div>
                            <div className="text-[11px] text-muted-foreground truncate">{task.source} · {task.state}</div>
                          </div>
                          {!isTerminalA2aState(task.state) ? (
                            <button
                              type="button"
                              className="text-[11px] px-2 py-1 rounded border border-border text-muted-foreground hover:text-foreground"
                              onClick={() => void handleCancelA2aTask(task.id)}
                            >
                              {t('cancel')}
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
              {messages.map((msg, msgIdx) => {
                const isMessageGenerating = isLoading && msgIdx === messages.length - 1;
                const { markdown, reportHtml } = splitReportHtml(msg.content);
                const externalReportUrl = extractExternalReport(msg.content);
                const fallbackThinkingLines = Array.from(new Set(
                  (msg.progressLogs || []).filter((log) =>
                    log &&
                    log !== t('requestSubmittedRouting') &&
                    log !== t('answerGenerationCompleted')
                  )
                ));
                const displayedThinkingContent = (msg.reasoningContent || "").trim() || fallbackThinkingLines.join("\n");
                return (
                <div
                  key={msg.id}
                  className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role !== "user" && (
                    <div className="w-8 h-8 flex items-center justify-center shrink-0 mt-1">
                      <span className="text-2xl">🦞</span>
                    </div>
                  )}
                  <div
                    className={`rounded-2xl px-5 py-3.5 text-[15px] leading-relaxed max-w-[85%] shadow-sm ${
                      msg.role === "user"
                        ? "bg-muted text-foreground/90"
                        : "bg-background border border-border text-foreground/80 overflow-hidden"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <>
                        {msg.a2aTaskId ? (
                          <div className="mb-3 rounded-xl border border-border bg-muted/50/60 px-3 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[11px] text-muted-foreground">
                                <span className="font-mono">{msg.a2aTaskId}</span>
                                <span className="mx-1">·</span>
                                <span>{msg.a2aTaskState || 'SUBMITTED'}</span>
                              </div>
                              <div className="flex items-center gap-1">
                                {msg.a2aTaskState && !isTerminalA2aState(msg.a2aTaskState) ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                                    onClick={() => void handleCancelA2aTask(msg.a2aTaskId!)}
                                  >
                                    {t('cancel')}
                                  </button>
                                ) : null}
                                {msg.a2aInputText ? (
                                  <button
                                    type="button"
                                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                                    onClick={() => void handleRetryA2aTask(msg)}
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    {t('retry')}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                            {msg.a2aError ? (
                              <div className="mt-1 text-[11px] text-rose-600">{msg.a2aError}</div>
                            ) : null}
                          </div>
                        ) : null}
                        {displayedThinkingContent && (
                          <div className="mb-3 rounded-xl border border-border bg-muted/50/50 p-3 text-sm text-muted-foreground font-mono whitespace-pre-wrap leading-relaxed shadow-inner">
                            <button
                              type="button"
                              onClick={() => toggleThinkingCollapsed(msg.id)}
                              className="w-full flex items-center justify-between gap-2 mb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground/80 transition-colors"
                            >
                              <span className="flex items-center gap-2">
                                <Settings className={`h-3.5 w-3.5 ${msg.awaitingFirstToken ? 'animate-spin' : ''}`} />
                                {t('thinkingProcess')}
                              </span>
                              <span className="flex items-center gap-2 normal-case text-[11px]">
                                {msg.usage?.total_tokens ? (
                                  <span>{t('thinkingTokens', { count: msg.usage.total_tokens })}</span>
                                ) : msg.reasoningContent ? (
                                  <span>{t('thinkingCharCount', { count: msg.reasoningContent.length })}</span>
                                ) : null}
                                <span
                                  role="button"
                                  tabIndex={0}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void copyThinkingContent(msg.id, displayedThinkingContent);
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      void copyThinkingContent(msg.id, displayedThinkingContent);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 hover:bg-muted/80/70 transition-colors"
                                >
                                  {thinkingCopiedByMessage[msg.id] ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                                  <span>{thinkingCopiedByMessage[msg.id] ? t('copied') : t('copy')}</span>
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  {isThinkingCollapsed(msg.id) ? t('expandThinking') : t('collapseThinking')}
                                  <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", isThinkingCollapsed(msg.id) ? "-rotate-90" : "rotate-0")} />
                                </span>
                              </span>
                            </button>
                            {!isThinkingCollapsed(msg.id) && (
                              <div className="max-h-[280px] overflow-y-auto pr-1">
                                {displayedThinkingContent}
                              </div>
                            )}
                          </div>
                        )}
                        {msg.progressLogs && msg.progressLogs.length > 0 ? (
                          <div className="mb-2 rounded-xl border border-border bg-muted/50/70 px-3 py-2">
                            <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1.5 pb-1.5 border-b border-border/50">
                              {isMessageGenerating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                              <span>{isMessageGenerating ? t('processing') : t('processCompleted')}</span>
                            </div>
                            <div 
                              className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1"
                              ref={(el) => {
                                if (el && isMessageGenerating) {
                                  el.scrollTop = el.scrollHeight;
                                }
                              }}
                            >
                              {msg.progressLogs.map((log, idx, arr) => {
                                const isLast = idx === arr.length - 1;
                                // 只有当是整个会话的最后一条消息，且当前日志是最后一条时，才显示 loading 动画
                                const isLoadingLog = isLast && isMessageGenerating;
                                return (
                                  <div key={`${msg.id}-log-${idx}`} className="flex items-start gap-2 text-[12px] text-muted-foreground leading-5">
                                    {isLoadingLog ? (
                                      <Settings className="mt-0.5 h-3.5 w-3.5 text-amber-500 animate-spin shrink-0" />
                                    ) : (
                                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                    )}
                                    <span className="break-words">{log}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                        {msg.awaitingFirstToken && !msg.content ? (
                          <div className="flex items-center gap-2 text-muted-foreground text-sm py-1">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>{t('modelThinking')}</span>
                          </div>
                        ) : (
                          <>
                            {markdown ? (
                              <div className="prose prose-sm prose-zinc dark:prose-invert max-w-none prose-p:leading-normal prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5 prose-pre:bg-muted/50 prose-pre:text-foreground/90 prose-pre:border prose-pre:border-border">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                  {markdown}
                                </ReactMarkdown>
                              </div>
                            ) : null}
                            {reportHtml ? (
                              <div className="mt-3 rounded-xl border border-border overflow-hidden bg-background">
                                <iframe
                                  title={`report-${msg.id}`}
                                  srcDoc={reportHtml}
                                  sandbox="allow-same-origin allow-scripts"
                                  className="w-full h-[620px] bg-background"
                                  onLoad={(e) => {
                                    try {
                                      const doc = (e.target as HTMLIFrameElement).contentDocument;
                                      if (doc) {
                                        const style = doc.createElement('style');
                                        style.textContent = `html, body { overflow: auto !important; }`;
                                        doc.head.appendChild(style);
                                      }
                                    } catch (err) {
                                      console.error("Failed to inject styles", err);
                                    }
                                  }}
                                />
                              </div>
                            ) : null}
                            {externalReportUrl ? (
                              <div className="mt-4 flex">
                                <a 
                                  href={externalReportUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 hover:bg-blue-100 hover:text-blue-700 rounded-lg text-sm font-medium transition-colors"
                                >
                                  <ExternalLink className="h-4 w-4" />
                                  {t('openReportInNewTab')}
                                </a>
                              </div>
                            ) : null}
                            {msg.artifacts && msg.artifacts.length > 0 ? (
                              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                                {msg.artifacts.map((artifact, artifactIndex) => (
                                  <div 
                                    key={`${msg.id}-artifact-${artifactIndex}`} 
                                    className="rounded-xl border border-border bg-background px-4 py-3 cursor-pointer hover:bg-muted/50 transition-colors flex items-center justify-between gap-4"
                                    onClick={() => {
                                      if (artifact.previewable && artifact.preview_url) {
                                        setArtifactPreview({ 
                                          name: artifact.name, 
                                          mimeType: artifact.mime_type, 
                                          previewUrl: artifact.preview_url,
                                          downloadUrl: artifact.download_url
                                        });
                                      }
                                    }}
                                  >
                                    <div className="flex items-center gap-3 min-w-0 flex-1">
                                      <div className="h-10 w-10 rounded-full bg-background border border-border flex items-center justify-center text-foreground shrink-0">
                                        <Compass className="h-5 w-5" />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-bold text-foreground truncate">{artifact.name}</div>
                                        <div className="text-xs text-muted-foreground truncate">{artifact.mime_type === "text/html" ? "HTML file" : artifact.mime_type}</div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0">
                                      <a
                                        href={artifact.download_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md text-foreground/80 hover:bg-muted transition-colors whitespace-nowrap"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <Download className="h-4 w-4" />
                                        <span>{t('download')}</span>
                                      </a>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {msg.kbCitations && msg.kbCitations.length > 0 ? (
                              <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50/60 p-3">
                                <div className="text-xs font-semibold text-violet-700 uppercase tracking-wider mb-2">{t('knowledgeCitations')}</div>
                                <div className="space-y-2">
                                  {msg.kbCitations.map((citation, citationIndex) => (
                                    <div key={`${msg.id}-citation-${citationIndex}`} className="rounded-lg border border-violet-200 bg-white/80 px-3 py-2">
                                      <div className="flex items-center justify-between gap-2">
                                        <div className="text-sm font-medium text-violet-900 truncate">{citation.title}</div>
                                        <div className="text-[11px] text-violet-700 shrink-0">{t('matchScore', { score: citation.score.toFixed(3) })}</div>
                                      </div>
                                      <div className="mt-1 text-xs text-violet-800 line-clamp-3 whitespace-pre-wrap break-words">{citation.chunk}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {msg.viz ? (
                              <div className="mt-3 pt-3 border-t border-border">
                                <InlineVisualizationCard viz={msg.viz} />
                              </div>
                            ) : null}
                          </>
                        )}
                      </>
                    ) : (
                      msg.content
                    )}
                  </div>
                  {msg.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-muted/80 flex items-center justify-center text-muted-foreground shrink-0 mt-1">
                      <User className="h-4 w-4" />
                    </div>
                  )}
                </div>
              )})}
              <div ref={scrollRef} />
            </div>
          )}
        </div>
      </ScrollArea>
      
      {/* Floating Input for Chat State */}
      {messages.length > 0 && (
        <div className="px-4 pb-6 pt-3 border-t border-border bg-background">
          {renderInputPanel({
            menuSide: "top",
            menuOffsetClass: "mb-2",
            recordingWaveKeyPrefix: "chat",
            showDisclaimer: true,
          })}
        </div>
      )}
      </div>

      {/* Artifact Side Panel */}
      {artifactPreview && (
        <div className="w-full md:w-1/2 h-full absolute md:relative inset-0 md:inset-auto z-50">
          <ArtifactPanel
            artifact={artifactPreview}
            onClose={() => setArtifactPreview(null)}
          />
        </div>
      )}
    </div>
  );
}
