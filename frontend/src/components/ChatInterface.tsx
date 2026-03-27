import { useState, useRef, useEffect } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Loader2, ArrowUp, ChevronDown, Check, Square, Plus, Database, Wand2, Zap, CheckCircle2, Table, XCircle, Settings, ExternalLink, FileText, Download, Eye } from "lucide-react";
import { api } from "@/lib/api";
import { type ChartSpec } from "@/store/visualizationStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { InlineVisualizationCard } from "./InlineVisualizationCard";
import { useProjectStore } from "@/store/projectStore";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  awaitingFirstToken?: boolean;
  viz?: MessageViz;
  progressLogs?: string[];
  routeInfo?: string;
  reasoningContent?: string;
  artifacts?: MessageArtifact[];
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

interface ArtifactPreviewTarget {
  name: string;
  mimeType: string;
  previewUrl: string;
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

const HTML_FILE_REGEX = /data[\\\/]data[\\\/]([a-zA-Z0-9_\-]+\.html?)/i;

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
    [key: string]: any;
  };
  messages: Array<{
    role: string;
    content: string;
    [key: string]: any;
  }>;
}

const formatArtifactSize = (size: number): string => {
  if (!Number.isFinite(size) || size < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const fixed = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fixed)} ${units[unitIndex]}`;
};

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

export function ChatInterface() {
  const { t } = useTranslation();
  const [messagesBySession, setMessagesBySession] = useState<Record<string, Message[]>>({});
  const [input, setInput] = useState("");
  const [selectedDataSource, setSelectedDataSource] = useState<string>("");
  const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [artifactPreview, setArtifactPreview] = useState<ArtifactPreviewTarget | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const { currentProject } = useProjectStore();
  
  // Slash Command State
  const [slashQuery, setSlashQuery] = useState<string | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const filteredSlashSkills = slashQuery !== null 
    ? availableSkills.filter(s => s.name.toLowerCase().includes(slashQuery.toLowerCase()))
    : [];
  
  const handleSelectSlashSkill = (skill: Skill) => {
    if (!selectedSkillIds.includes(skill.id)) {
      setSelectedSkillIds(prev => [...prev, skill.id]);
    }
    
    // Remove the slash command from input
    // Match the last occurrence of /query
    const match = input.match(/(?:^|\s)\/([a-zA-Z0-9_\-]*)$/);
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
    const match = val.match(/(?:^|\s)\/([a-zA-Z0-9_\-]*)$/);
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

  // Model selection state
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [modelOpen, setModelOpen] = useState(false);
  
  // Data Source selection state
  const [availableDataSources, setAvailableDataSources] = useState<{id: string, name: string}[]>([]);

  // File upload state
  const [attachedFile, setAttachedFile] = useState<DataFileContext | null>(null);
  const [activeDataFile, setActiveDataFile] = useState<DataFileContext | null>(null);
  const [, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    if (currentProject) {
      fetchDataSources();
    }
  }, [currentProject]);

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

  const syncSessionContext = async (payload: {
    active_data_file?: DataFileContext | null;
    selected_data_source?: string | null;
  }) => {
    try {
      await api.put(`/nanobot/sessions/${encodeURIComponent(activeSessionKey)}/context-file`, payload);
    } catch (e) {
      console.error("Failed to sync session context", e);
    }
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
                cleanContent = cleanContent.replace(/^\[System:.*?\]\n?/i, '');
                // Handle cases where there might be a runtime context block for skills
                cleanContent = cleanContent.replace(/\[Runtime Context[\s\S]*?(?=\[System:|$)/i, '');
                cleanContent = cleanContent.replace(/\[System:.*?\]\n?/i, ''); // clean again in case it follows context
                cleanContent = cleanContent.trim();
              }
              return {
                id: `${Date.now()}-${idx}`,
                role: m.role as 'user' | 'assistant',
                content: cleanContent,
                viz: m.viz ? buildMessageViz(m.viz) : undefined,
                artifacts: normalizeArtifacts(m.artifacts),
              };
            });
          setMessagesForSession(activeSessionKey, formattedMessages);
        } else {
          setMessagesForSession(activeSessionKey, []);
        }
        const restoredFile = data.metadata?.active_data_file || null;
        const restoredSource = data.metadata?.selected_data_source || "";
        setActiveDataFile(restoredFile);
        setSelectedDataSource(restoredSource);
        setAttachedFile(null);
      } catch (e) {
        console.error("Failed to fetch session messages", e);
        setMessagesForSession(activeSessionKey, []);
        setActiveDataFile(null);
        setSelectedDataSource("");
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
  const selectedSkills = availableSkills.filter(skill => selectedSkillIds.includes(skill.id));

  const renderActiveSelections = () => {
    if (!selectedDataSource && selectedSkills.length === 0) return null;
    return (
      <div className="px-2 pt-2">
        <div className="flex flex-wrap gap-2">
          {selectedDataSource ? (
            <div className="px-3 py-1.5 rounded-full text-xs border flex items-center gap-1.5 bg-blue-50 text-blue-700 border-blue-200">
              <Database className="h-3.5 w-3.5" />
              {`${t('dataSource')}：${selectedDataSourceName}`}
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
        <div className="p-2.5 bg-white border border-zinc-100 rounded-2xl flex items-center gap-3 relative group/file shadow-sm max-w-[280px]">
          <div className="h-10 w-10 bg-emerald-600 rounded-xl flex items-center justify-center shrink-0">
            <Table className="h-6 w-6 text-white" />
          </div>
          <div className="flex-1 min-w-0 pr-6">
            <div className="text-sm font-bold text-zinc-900 truncate">{file.filename}</div>
            <div className="text-xs text-zinc-500">{t('spreadsheet')}</div>
          </div>
          <button 
            onClick={handleRemoveFile}
            className="absolute top-1.5 right-1.5 h-5 w-5 rounded-full flex items-center justify-center transition-colors group/close"
          >
            <XCircle className="h-5 w-5 fill-zinc-900 text-white" />
          </button>
        </div>
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
    const controller = abortControllersRef.current[activeSessionKey];
    if (!controller) return;
    controller.abort();
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
            // 对于流式推理内容，拼接而不是创建新条目
            const currentReasoning = msg.reasoningContent || "";
            return { ...msg, reasoningContent: currentReasoning + text };
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
             model_id: effectiveModelId,
             skill_ids: selectedSkillIds,
             source,
             prefer_sql_chart: preferSqlChart,
             file_url: fileUrl,
             route_mode: "auto",
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
            sql?: string;
            result?: unknown;
            error?: string;
            selected?: string;
            reason?: string;
            chart?: { chart_spec?: ChartSpec | null; reasoning?: string; can_visualize?: boolean; chart_type?: string } | null;
            artifacts?: unknown;
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
            // 如果 progress 内容带有空格或者换行，并且不是典型的系统提示词，很可能这是 reasoning_content
            // 为了安全起见，我们在后端应该加上 is_reasoning 标记，这里我们通过启发式或者统一拼接
            pushProgressLog(payload.content, payload.is_reasoning || false);
          }

           if (payload.type === "final") {
            hasFinalPayload = true;
            if (typeof payload.content === "string") {
              streamedText = payload.content;
            }
            flushAssistant(true);
            pushProgressLog(t('answerGenerationCompleted'));
            const messageArtifacts = normalizeArtifacts(payload.artifacts);
             setMessagesForSession(targetSessionKey, (prev) =>
               prev.map((msg) =>
                msg.id === assistantId ? { ...msg, content: typeof payload.content === "string" ? payload.content : msg.content || "", awaitingFirstToken: false, viz: streamedViz ?? msg.viz, artifacts: messageArtifacts.length > 0 ? messageArtifacts : msg.artifacts } : msg
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

      flushAssistant(true);
      if (!streamedText && (hasFinalPayload || hasDonePayload)) {
        setMessagesForSession(targetSessionKey, (prev) =>
          prev.map((msg) =>
            msg.id === assistantId ? { ...msg, content: t('noReply'), awaitingFirstToken: false, viz: streamedViz ?? msg.viz } : msg
          )
        );
       }
    } catch (error: any) {
        if (error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("aborted")) {
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
            content: `Sorry, something went wrong: ${error.message}` 
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
    <div className="flex flex-col h-full bg-white relative">
      {/* Header with Model Selection */}
      <div className="px-4 py-3 flex items-center justify-between border-b border-zinc-100 bg-white/50 backdrop-blur-md sticky top-0 z-20">
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger className="flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-zinc-100 transition-colors group">
            <span className="font-semibold text-zinc-900">
              {selectedModelId ? models.find(m => m.id === selectedModelId)?.name || 'DataClaw' : 'DataClaw'}
            </span>
            <ChevronDown className="h-4 w-4 text-zinc-400 group-hover:text-zinc-600 transition-colors" />
          </PopoverTrigger>
          <PopoverContent className="w-[280px] p-0" align="start">
            <Command>
              <CommandInput placeholder={t('searchModel')} />
              <CommandList className="max-h-[300px]">
                <CommandEmpty>{t('modelNotFound')}</CommandEmpty>
                <CommandGroup heading={t('availableModels')}>
                  {models.map((model) => (
                    <CommandItem
                      key={model.id}
                      onSelect={() => {
                        setSelectedModelId(model.id);
                        setModelOpen(false);
                      }}
                      className="flex items-center gap-2 py-2.5 cursor-pointer"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium text-zinc-900">{model.name || model.model}</span>
                        <span className="text-xs text-zinc-400">{model.provider}</span>
                      </div>
                      <Check
                        className={cn(
                          "ml-auto h-4 w-4",
                          selectedModelId === model.id ? "opacity-100" : "opacity-0"
                        )}
                      />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

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
              <div className="w-full max-w-4xl px-4">
                <div className="relative group">
                  <div className="flex flex-col bg-white rounded-[26px] border border-zinc-200 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all duration-200">
                    {renderFileCard()}
                    {renderActiveSelections()}
                    <div className="flex items-center pl-2 pr-2 py-2">
                      <div className="flex items-center">
                        <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                          <PopoverTrigger className="flex items-center justify-center h-9 w-9 rounded-full hover:bg-zinc-100 transition-colors text-zinc-500">
                            <Plus className="h-5 w-5" />
                          </PopoverTrigger>
                          <PopoverContent side="bottom" align="start" className="w-[480px] p-0 mt-2 overflow-hidden rounded-2xl border-zinc-200 shadow-xl">
                            <div className="flex divide-x divide-zinc-100">
                              {/* Left Column: Data Source */}
                              <div className="flex-1 p-3 bg-zinc-50/50">
                                <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                                  <Database className="h-3 w-3" />
                                  {t('dataSource')}
                                </div>
                                <div className="space-y-0.5">
                                  {availableDataSources.map((ds) => (
                                    <button
                                      key={ds.id}
                                      onClick={() => {
                                        void handleSelectDataSource(ds.id);
                                      }}
                                      className={cn(
                                        "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                                        selectedDataSource === ds.id 
                                          ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" 
                                          : "text-zinc-600 hover:bg-white hover:shadow-sm"
                                      )}
                                    >
                                      <div className="flex items-center gap-2.5">
                                        <Database className={cn("h-4 w-4", selectedDataSource === ds.id ? "text-blue-500" : "text-zinc-400")} />
                                        <span className="font-medium">{ds.name}</span>
                                      </div>
                                      {selectedDataSource === ds.id && <CheckCircle2 className="h-4 w-4 text-blue-500" />}
                                    </button>
                                  ))}
                                  {selectedDataSource && (
                                    <div className="mt-2 pt-2 border-t border-zinc-100">
                                      <button
                                        onClick={() => {
                                          void handleClearDataSource();
                                        }}
                                        className="w-full py-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors flex items-center justify-center gap-1"
                                      >
                                        {t('clearSelected')}
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>

                              {/* Right Column: Skills */}
                              <div className="flex-1 p-3 bg-white">
                                <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                                  <Wand2 className="h-3 w-3" />
                                  Skills
                                </div>
                                <div className="space-y-0.5 max-h-[300px] overflow-y-auto pr-1">
                                  {availableSkills.length > 0 ? (
                                    availableSkills.map((skill) => {
                                      const isSelected = selectedSkillIds.includes(skill.id);
                                      return (
                                        <button
                                          key={skill.id}
                                          onClick={() => {
                                            setSelectedSkillIds((prev) =>
                                              isSelected
                                                ? prev.filter((id) => id !== skill.id)
                                                : [...prev, skill.id]
                                            );
                                          }}
                                          className={cn(
                                            "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                                            isSelected 
                                              ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" 
                                              : "text-zinc-600 hover:bg-white hover:shadow-sm"
                                          )}
                                        >
                                          <div className="flex items-center text-left">
                                            <span className="font-medium">{skill.name}</span>
                                          </div>
                                          {isSelected && <CheckCircle2 className="h-4 w-4 text-blue-500" />}
                                        </button>
                                      );
                                    })
                                  ) : (
                                    <div className="px-3 py-8 text-center">
                                      <Zap className="h-8 w-8 text-zinc-100 mx-auto mb-2" />
                                      <p className="text-xs text-zinc-400">{t('noAvailableSkills')}</p>
                                    </div>
                                  )}
                                </div>
                                {selectedSkillIds.length > 0 && (
                                  <div className="mt-2 pt-2 border-t border-zinc-100">
                                    <button 
                                      onClick={() => setSelectedSkillIds([])}
                                      className="w-full py-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors flex items-center justify-center gap-1"
                                    >
                                      {t('clearSelectedWithCount', { count: selectedSkillIds.length })}
                                    </button>
                                  </div>
                                )}
                              </div>
                            </div>
                          </PopoverContent>
                        </Popover>
                      </div>

                      <input
                        type="text"
                        value={input}
                        onChange={handleInputChange}
                        onKeyDown={handleInputKeyDown}
                        placeholder={t('askAnything')}
                        className="flex-1 bg-transparent border-none focus:ring-0 text-lg px-3 py-2 text-zinc-900 placeholder:text-zinc-300 outline-none"
                        disabled={isLoading}
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
                          onClick={handleSend}
                          disabled={isLoading || !input.trim()}
                          className={cn(
                            "flex items-center justify-center h-10 w-10 rounded-full transition-all duration-200",
                            (input.trim() || attachedFile || activeDataFile) && !isLoading
                              ? "bg-zinc-900 text-white hover:bg-zinc-800 shadow-sm"
                              : "bg-zinc-100 text-zinc-300"
                          )}
                        >
                          {isLoading ? (
                            <Loader2 className="h-5 w-5 animate-spin" />
                          ) : (
                            <ArrowUp className="h-6 w-6" />
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {/* Common Questions or suggestions could go here */}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
              {messages.map((msg, msgIdx) => {
                const isMessageGenerating = isLoading && msgIdx === messages.length - 1;
                const { markdown, reportHtml } = splitReportHtml(msg.content);
                const externalReportUrl = extractExternalReport(msg.content);
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
                        ? "bg-zinc-100 text-zinc-800"
                        : "bg-white border border-zinc-100 text-zinc-700 overflow-hidden"
                    }`}
                  >
                    {msg.role === "assistant" ? (
                      <>
                        {msg.reasoningContent && (
                          <div className="mb-3 rounded-xl border border-zinc-200 bg-zinc-50/50 p-3 text-sm text-zinc-600 font-mono whitespace-pre-wrap leading-relaxed shadow-inner max-h-[300px] overflow-y-auto">
                            <div className="flex items-center gap-2 mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                              <Settings className={`h-3.5 w-3.5 ${msg.awaitingFirstToken ? 'animate-spin' : ''}`} />
                              {t('thinkingProcess')}
                            </div>
                            {msg.reasoningContent}
                          </div>
                        )}
                        {msg.progressLogs && msg.progressLogs.length > 0 ? (
                          <div className="mb-2 rounded-xl border border-zinc-100 bg-zinc-50/70 px-3 py-2">
                            <div className="flex items-center gap-2 text-zinc-500 text-xs mb-1.5 pb-1.5 border-b border-zinc-100/50">
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
                                  <div key={`${msg.id}-log-${idx}`} className="flex items-start gap-2 text-[12px] text-zinc-500 leading-5">
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
                          <div className="flex items-center gap-2 text-zinc-500 text-sm py-1">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span>{t('modelThinking')}</span>
                          </div>
                        ) : (
                          <>
                            {markdown ? (
                              <div className="prose prose-sm prose-zinc max-w-none prose-p:leading-normal prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5 prose-pre:bg-zinc-50 prose-pre:text-zinc-800 prose-pre:border prose-pre:border-zinc-200">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                                  {markdown}
                                </ReactMarkdown>
                              </div>
                            ) : null}
                            {reportHtml ? (
                              <div className="mt-3 rounded-xl border border-zinc-200 overflow-hidden bg-white">
                                <iframe
                                  title={`report-${msg.id}`}
                                  srcDoc={reportHtml}
                                  sandbox="allow-same-origin allow-scripts"
                                  className="w-full h-[620px] bg-white"
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
                                  <div key={`${msg.id}-artifact-${artifactIndex}`} className="rounded-xl border border-zinc-200 bg-zinc-50/60 px-3 py-2.5">
                                    <div className="flex items-center gap-2.5">
                                      <div className="h-8 w-8 rounded-lg bg-white border border-zinc-200 flex items-center justify-center text-zinc-500 shrink-0">
                                        <FileText className="h-4 w-4" />
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium text-zinc-800 truncate">{artifact.name}</div>
                                        <div className="text-[11px] text-zinc-500">{formatArtifactSize(artifact.size)}</div>
                                      </div>
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                      {artifact.previewable && artifact.preview_url ? (
                                        <button
                                          onClick={() => setArtifactPreview({ name: artifact.name, mimeType: artifact.mime_type, previewUrl: artifact.preview_url || "" })}
                                          className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-zinc-300 text-zinc-700 hover:bg-white transition-colors"
                                        >
                                          <Eye className="h-3.5 w-3.5" />
                                          {t('preview')}
                                        </button>
                                      ) : null}
                                      <a
                                        href={artifact.download_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-zinc-300 text-zinc-700 hover:bg-white transition-colors"
                                      >
                                        <Download className="h-3.5 w-3.5" />
                                        {t('download')}
                                      </a>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : null}
                            {msg.viz ? (
                              <div className="mt-3 pt-3 border-t border-zinc-100">
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
                    <div className="w-8 h-8 rounded-full bg-zinc-200 flex items-center justify-center text-zinc-500 shrink-0 mt-1">
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
        <div className="px-4 pb-6 pt-3 border-t border-zinc-100 bg-white">
          <div className="relative group max-w-4xl mx-auto">
            <div className="flex flex-col bg-white rounded-[26px] border border-zinc-200 shadow-[0_2px_12px_rgba(0,0,0,0.04)] transition-all duration-200">
              {renderFileCard()}
              {renderActiveSelections()}
              <div className="flex items-center pl-2 pr-2 py-2">
                <div className="flex items-center">
                  <Popover open={isMenuOpen} onOpenChange={setIsMenuOpen}>
                    <PopoverTrigger className="flex items-center justify-center h-9 w-9 rounded-full hover:bg-zinc-100 transition-colors text-zinc-500">
                      <Plus className="h-5 w-5" />
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" className="w-[480px] p-0 mb-2 overflow-hidden rounded-2xl border-zinc-200 shadow-xl">
                      <div className="flex divide-x divide-zinc-100">
                        {/* Left Column: Data Source */}
                        <div className="flex-1 p-3 bg-zinc-50/50">
                          <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                            <Database className="h-3 w-3" />
                            {t('dataSource')}
                          </div>
                          <div className="space-y-0.5">
                            {availableDataSources.map((ds) => (
                              <button
                                key={ds.id}
                                onClick={() => {
                                  void handleSelectDataSource(ds.id);
                                }}
                                className={cn(
                                  "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                                  selectedDataSource === ds.id 
                                    ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" 
                                    : "text-zinc-600 hover:bg-white hover:shadow-sm"
                                )}
                              >
                                <div className="flex items-center gap-2.5">
                                  <Database className={cn("h-4 w-4", selectedDataSource === ds.id ? "text-blue-500" : "text-zinc-400")} />
                                  <span className="font-medium">{ds.name}</span>
                                </div>
                                {selectedDataSource === ds.id && <CheckCircle2 className="h-4 w-4 text-blue-500" />}
                              </button>
                            ))}
                            {selectedDataSource && (
                              <div className="mt-2 pt-2 border-t border-zinc-100">
                                <button
                                  onClick={() => {
                                    void handleClearDataSource();
                                  }}
                                  className="w-full py-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors flex items-center justify-center gap-1"
                                >
                                  {t('clearSelected')}
                                </button>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right Column: Skills */}
                        <div className="flex-1 p-3 bg-white">
                          <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2 px-2 flex items-center gap-1.5">
                            <Wand2 className="h-3 w-3" />
                            Skills
                          </div>
                          <div className="space-y-0.5 max-h-[300px] overflow-y-auto pr-1">
                            {availableSkills.length > 0 ? (
                              availableSkills.map((skill) => {
                                const isSelected = selectedSkillIds.includes(skill.id);
                                return (
                                  <button
                                    key={skill.id}
                                    onClick={() => {
                                      setSelectedSkillIds((prev) =>
                                        isSelected
                                          ? prev.filter((id) => id !== skill.id)
                                          : [...prev, skill.id]
                                      );
                                    }}
                                    className={cn(
                                      "w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm transition-all duration-200",
                                      isSelected 
                                        ? "bg-white text-zinc-900 shadow-sm ring-1 ring-zinc-200" 
                                        : "text-zinc-600 hover:bg-white hover:shadow-sm"
                                    )}
                                  >
                                    <div className="flex items-center text-left">
                                      <span className="font-medium">{skill.name}</span>
                                    </div>
                                    {isSelected && <CheckCircle2 className="h-4 w-4 text-blue-500" />}
                                  </button>
                                );
                              })
                            ) : (
                              <div className="px-3 py-8 text-center">
                                <Zap className="h-8 w-8 text-zinc-100 mx-auto mb-2" />
                                <p className="text-xs text-zinc-400">{t('noAvailableSkills')}</p>
                              </div>
                            )}
                          </div>
                          {selectedSkillIds.length > 0 && (
                            <div className="mt-2 pt-2 border-t border-zinc-100">
                              <button 
                                onClick={() => setSelectedSkillIds([])}
                                className="w-full py-1.5 text-[11px] text-zinc-400 hover:text-zinc-600 transition-colors flex items-center justify-center gap-1"
                              >
                                {t('clearSelectedWithCount', { count: selectedSkillIds.length })}
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>

                <input
                  type="text"
                  value={input}
                  onChange={handleInputChange}
                  onKeyDown={handleInputKeyDown}
                  placeholder={t('askAnything')}
                  className="flex-1 bg-transparent border-none focus:ring-0 text-lg px-3 py-2 text-zinc-900 placeholder:text-zinc-300 outline-none"
                  disabled={isLoading}
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
                    onClick={isLoading ? handleForceStop : handleSend}
                    disabled={isLoading ? false : !input.trim()}
                    className={cn(
                      "flex items-center justify-center h-10 w-10 rounded-full transition-all duration-200",
                      (input.trim() || isLoading)
                        ? (isLoading ? "bg-red-600 text-white hover:bg-red-700" : "bg-zinc-900 text-white hover:bg-zinc-800")
                        : "bg-zinc-100 text-zinc-300"
                    )}
                  >
                    {isLoading ? (
                      <Square className="h-4 w-4" />
                    ) : (
                      <ArrowUp className="h-6 w-6" />
                    )}
                  </button>
                </div>
              </div>
            </div>
            <div className="mt-2 flex justify-center">
              <p className="text-[11px] text-zinc-400">
                {t('dataClawDisclaimer')}
              </p>
            </div>
          </div>
        </div>
      )}
      <Dialog open={Boolean(artifactPreview)} onOpenChange={(open) => {
        if (!open) setArtifactPreview(null);
      }}>
        <DialogContent className="sm:max-w-[min(1100px,95vw)] h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{artifactPreview?.name || t('artifactPreview')}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 rounded-lg border border-zinc-200 bg-white overflow-hidden">
            {artifactPreview?.mimeType.startsWith("image/") ? (
              <img
                src={artifactPreview.previewUrl}
                alt={artifactPreview.name}
                className="w-full h-full object-contain bg-zinc-50"
              />
            ) : artifactPreview ? (
              <iframe
                title={artifactPreview.name}
                src={artifactPreview.previewUrl}
                className="w-full h-full border-0"
                onLoad={(e) => {
                  try {
                    const doc = (e.target as HTMLIFrameElement).contentDocument;
                    if (doc) {
                      const style = doc.createElement('style');
                      style.textContent = `html, body { overflow: auto !important; }`;
                      doc.head.appendChild(style);
                    }
                  } catch (err) {
                    console.error("Failed to inject styles into iframe", err);
                  }
                }}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
