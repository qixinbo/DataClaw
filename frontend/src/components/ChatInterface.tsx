import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Loader2, Sparkles, ArrowUp, ChevronDown, Paperclip, Check, X, File as FileIcon, Square } from "lucide-react";
import { api } from "@/lib/api";
import { type ChartSpec } from "@/store/visualizationStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useLocation } from "react-router-dom";
import { InlineVisualizationCard } from "./InlineVisualizationCard";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  awaitingFirstToken?: boolean;
  viz?: MessageViz;
}

interface MessageViz {
  sql: string;
  rows: unknown[];
  chartSpec: ChartSpec | null;
  canVisualize: boolean;
  reasoning?: string;
  error?: string | null;
}

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

interface SessionData {
  key: string;
  metadata?: {
    active_data_file?: DataFileContext | null;
    [key: string]: any;
  };
  messages: Array<{
    role: string;
    content: string;
    [key: string]: any;
  }>;
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedDataSource, setSelectedDataSource] = useState<string>("postgres-main");
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  
  // Model selection state
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [modelOpen, setModelOpen] = useState(false);
  
  // Data Source selection state
  const [availableDataSources, setAvailableDataSources] = useState<{id: string, name: string}[]>([
    { id: "postgres-main", name: "PostgreSQL" },
    { id: "clickhouse-main", name: "ClickHouse" }
  ]);

  // Try to parse active session from URL query
  const queryParams = new URLSearchParams(location.search);
  const activeSessionKey = queryParams.get("session") || "api:default";

  // File upload state
  const [attachedFile, setAttachedFile] = useState<DataFileContext | null>(null);
  const [activeDataFile, setActiveDataFile] = useState<DataFileContext | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchModels();
    fetchDataSources();
  }, []);

  const fetchDataSources = async () => {
    try {
      const data = await api.get<Array<{id: number, name: string}>>("/api/v1/datasources");
      setAvailableDataSources(prev => [
        ...prev.filter(d => !d.id.startsWith("ds:")),
        ...data.map(d => ({ id: `ds:${d.id}`, name: d.name }))
      ]);
    } catch (e) {
      console.error("Failed to fetch data sources", e);
    }
  };

  const syncSessionFileContext = async (file: DataFileContext | null) => {
    try {
      await api.put(`/nanobot/sessions/${encodeURIComponent(activeSessionKey)}/context-file`, {
        active_data_file: file,
      });
    } catch (e) {
      console.error("Failed to sync session file context", e);
    }
  };

  useEffect(() => {
    const fetchSessionData = async () => {
      setIsLoading(true);
      try {
        const data = await api.get<SessionData>(`/nanobot/sessions/${activeSessionKey}`);
        if (data.messages && data.messages.length > 0) {
          const formattedMessages = data.messages.map((m, idx) => ({
            id: `${Date.now()}-${idx}`,
            role: m.role as 'user' | 'assistant',
            content: m.content,
            viz: m.viz ? buildMessageViz(m.viz) : undefined,
          }));
          setMessages(formattedMessages);
        } else {
          setMessages([]);
        }
        const restoredFile = data.metadata?.active_data_file || null;
        setActiveDataFile(restoredFile);
        setAttachedFile(null);
        if (restoredFile) {
          setSelectedDataSource("upload-main");
        } else if (selectedDataSource.startsWith("upload")) {
          setSelectedDataSource("postgres-main");
        }
      } catch (e) {
        console.error("Failed to fetch session messages", e);
        setMessages([]);
        setActiveDataFile(null);
        setAttachedFile(null);
      } finally {
        setIsLoading(false);
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
  
  const chartIntentPattern = /(图表|可视化|画图|作图|柱状图|折线图|饼图|趋势|分布|chart|plot|visuali[sz]e)/i;

  const buildMessageViz = (payload: {
    sql?: string;
    result?: unknown;
    error?: string | null;
    chart?: { chart_spec?: ChartSpec | null; reasoning?: string; can_visualize?: boolean; chart_type?: string } | null;
  }): MessageViz => {
    const rows = Array.isArray(payload.result) ? payload.result : [];
    const chart = payload.chart ?? undefined;
    const canVisualize = Boolean(chart?.can_visualize);
    const chartSpec = canVisualize ? (chart?.chart_spec ?? null) : null;
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
      setSelectedDataSource("upload-main");
      await syncSessionFileContext(uploadedFile);
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

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleForceStop = () => {
    const controller = abortControllerRef.current;
    if (!controller) return;
    controller.abort();
    setIsLoading(false);
    setMessages((prev) =>
      prev.map((msg) =>
        msg.awaitingFirstToken
          ? { ...msg, awaitingFirstToken: false, content: msg.content || "已中断输出" }
          : msg
      )
    );
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const newMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, newMessage]);
    setInput("");
    
    let messagePayload = newMessage.content;
    const currentAttachedFile = attachedFile;
    if (currentAttachedFile) {
      messagePayload = `[用户上传了文件: ${currentAttachedFile.filename}]\n[文件内容摘要: ${currentAttachedFile.summary || "无"}]\n[数据列: ${currentAttachedFile.columns?.join(", ") || "无"}]\n[文件下载链接: ${currentAttachedFile.url}]\n\n${newMessage.content}`;
      setAttachedFile(null);
    }
    
    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsLoading(true);
    
    try {
       const assistantId = (Date.now() + 1).toString();
       setMessages(prev => [...prev, {
          id: assistantId,
          role: "assistant",
          content: "",
          awaitingFirstToken: true
       }]);

       const token = localStorage.getItem("token");
       const effectiveModelId = selectedModelId || currentModel?.id || "";
       const selectedSource = selectedDataSource.split('-')[0];
       const useUploadSource = Boolean(
         currentAttachedFile?.url?.startsWith("local://") ||
         (selectedSource === "upload" && activeDataFile?.url?.startsWith("local://"))
       );
       const source = useUploadSource ? "upload" : selectedSource;
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
             session_id: activeSessionKey,
             model_id: effectiveModelId,
             source,
             prefer_sql_chart: preferSqlChart,
             file_url: fileUrl,
           }),
         signal: controller.signal,
       });

       if (!response.ok || !response.body) {
         const err = await response.json().catch(() => ({}));
         throw new Error(err.detail || "流式响应失败");
       }

       const reader = response.body.getReader();
       const decoder = new TextDecoder("utf-8");
       let buffer = "";
       let streamedText = "";
       let streamedViz: MessageViz | null = null;

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
            sql?: string;
            result?: unknown;
            error?: string;
            chart?: { chart_spec?: ChartSpec | null; reasoning?: string; can_visualize?: boolean; chart_type?: string } | null;
          };

           if (payload.type === "delta" && payload.content) {
             streamedText = `${streamedText}${payload.content}`;
             setMessages((prev) =>
               prev.map((msg) =>
                  msg.id === assistantId ? { ...msg, content: streamedText, awaitingFirstToken: false } : msg
               )
             );
           }

           if (payload.type === "final" && payload.content) {
             streamedText = payload.content;
             setMessages((prev) =>
               prev.map((msg) =>
                 msg.id === assistantId ? { ...msg, content: payload.content || "", awaitingFirstToken: false, viz: streamedViz ?? msg.viz } : msg
               )
             );
           }

           if (payload.type === "error") {
             throw new Error(payload.content || "流式响应错误");
           }

          if (payload.type === "viz") {
            streamedViz = buildMessageViz(payload);
            setMessages((prev) =>
              prev.map((msg) =>
                 msg.id === assistantId ? { ...msg, viz: streamedViz || undefined } : msg
              )
            );
          }
         }
       }

       if (!streamedText) {
        const fallback = await api.post<{
          response: string;
          viz?: {
            sql?: string;
            result?: unknown;
            error?: string | null;
            chart?: { chart_spec?: ChartSpec | null; reasoning?: string; can_visualize?: boolean; chart_type?: string } | null;
          };
        }>("/nanobot/chat", {
           message: messagePayload,
           session_id: activeSessionKey,
           model_id: effectiveModelId,
          source,
          prefer_sql_chart: preferSqlChart,
          file_url: fileUrl,
         }, { signal: controller.signal });
        const fallbackViz = fallback.viz ? buildMessageViz(fallback.viz) : undefined;
         setMessages((prev) =>
           prev.map((msg) =>
           msg.id === assistantId ? { ...msg, content: fallback.response || "暂无回复", awaitingFirstToken: false, viz: fallbackViz } : msg
           )
         );
       }
    } catch (error: any) {
        if (error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("aborted")) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.awaitingFirstToken
                ? { ...msg, awaitingFirstToken: false, content: msg.content || "已中断输出" }
                : msg
            )
          );
          return;
        }
        setMessages(prev => [...prev, { 
            id: (Date.now() + 1).toString(), 
            role: 'assistant', 
            content: `Sorry, something went wrong: ${error.message}` 
        }]);
    } finally {
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        setIsLoading(false);
        window.dispatchEvent(new Event("nanobot:sessions-changed"));
    }
  };

  return (
    <div className="h-full min-h-0 bg-white flex flex-col">
      {/* Top Bar */}
      <div className="sticky top-0 left-0 w-full px-6 py-4 z-20 flex justify-between items-center bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 border-b border-zinc-100">
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger className="w-[200px] flex justify-between items-center bg-white/80 backdrop-blur-sm rounded-md px-3 py-2 text-sm hover:bg-zinc-50 hover:text-zinc-900 text-zinc-700 font-medium transition-all outline-none border-none shadow-none ring-0">
              {currentModel ? (currentModel.name || currentModel.model) : "选择模型..."}
              <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </PopoverTrigger>
          <PopoverContent className="w-[240px] p-0" align="start">
            <Command>
              <CommandInput placeholder="搜索模型..." className="h-9" />
              <CommandList>
                <CommandEmpty>未找到模型</CommandEmpty>
                <CommandGroup heading="可用模型">
                  {models.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={model.name || model.model}
                      onSelect={() => {
                        setSelectedModelId(model.id);
                        setModelOpen(false);
                      }}
                      className="cursor-pointer"
                    >
                      <div className="flex flex-col">
                        <span className="font-medium">{model.name || model.model}</span>
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
        <div className="flex items-center gap-2 bg-white/80 backdrop-blur-sm rounded-md px-3 py-2 text-sm text-zinc-700">
          <span className="text-zinc-500">数据源</span>
          <select
            value={selectedDataSource}
            onChange={(e) => setSelectedDataSource(e.target.value)}
            className="bg-transparent border-none outline-none text-sm font-medium"
          >
            {availableDataSources.map(ds => (
              <option key={ds.id} value={ds.id}>{ds.name}</option>
            ))}
            {activeDataFile?.url?.startsWith("local://") ? (
              <option value="upload-main">上传文件</option>
            ) : null}
          </select>
        </div>
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
              <div className="w-full max-w-3xl relative">
                <div className="bg-white rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.06)] border border-zinc-100 p-4 transition-shadow hover:shadow-[0_8px_40px_rgb(0,0,0,0.08)]">
                  {activeDataFile && (
                    <div className="mx-2 mb-3 p-2.5 bg-blue-50/50 border border-blue-100/50 rounded-xl flex items-center justify-between">
                      <div className="flex items-center gap-2.5 text-sm text-blue-900">
                        <div className="p-1.5 bg-blue-100 rounded-md">
                          <FileIcon className="h-4 w-4 text-blue-600" />
                        </div>
                        <span className="font-medium truncate max-w-[300px]">{activeDataFile.filename}</span>
                      </div>
                      <button
                        onClick={async () => {
                          setAttachedFile(null);
                          setActiveDataFile(null);
                          if (selectedDataSource.startsWith("upload")) {
                            setSelectedDataSource("postgres-main");
                          }
                          await syncSessionFileContext(null);
                        }}
                        className="p-1 text-blue-400 hover:text-blue-600 hover:bg-blue-100/50 rounded-md transition-colors"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  <textarea
                    className="w-full min-h-[60px] max-h-[200px] resize-none border-none focus:ring-0 text-lg text-zinc-700 placeholder:text-zinc-300 bg-transparent p-2"
                    placeholder="先思考后回答，解决更有难度的问题"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                  />
                  
                  <div className="flex items-center justify-between mt-4 pt-2 border-t border-zinc-50">
                    <div className="flex items-center gap-2">
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-9 w-9 text-zinc-400 hover:text-zinc-600 rounded-full"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                      >
                        {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
                      </Button>
                      <Button
                        onClick={isLoading ? handleForceStop : handleSend}
                        size="icon"
                        disabled={isLoading ? false : !input.trim()}
                        className={`h-9 w-9 rounded-full transition-all ${
                          isLoading
                            ? 'bg-red-100 text-red-700 hover:bg-red-200'
                            : input.trim()
                              ? 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200'
                              : 'bg-zinc-50 text-zinc-300 cursor-not-allowed'
                        }`}
                      >
                        {isLoading ? <Square className="h-4 w-4" /> : <ArrowUp className="h-5 w-5" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role !== "user" && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center text-white shrink-0 mt-1 shadow-sm">
                      <span className="font-bold text-xs">Ai</span>
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
                      msg.awaitingFirstToken && !msg.content ? (
                        <div className="flex items-center gap-2 text-zinc-500 text-sm py-1">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>模型思考中，请稍候...</span>
                        </div>
                      ) : (
                        <>
                          <div className="prose prose-sm prose-zinc max-w-none prose-p:leading-normal prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5 prose-pre:bg-zinc-50 prose-pre:text-zinc-800 prose-pre:border prose-pre:border-zinc-200">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                              {msg.content}
                            </ReactMarkdown>
                          </div>
                          {msg.viz ? (
                            <div className="mt-3 pt-3 border-t border-zinc-100">
                              <InlineVisualizationCard viz={msg.viz} />
                            </div>
                          ) : null}
                        </>
                      )
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
              ))}
              <div ref={scrollRef} />
            </div>
          )}
        </div>
      </ScrollArea>
      
      {/* Floating Input for Chat State */}
      {messages.length > 1 && (
        <div className="px-4 pb-6 pt-3 border-t border-zinc-100 bg-white">
          <div className="max-w-3xl mx-auto">
             <div className="bg-white rounded-2xl shadow-xl border border-zinc-200/60 p-2 flex flex-col gap-2 ring-1 ring-zinc-100">
                {activeDataFile && (
                  <div className="mx-2 mt-1 p-2 bg-blue-50/50 border border-blue-100/50 rounded-lg flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs text-blue-900">
                      <FileIcon className="h-3.5 w-3.5 text-blue-600" />
                      <span className="font-medium truncate max-w-[200px]">{activeDataFile.filename}</span>
                    </div>
                    <button
                      onClick={async () => {
                        setAttachedFile(null);
                        setActiveDataFile(null);
                        if (selectedDataSource.startsWith("upload")) {
                          setSelectedDataSource("postgres-main");
                        }
                        await syncSessionFileContext(null);
                      }}
                      className="text-blue-400 hover:text-blue-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className="h-9 w-9 text-zinc-400 hover:text-zinc-600 rounded-full shrink-0"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading || isLoading}
                  >
                    {isUploading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Paperclip className="h-5 w-5" />}
                  </Button>
                  <Input
                    className="flex-1 border-none shadow-none focus-visible:ring-0 text-base text-zinc-700 placeholder:text-zinc-400 h-11 bg-transparent"
                    placeholder="Send a message..."
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                    disabled={isLoading}
                  />
                  <Button
                    onClick={isLoading ? handleForceStop : handleSend}
                    size="icon"
                    disabled={isLoading ? false : !input.trim()}
                    className={`h-9 w-9 rounded-lg shrink-0 transition-all ${
                      isLoading
                        ? 'bg-red-600 hover:bg-red-700 text-white shadow-md'
                        : input.trim()
                          ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                          : 'bg-zinc-100 text-zinc-300 hover:bg-zinc-100 cursor-not-allowed'
                    }`}
                  >
                    {isLoading ? <Square className="h-4 w-4" /> : <ArrowUp className="h-5 w-5" />}
                  </Button>
                </div>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}
