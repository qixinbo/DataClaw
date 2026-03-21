import { useEffect, useMemo, useState } from "react";
import { useTranslation } from 'react-i18next';
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
  api_key?: string;
  api_base?: string;
  extra_headers?: Record<string, string>;
  is_active: boolean;
}

const defaultForm: Omit<ModelConfig, "id"> = {
  name: "",
  provider: "openai",
  model: "",
  api_key: "",
  api_base: "",
  extra_headers: {},
  is_active: true,
};

export function ModelConfigs() {
  const { t } = useTranslation();
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
      [item.name, item.model, item.provider].filter(Boolean).some((v) => String(v).toLowerCase().includes(value))
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
    if (!form.model || !form.provider) {
      setError(t('fillRequiredInfoFirst'));
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
          setError(t('extraConfigMustBeValidJson'));
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
      alert(t('connectionTestSuccessful'));
    } catch (e: any) {
      setError(e.message || t('connectionTestFailed'));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.model || !form.provider) {
      setError(t('fillRequiredFields'));
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
          setError(t('extraConfigMustBeValidJson'));
          setIsSaving(false);
          return;
        }
      }
      const payload = {
        ...form,
        extra_headers: extraHeaders,
        name: form.name || form.model,
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
      setError(e.message || t('failedToSaveConfig'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('confirmDeleteModel'))) return;
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
        <div className="text-zinc-500 text-lg">{t('noPermissionAdminOnly')}</div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col h-full bg-zinc-50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-zinc-100 bg-white">
        <div className="flex items-center gap-2 text-zinc-700 font-medium">
          <Brain className="h-5 w-5 text-indigo-500" />{t('modelConfig')}</div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="h-4 w-4 text-zinc-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t('searchModel')} className="w-[200px] pl-9 h-8 text-sm" />
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8 text-zinc-500" onClick={fetchConfigs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-white text-sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />{t('addModel')}</Button>
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
                  <TableHead>{t('modelName')}</TableHead>
                  <TableHead>{t('provider')}</TableHead>
                  <TableHead>{t('modelIdentifier')}</TableHead>
                  <TableHead>{t('status')}</TableHead>
                  <TableHead className="text-right">{t('actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConfigs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center h-24 text-zinc-500">{t('noModelData')}</TableCell>
                  </TableRow>
                ) : (
                  filteredConfigs.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.name || item.model}
                      </TableCell>
                      <TableCell className="capitalize">{item.provider}</TableCell>
                      <TableCell className="text-zinc-500 font-mono text-xs">{item.model}</TableCell>
                      <TableCell>
                        <span 
                          onClick={() => handleSetDefault(item)}
                          className={`inline-flex px-2 py-1 rounded-full text-xs font-medium cursor-pointer transition-colors ${item.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
                          title={item.is_active ? t('currentDefaultModel') : t('clickToSetDefault')}
                        >
                          {item.is_active ? t('default') : t('setDefault')}
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
              <DialogTitle>{editingId ? t('editModel') : t('addModel')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{error}</div>}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('modelName')}</Label>
                  <Input value={form.name || ""} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder={t('egGpt4')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('providerRequired')}</Label>
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
                      <SelectItem value="zhipuai">{t('zhipuAi')}</SelectItem>
                      <SelectItem value="moonshot">Moonshot (Kimi)</SelectItem>
                      <SelectItem value="dashscope">{t('dashScope')}</SelectItem>
                      <SelectItem value="volcengine">{t('volcengine')}</SelectItem>
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
                  <Label>{t('modelIdRequired')}</Label>
                  <Input value={form.model || ""} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} placeholder={t('egGpt4Turbo')} required />
                </div>
                <div className="space-y-2">
                  <Label>{t('apiDomain')}</Label>
                  <Input value={form.api_base || ""} onChange={(e) => setForm((p) => ({ ...p, api_base: e.target.value }))} placeholder={t('egApiDomain')} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="relative">
                  <Input
                    type={showApiKey ? "text" : "password"}
                    value={form.api_key || ""}
                    onChange={(e) => setForm((p) => ({ ...p, api_key: e.target.value }))}
                    className="pr-10"
                    placeholder={t('leaveBlankIfNotModifying')}
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
                <Label>{t('extraConfigJson')}</Label>
                <Textarea value={extraConfigText} onChange={(e) => setExtraConfigText(e.target.value)} className="min-h-[80px] font-mono text-xs" placeholder='{"timeout": "60"}' />
              </div>
            </div>
            <DialogFooter className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" onClick={handleTestConnection} disabled={isTesting}>
                {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                测试连接
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t('cancel')}</Button>
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

