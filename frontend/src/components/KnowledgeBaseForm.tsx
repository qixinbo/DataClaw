import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Save, Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useProjectStore } from "@/store/projectStore";
import { api } from "@/lib/api";

export interface KnowledgeBaseFormValues {
  name: string;
  description: string;
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  is_active: boolean;
}

export interface KnowledgeBaseFormProps {
  initialData?: KnowledgeBaseFormValues | null;
  onSubmit: (data: KnowledgeBaseFormValues) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
}

interface EmbeddingModelConfig {
  id: string;
  name?: string;
  provider: string;
  model: string;
}

const defaultFormValues: KnowledgeBaseFormValues = {
  name: '',
  description: '',
  embedding_model: '',
  chunk_size: 512,
  chunk_overlap: 50,
  top_k: 3,
  is_active: true,
};

export function KnowledgeBaseForm({ initialData, onSubmit, onCancel, isSubmitting = false }: KnowledgeBaseFormProps) {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();
  const [form, setForm] = useState<KnowledgeBaseFormValues>(initialData || defaultFormValues);
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelConfig[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void fetchEmbeddingModels();
  }, []);

  const fetchEmbeddingModels = async () => {
    try {
      const data = await api.get<EmbeddingModelConfig[]>('/api/v1/embedding-models');
      setEmbeddingModels(data);
    } catch (err) {
      console.error('Failed to fetch embedding models', err);
    }
  };

  const validate = () => {
    if (!currentProject) {
      return t('selectProjectBeforeManageKnowledgeBase', 'Please select a project before managing knowledge bases');
    }
    if (!form.name.trim()) {
      return t('knowledgeBaseNameRequired', 'Knowledge base name is required');
    }
    if (form.chunk_size < 64 || form.chunk_size > 4096) {
      return t('knowledgeBaseChunkSizeRange', 'Chunk size must be between 64 and 4096');
    }
    if (form.chunk_overlap < 0 || form.chunk_overlap > 512) {
      return t('knowledgeBaseChunkOverlapRange', 'Chunk overlap must be between 0 and 512');
    }
    if (form.chunk_overlap >= form.chunk_size) {
      return t('knowledgeBaseChunkOverlapTooLarge', 'Chunk overlap must be less than chunk size');
    }
    if (form.top_k < 1 || form.top_k > 20) {
      return t('knowledgeBaseTopKRange', 'Top K must be between 1 and 20');
    }
    return '';
  };

  const handleSubmit = async () => {
    setError('');
    const validationMessage = validate();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    try {
      await onSubmit(form);
    } catch (err: any) {
      setError(err.message || t('knowledgeBaseSaveFailed', 'Failed to save knowledge base'));
    }
  };

  const selectedEmbeddingModel = embeddingModels.find(m => m.id === form.embedding_model);

  return (
    <div className="space-y-6">
      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">{error}</div>}
      
      {!currentProject ? (
        <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
          {t('selectProjectBeforeManageKnowledgeBase')}
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="knowledge-base-name">{t('knowledgeBaseName')}</Label>
          <Input
            id="knowledge-base-name"
            value={form.name}
            placeholder={t('knowledgeBaseNamePlaceholder')}
            onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
            disabled={!currentProject || isSubmitting}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="knowledge-base-description">{t('description')}</Label>
          <Input
            id="knowledge-base-description"
            value={form.description}
            placeholder={t('knowledgeBaseDescriptionPlaceholder')}
            onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
            disabled={!currentProject || isSubmitting}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="knowledge-base-embedding-model">{t('knowledgeBaseEmbeddingModel')}</Label>
          <Select
            value={form.embedding_model}
            onValueChange={(val) => setForm((prev) => ({ ...prev, embedding_model: val || '' }))}
            disabled={!currentProject || isSubmitting}
          >
            <SelectTrigger id="knowledge-base-embedding-model">
              <SelectValue placeholder={t('knowledgeBaseEmbeddingModelPlaceholder')}>
                {selectedEmbeddingModel 
                  ? `${selectedEmbeddingModel.name || selectedEmbeddingModel.model} (${selectedEmbeddingModel.provider})`
                  : form.embedding_model || undefined}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {embeddingModels.map((model) => (
                <SelectItem key={model.id} value={model.id}>
                  {model.name || model.model} ({model.provider})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="knowledge-base-chunk-size">{t('knowledgeBaseChunkSize')}</Label>
          <Input
            id="knowledge-base-chunk-size"
            type="number"
            value={form.chunk_size}
            onChange={(e) => setForm((prev) => ({ ...prev, chunk_size: Number(e.target.value) || 0 }))}
            disabled={!currentProject || isSubmitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="knowledge-base-chunk-overlap">{t('knowledgeBaseChunkOverlap')}</Label>
          <Input
            id="knowledge-base-chunk-overlap"
            type="number"
            value={form.chunk_overlap}
            onChange={(e) => setForm((prev) => ({ ...prev, chunk_overlap: Number(e.target.value) || 0 }))}
            disabled={!currentProject || isSubmitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="knowledge-base-top-k">{t('knowledgeBaseTopK')}</Label>
          <Input
            id="knowledge-base-top-k"
            type="number"
            value={form.top_k}
            onChange={(e) => setForm((prev) => ({ ...prev, top_k: Number(e.target.value) || 0 }))}
            disabled={!currentProject || isSubmitting}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 mt-7 md:col-span-2">
          <Label htmlFor="knowledge-base-active">{t('activeStatus')}</Label>
          <Switch
            id="knowledge-base-active"
            checked={form.is_active}
            onCheckedChange={(checked) => setForm((prev) => ({ ...prev, is_active: checked }))}
            disabled={!currentProject || isSubmitting}
          />
        </div>
      </div>

      <div className="flex items-center justify-end gap-2 pt-4 border-t border-border">
        <Button variant="outline" onClick={onCancel} disabled={isSubmitting}>
          {t('cancel')}
        </Button>
        <Button onClick={handleSubmit} disabled={!currentProject || isSubmitting} className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground">
          {isSubmitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
