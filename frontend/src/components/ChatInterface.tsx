import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { User, Loader2, Sparkles, Search, ArrowUp, ChevronDown, Table, Paperclip } from "lucide-react";
import { api } from "@/lib/api";
import { useVisualizationStore } from "@/store/visualizationStore";

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'assistant', content: 'Hello! I am DataClaw. How can I help you analyze your data today?' }
  ]);
  const [input, setInput] = useState("");
  const selectedSkill = "sql-generator";
  const selectedDataSource = "postgres-main";
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { setVisualization, setLoading: setVizLoading, setError: setVizError } = useVisualizationStore();
  
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
      if (selectedSkill === 'sql-generator' || selectedSkill === 'chart-creator') {
         // Use NL2SQL agent
         const source = selectedDataSource.split('-')[0]; // postgres-main -> postgres
         const response = await api.post<{sql?: string, result?: unknown, error?: string}>('/api/v1/agent/nl2sql', {
            query: newMessage.content,
            source: source
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

      } else {
         // General Chat
         const response = await api.post<{response: string}>('/nanobot/chat', {
             message: newMessage.content,
             skill_ids: [selectedSkill] 
         });
         
         setMessages(prev => [...prev, { 
            id: (Date.now() + 1).toString(), 
            role: 'assistant', 
            content: response.response 
         }]);
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
      <div className="absolute top-0 left-0 w-full px-6 py-4 z-10">
        <button className="flex items-center gap-2 text-sm font-medium text-zinc-600 hover:bg-zinc-100 px-3 py-1.5 rounded-lg transition-colors">
          glm-4-7-251222
          <ChevronDown className="h-4 w-4 text-zinc-400" />
        </button>
      </div>

      <ScrollArea className="flex-1">
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
                          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${cap.bg} ${cap.color} hover:opacity-80`}
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
            <div className="max-w-3xl mx-auto py-8 px-4 pb-32 space-y-8">
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
                        : "bg-white border border-zinc-100 text-zinc-700"
                    }`}
                  >
                    {msg.content}
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
