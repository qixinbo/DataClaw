import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { Loader2, Plus, RefreshCw, Search, Trash2, Pencil, Eye, EyeOff, Brain } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

interface ModelConfig {
  id: string;
  name?: string;
  provider: string;
  model: string;
  model_type?: string;
  base_model?: string;
  protocol_type?: string;
  api_key?: string;
  api_base?: string;
  extra_headers?: Record<string, string>;
  is_active: boolean;
}

const defaultForm: Omit<ModelConfig, "id"> = {
  name: "",
  provider: "openai",
  model: "",
  model_type: "LLM",
  base_model: "",
  protocol_type: "OpenAI",
  api_key: "",
  api_base: "",
  extra_headers: {},
  is_active: true,
};

export function ModelConfigs() {
  const { user } = useAuthStore();
  const isAdmin = !!user?.is_admin;
  const [configs, setConfigs] = useState<ModelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [extraConfigText, setExtraConfigText] = useState("{}");
  const [form, setForm] = useState<Omit<ModelConfig, "id">>(defaultForm);

  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      const data = await api.get<ModelConfig[]>("/api/v1/llm");
      setConfigs(data);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfigs();
  }, []);

  const filteredConfigs = useMemo(() => {
    const value = keyword.trim().toLowerCase();
    if (!value) return configs;
    return configs.filter((item) =>
      [item.name, item.model, item.provider, item.base_model].filter(Boolean).some((v) => String(v).toLowerCase().includes(value))
    );
  }, [configs, keyword]);

  const openCreate = () => {
    setEditingId(null);
    setForm(defaultForm);
    setExtraConfigText("{}");
    setError("");
    setShowApiKey(false);
    setDialogOpen(true);
  };

  const openEdit = (item: ModelConfig) => {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      provider: item.provider || "openai",
      model: item.model || "",
      model_type: item.model_type || "LLM",
      base_model: item.base_model || "",
      protocol_type: item.protocol_type || "OpenAI",
      api_key: item.api_key || "",
      api_base: item.api_base || "",
      extra_headers: item.extra_headers || {},
      is_active: item.is_active,
    });
    setExtraConfigText(JSON.stringify(item.extra_headers || {}, null, 2));
    setError("");
    setShowApiKey(false);
    setDialogOpen(true);
  };

  const [isTesting, setIsTesting] = useState(false);

  const handleTestConnection = async () => {
    if (!form.model || !form.provider || !form.api_base) {
      setError("请先填写必要信息（供应商、模型ID、API域名）");
      return;
    }
    setIsTesting(true);
    setError("");
    try {
      let extraHeaders: Record<string, string> = {};
      if (extraConfigText.trim()) {
        try {
          const parsed = JSON.parse(extraConfigText);
          if (parsed && typeof parsed === "object") extraHeaders = parsed;
        } catch (err) {
          setError("额外配置必须是有效的JSON");
          setIsTesting(false);
          return;
        }
      }
      
      const payload = {
        provider: form.provider,
        model: form.model,
        api_key: form.api_key,
        api_base: form.api_base,
        extra_headers: extraHeaders
      };

      await api.post("/api/v1/llm/test", payload);
      alert("连接测试成功！");
    } catch (e: any) {
      setError(e.message || "连接测试失败");
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.model || !form.provider || !form.api_base) {
      setError("请填写必填项");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      let extraHeaders: Record<string, string> = {};
      if (extraConfigText.trim()) {
        try {
          const parsed = JSON.parse(extraConfigText);
          if (parsed && typeof parsed === "object") extraHeaders = parsed;
        } catch (err) {
          setError("额外配置必须是有效的JSON");
          setIsSaving(false);
          return;
        }
      }
      const payload = {
        ...form,
        extra_headers: extraHeaders,
        name: form.name || form.model,
        model_type: form.model_type || "大语言模型",
        base_model: form.base_model || form.model,
        protocol_type: form.protocol_type || "OpenAI",
      };
      if (editingId) {
        await api.put(`/api/v1/llm/${editingId}`, payload);
      } else {
        const id = `${Date.now()}`;
        await api.post("/api/v1/llm", { ...payload, id });
      }
      setDialogOpen(false);
      await fetchConfigs();
    } catch (e: any) {
      setError(e.message || "保存配置失败");
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("确认删除该模型吗？")) return;
    try {
      await api.delete(`/api/v1/llm/${id}`);
      await fetchConfigs();
    } catch (e) {
      console.error(e);
    }
  };

  const handleSetDefault = async (item: ModelConfig) => {
    if (!isAdmin || item.is_active) return;
    try {
      await api.put(`/api/v1/llm/${item.id}`, { is_active: true });
      await fetchConfigs();
    } catch (e) {
      console.error(e);
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex-1 flex flex-col h-full bg-zinc-50/30 overflow-hidden items-center justify-center">
        <div className="text-zinc-500 text-lg">无权限访问此页面，请使用管理员账号登录。</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-zinc-100 bg-white">
        <div className="flex items-center gap-2 text-zinc-700 font-medium">
          <Brain className="h-5 w-5 text-indigo-500" />
          模型配置
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="搜索模型..." className="w-[200px] pl-9 h-8 text-sm" />
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8 text-zinc-500" onClick={fetchConfigs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            添加模型
          </Button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>模型名称</TableHead>
                  <TableHead>供应商</TableHead>
                  <TableHead>模型标识</TableHead>
                  <TableHead>模型类型</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConfigs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24 text-zinc-500">
                      暂无模型数据
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredConfigs.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.name || item.model}
                      </TableCell>
                      <TableCell className="capitalize">{item.provider}</TableCell>
                      <TableCell className="text-zinc-500 font-mono text-xs">{item.model}</TableCell>
                      <TableCell className="text-zinc-500">{item.model_type || "大语言模型"}</TableCell>
                      <TableCell>
                        <span 
                          onClick={() => handleSetDefault(item)}
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${item.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                          title={item.is_active ? "当前默认模型" : "点击设为默认"}
                        >
                          {item.is_active ? '默认' : '设为默认'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-zinc-500 hover:text-indigo-600"
                          onClick={() => openEdit(item)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-zinc-500 hover:text-red-600"
                          onClick={() => handleDelete(item.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </div>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <form onSubmit={handleSave}>
            <DialogHeader>
              <DialogTitle>{editingId ? "编辑模型" : "添加模型"}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{error}</div>}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>模型名称</Label>
                  <Input value={form.name || ""} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder="如：GPT-4" />
                </div>
                <div className="space-y-2">
                  <Label>供应商 *</Label>
                  <Select value={form.provider} onValueChange={(v) => setForm((p) => ({ ...p, provider: v || "openai" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="azure">Azure OpenAI</SelectItem>
                      <SelectItem value="anthropic">Anthropic</SelectItem>
                      <SelectItem value="vertex_ai">Google Vertex AI</SelectItem>
                      <SelectItem value="gemini">Google AI Studio (Gemini)</SelectItem>
                      <SelectItem value="bedrock">AWS Bedrock</SelectItem>
                      <SelectItem value="deepseek">DeepSeek</SelectItem>
                      <SelectItem value="zhipuai">ZhipuAI (智谱)</SelectItem>
                      <SelectItem value="moonshot">Moonshot (Kimi)</SelectItem>
                      <SelectItem value="dashscope">DashScope (通义千问)</SelectItem>
                      <SelectItem value="volcengine">Volcengine (火山引擎)</SelectItem>
                      <SelectItem value="groq">Groq</SelectItem>
                      <SelectItem value="cohere">Cohere</SelectItem>
                      <SelectItem value="mistral">Mistral</SelectItem>
                      <SelectItem value="openrouter">OpenRouter</SelectItem>
                      <SelectItem value="ollama">Ollama</SelectItem>
                      <SelectItem value="huggingface">HuggingFace</SelectItem>
                      <SelectItem value="local">Local (OpenAI Compatible)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>模型ID *</Label>
                  <Input value={form.model || ""} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} placeholder="如：gpt-4-turbo" required />
                </div>
                <div className="space-y-2">
                  <Label>模型类型</Label>
                  <Select value={form.model_type || "LLM"} onValueChange={(v) => setForm((p) => ({ ...p, model_type: v || "LLM" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="LLM">LLM</SelectItem>
                      <SelectItem value="Embedding">Embedding</SelectItem>
                      <SelectItem value="Rerank">Rerank</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>协议类型</Label>
                  <Select value={form.protocol_type || "OpenAI"} onValueChange={(v) => setForm((p) => ({ ...p, protocol_type: v || "OpenAI" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="OpenAI">OpenAI</SelectItem>
                      <SelectItem value="Anthropic">Anthropic</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label>API 域名 *</Label>
                <Input value={form.api_base || ""} onChange={(e) => setForm((p) => ({ ...p, api_base: e.target.value }))} placeholder="如：https://api.openai.com/v1" required />
              </div>

              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={form.api_key || ""}
                    onChange={(e) => setForm((p) => ({ ...p, api_key: e.target.value }))}
                    className="pr-10"
                    placeholder="不修改请留空"
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
                    onClick={() => setShowApiKey((v) => !v)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label>额外配置 (JSON)</Label>
                <Textarea value={extraConfigText} onChange={(e) => setExtraConfigText(e.target.value)} className="min-h-[80px] font-mono text-xs" placeholder='{"timeout": "60"}' />
              </div>
            </div>
            <DialogFooter className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" onClick={handleTestConnection} disabled={isTesting}>
                {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                测试连接
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>取消</Button>
                <Button type="submit" disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700 text-white">
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  保存
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

