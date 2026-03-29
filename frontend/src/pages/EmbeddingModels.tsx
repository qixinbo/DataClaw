import { useEffect, useMemo, useState } from "react";
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { Loader2, Plus, RefreshCw, Search, Trash2, Pencil, Eye, EyeOff, Brain } from "lucide-react";
import { useAuthStore } from "@/store/authStore";

interface EmbeddingModelConfig {
  id: string;
  name?: string;
  provider: string;
  model: string;
  api_key?: string;
  api_base?: string;
}

const defaultForm: Omit<EmbeddingModelConfig, "id"> = {
  name: "",
  provider: "openai",
  model: "",
  api_key: "",
  api_base: "",
};

export function EmbeddingModels() {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const isAdmin = !!user?.is_admin;
  const [configs, setConfigs] = useState<EmbeddingModelConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [keyword, setKeyword] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [form, setForm] = useState<Omit<EmbeddingModelConfig, "id">>(defaultForm);

  const fetchConfigs = async () => {
    setIsLoading(true);
    try {
      const data = await api.get<EmbeddingModelConfig[]>("/api/v1/embedding-models");
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
    setError("");
    setShowApiKey(false);
    setDialogOpen(true);
  };

  const openEdit = (item: EmbeddingModelConfig) => {
    setEditingId(item.id);
    setForm({
      name: item.name || "",
      provider: item.provider || "openai",
      model: item.model || "",
      api_key: item.api_key || "",
      api_base: item.api_base || "",
    });
    setError("");
    setShowApiKey(false);
    setDialogOpen(true);
  };

  const [isTesting, setIsTesting] = useState(false);

  const handleTestConnection = async () => {
    if (!form.model || !form.provider) {
      setError(t('fillRequiredInfoFirst', 'Please fill required info first'));
      return;
    }
    setIsTesting(true);
    setError("");
    try {
      const payload = {
        provider: form.provider,
        model: form.model,
        api_key: form.api_key,
        api_base: form.api_base,
      };

      await api.post("/api/v1/embedding-models/test", payload);
      alert(t('connectionTestSuccessful', 'Connection test successful'));
    } catch (e: any) {
      setError(e.message || t('connectionTestFailed', 'Connection test failed'));
    } finally {
      setIsTesting(false);
    }
  };

  const handleSave = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!form.model || !form.provider) {
      setError(t('fillRequiredFields', 'Please fill required fields'));
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      const payload = {
        ...form,
        name: form.name || form.model,
      };
      if (editingId) {
        await api.put(`/api/v1/embedding-models/${editingId}`, payload);
      } else {
        await api.post("/api/v1/embedding-models", payload);
      }
      setDialogOpen(false);
      await fetchConfigs();
    } catch (e: any) {
      setError(e.message || t('failedToSaveConfig', 'Failed to save config'));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm(t('confirmDeleteModel', 'Are you sure to delete this model?'))) return;
    try {
      await api.delete(`/api/v1/embedding-models/${id}`);
      await fetchConfigs();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-muted/50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-background">
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <Brain className="h-5 w-5 text-indigo-500" />{t('embeddingModels')}</div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder={t('searchModel', 'Search model')} className="w-[200px] pl-9 h-8 text-sm" />
          </div>
          <Button variant="outline" size="icon" className="h-8 w-8 text-muted-foreground" onClick={fetchConfigs}>
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button className="h-8 px-3 bg-indigo-600 hover:bg-indigo-700 text-primary-foreground text-sm" onClick={openCreate} disabled={!isAdmin}>
            <Plus className="h-4 w-4 mr-1" />{t('addModel', 'Add Model')}</Button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="bg-background rounded-xl border border-border shadow-sm overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('modelName', 'Model Name')}</TableHead>
                  <TableHead>{t('provider', 'Provider')}</TableHead>
                  <TableHead>{t('modelIdentifier', 'Model Identifier')}</TableHead>
                  <TableHead className="text-right">{t('actions', 'Actions')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredConfigs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center h-24 text-muted-foreground">{t('noModelData', 'No model data')}</TableCell>
                  </TableRow>
                ) : (
                  filteredConfigs.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">
                        {item.name || item.model}
                      </TableCell>
                      <TableCell className="capitalize">{item.provider}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{item.model}</TableCell>
                      <TableCell className="text-right">
                        {isAdmin && (
                          <>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-indigo-600"
                              onClick={() => openEdit(item)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-red-600"
                              onClick={() => handleDelete(item.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
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
              <DialogTitle>{editingId ? t('editModel', 'Edit Model') : t('addModel', 'Add Model')}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-2">{error}</div>}
              
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('modelName', 'Model Name')}</Label>
                  <Input value={form.name || ""} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} placeholder={t('egTextEmbedding3Small', 'e.g. text-embedding-3-small')} />
                </div>
                <div className="space-y-2">
                  <Label>{t('providerRequired', 'Provider (Required)')}</Label>
                  <Select value={form.provider} onValueChange={(v) => setForm((p) => ({ ...p, provider: v || "openai" }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent className="max-h-[300px]">
                      <SelectItem value="openai">OpenAI</SelectItem>
                      <SelectItem value="azure">Azure OpenAI</SelectItem>
                      <SelectItem value="ollama">Ollama</SelectItem>
                      <SelectItem value="local">Local (OpenAI Compatible)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>{t('modelIdRequired', 'Model ID (Required)')}</Label>
                  <Input value={form.model || ""} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} placeholder="text-embedding-3-small" required />
                </div>
                <div className="space-y-2">
                  <Label>{t('apiDomain', 'API Base URL')}</Label>
                  <Input value={form.api_base || ""} onChange={(e) => setForm((p) => ({ ...p, api_base: e.target.value }))} placeholder={t('egApiDomain', 'e.g. https://api.openai.com/v1')} />
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
                    placeholder={t('leaveBlankIfNotModifying', 'Leave blank if not modifying')}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
                    onClick={() => setShowApiKey((v) => !v)}
                  >
                    {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
            <DialogFooter className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" onClick={handleTestConnection} disabled={isTesting}>
                {isTesting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                {t('testConnection', 'Test Connection')}
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>{t('cancel', 'Cancel')}</Button>
                <Button type="submit" disabled={isSaving} className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground">
                  {isSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  {t('save', 'Save')}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
