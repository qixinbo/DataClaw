import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Loader2, Sparkles, Search, ArrowUp, ChevronDown, Table, Paperclip, Check } from "lucide-react";
import { api } from "@/lib/api";
import { useVisualizationStore } from "@/store/visualizationStore";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useLocation } from "react-router-dom";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface ModelConfig {
  id: string;
  name?: string;
  model: string;
  provider: string;
  is_active: boolean;
}

interface SessionData {
  key: string;
  messages: Array<{
    role: string;
    content: string;
    [key: string]: any;
  }>;
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [selectedCapability, setSelectedCapability] = useState<string>("智能问答");
  const selectedDataSource = "postgres-main";
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setVisualization, setLoading: setVizLoading, setError: setVizError } = useVisualizationStore();
  const location = useLocation();
  
  // Model selection state
  const [models, setModels] = useState<ModelConfig[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>("");
  const [modelOpen, setModelOpen] = useState(false);

  // Try to parse active session from URL query
  const queryParams = new URLSearchParams(location.search);
  const activeSessionKey = queryParams.get("session") || "api:default";

  useEffect(() => {
    fetchModels();
  }, []);

  useEffect(() => {
    const fetchSessionData = async () => {
      setIsLoading(true);
      try {
        const data = await api.get<SessionData>(`/nanobot/sessions/${activeSessionKey}`);
        if (data.messages && data.messages.length > 0) {
          const formattedMessages = data.messages.map((m, idx) => ({
            id: `${Date.now()}-${idx}`,
            role: m.role as 'user' | 'assistant',
            content: m.content
          }));
          setMessages(formattedMessages);
        } else {
          setMessages([]);
        }
      } catch (e) {
        console.error("Failed to fetch session messages", e);
        setMessages([]);
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
  
  const capabilities = [
    { icon: Sparkles, label: "智能问答", color: "text-purple-500", bg: "bg-purple-50" },
    { icon: Table, label: "表格问答", color: "text-orange-500", bg: "bg-orange-50" },
    { icon: Search, label: "深度问数", color: "text-blue-500", bg: "bg-blue-50" },
  ];

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const newMessage: Message = { id: Date.now().toString(), role: 'user', content: input };
    setMessages(prev => [...prev, newMessage]);
    setInput("");
    setIsLoading(true);
    setVizLoading(true);
    setVizError(null);
    
    try {
      if (selectedCapability === "智能问答") {
         const assistantId = (Date.now() + 1).toString();
         setMessages(prev => [...prev, {
            id: assistantId,
            role: "assistant",
            content: ""
         }]);

         const token = localStorage.getItem("token");
         const response = await fetch("/nanobot/chat/stream", {
           method: "POST",
           headers: {
             "Content-Type": "application/json",
             ...(token ? { Authorization: `Bearer ${token}` } : {}),
           },
           body: JSON.stringify({
               message: newMessage.content,
               session_id: activeSessionKey,
               model_id: selectedModelId,
             }),
         });

         if (!response.ok || !response.body) {
           const err = await response.json().catch(() => ({}));
           throw new Error(err.detail || "流式响应失败");
         }

         const reader = response.body.getReader();
         const decoder = new TextDecoder("utf-8");
         let buffer = "";
         let streamedText = "";

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
             const payload = JSON.parse(payloadText) as { type: string; content?: string };

             if (payload.type === "delta" && payload.content) {
               streamedText = `${streamedText}${payload.content}`;
               setMessages((prev) =>
                 prev.map((msg) =>
                   msg.id === assistantId ? { ...msg, content: streamedText } : msg
                 )
               );
             }

             if (payload.type === "final" && payload.content) {
               streamedText = payload.content;
               setMessages((prev) =>
                 prev.map((msg) =>
                   msg.id === assistantId ? { ...msg, content: payload.content || "" } : msg
                 )
               );
             }

             if (payload.type === "error") {
               throw new Error(payload.content || "流式响应错误");
             }
           }
         }
      } else {
         // Fallback to existing NL2SQL or other skills (e.g. for "表格问答" or "深度问数")
         const source = selectedDataSource.split('-')[0]; // postgres-main -> postgres
         const response = await api.post<{sql?: string, result?: unknown, error?: string}>('/api/v1/agent/nl2sql', {
            query: newMessage.content,
            source: source,
            session_id: activeSessionKey,
            model_id: selectedModelId 
         });

         if (response.error) {
            setMessages(prev => [...prev, { 
                id: (Date.now() + 1).toString(), 
                role: 'assistant', 
                content: `Error: ${response.error}` 
            }]);
            setVizError(response.error);
         } else {
            const rows = Array.isArray(response.result) ? response.result : [];
            const sql = typeof response.sql === "string" ? response.sql : "";
            setMessages(prev => [...prev, { 
                id: (Date.now() + 1).toString(), 
                role: 'assistant', 
                content: `I've generated a SQL query and fetched ${rows.length} rows for you. Check the visualization panel.` 
            }]);
            setVisualization(rows, sql);
         }
      }
    } catch (error: any) {
        setMessages(prev => [...prev, { 
            id: (Date.now() + 1).toString(), 
            role: 'assistant', 
            content: `Sorry, something went wrong: ${error.message}` 
        }]);
        setVizError(error.message);
    } finally {
        setIsLoading(false);
        setVizLoading(false);
    }
  };

  return (
    <div className="h-full bg-white relative flex flex-col">
      {/* Top Bar */}
      <div className="absolute top-0 left-0 w-full px-6 py-4 z-10 flex justify-between items-center">
        <Popover open={modelOpen} onOpenChange={setModelOpen}>
          <PopoverTrigger className="w-[200px] flex justify-between items-center bg-white/80 backdrop-blur-sm border border-zinc-200 rounded-md px-3 py-2 text-sm hover:bg-zinc-50 hover:text-zinc-900 text-zinc-700 font-medium shadow-sm transition-all">
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
      </div>

      <ScrollArea className="flex-1 h-[calc(100vh-100px)]">

        <div className="min-h-full">
          {messages.length <= 1 ? (
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
                      {capabilities.map((cap) => (
                        <button
                          key={cap.label}
                          onClick={() => setSelectedCapability(cap.label)}
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                            selectedCapability === cap.label 
                              ? `${cap.bg} ${cap.color} ring-1 ring-${cap.color.split('-')[1]}-200 shadow-sm` 
                              : 'bg-zinc-50 text-zinc-500 hover:bg-zinc-100'
                          }`}
                        >
                          <cap.icon className="h-3.5 w-3.5" />
                          {cap.label}
                        </button>
                      ))}
                    </div>
                    
                    <div className="flex items-center gap-3">
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-zinc-400 hover:text-zinc-600 rounded-full">
                        <Paperclip className="h-5 w-5" />
                      </Button>
                      <Button
                        onClick={handleSend}
                        size="icon"
                        disabled={!input.trim() || isLoading}
                        className={`h-9 w-9 rounded-full transition-all ${
                          input.trim() 
                            ? 'bg-zinc-100 text-zinc-900 hover:bg-zinc-200' 
                            : 'bg-zinc-50 text-zinc-300 cursor-not-allowed'
                        }`}
                      >
                        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="max-w-3xl mx-auto pt-24 px-4 pb-48 space-y-8">
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
                      <div className="prose prose-sm prose-zinc max-w-none prose-p:leading-normal prose-p:my-2 prose-headings:my-3 prose-ul:my-2 prose-li:my-0.5 prose-pre:bg-zinc-50 prose-pre:text-zinc-800 prose-pre:border prose-pre:border-zinc-200">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
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
        <div className="absolute bottom-6 left-0 right-0 px-4">
          <div className="max-w-3xl mx-auto">
             <div className="bg-white rounded-2xl shadow-xl border border-zinc-200/60 p-2 flex items-center gap-2 ring-1 ring-zinc-100">
                <Input
                  className="flex-1 border-none shadow-none focus-visible:ring-0 text-base text-zinc-700 placeholder:text-zinc-400 h-11 bg-transparent"
                  placeholder="Send a message..."
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  disabled={isLoading}
                />
                <Button
                  onClick={handleSend}
                  size="icon"
                  disabled={!input.trim() || isLoading}
                  className={`h-9 w-9 rounded-lg transition-all ${
                    input.trim() 
                      ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md' 
                      : 'bg-zinc-100 text-zinc-300 hover:bg-zinc-100 cursor-not-allowed'
                  }`}
                >
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-5 w-5" />}
                </Button>
              </div>
          </div>
        </div>
      )}
    </div>
  );
}
