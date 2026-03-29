import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Save, Loader2, Database, RefreshCw, Pencil, Trash2, FileText, Plus } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

interface KnowledgeBase {
  id: string;
  name: string;
  description?: string;
  project_id?: number | null;
  embedding_model?: string | null;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  is_active: boolean;
  updated_at: string;
  documents?: Array<{ id: string }>;
}

interface KnowledgeBaseForm {
  name: string;
  description: string;
  embedding_model: string;
  chunk_size: number;
  chunk_overlap: number;
  top_k: number;
  is_active: boolean;
}

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface EmbeddingModelConfig {
  id: string;
  name?: string;
  provider: string;
  model: string;
}

const defaultKnowledgeBaseForm: KnowledgeBaseForm = {
  name: '',
  description: '',
  embedding_model: '',
  chunk_size: 512,
  chunk_overlap: 50,
  top_k: 3,
  is_active: true,
};

const defaultKnowledgeDocumentForm = {
  title: '',
  content: '',
  metadata: '',
};

export function KnowledgeBases() {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();
  const [isLoadingKnowledgeBases, setIsLoadingKnowledgeBases] = useState(false);
  const [isSavingKnowledgeBase, setIsSavingKnowledgeBase] = useState(false);
  const [deletingKnowledgeBaseId, setDeletingKnowledgeBaseId] = useState('');
  const [reindexingKnowledgeBaseId, setReindexingKnowledgeBaseId] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [editingKnowledgeBaseId, setEditingKnowledgeBaseId] = useState('');
  const [knowledgeBaseForm, setKnowledgeBaseForm] = useState<KnowledgeBaseForm>(defaultKnowledgeBaseForm);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('');
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingKnowledgeDocuments, setIsLoadingKnowledgeDocuments] = useState(false);
  const [isSavingKnowledgeDocument, setIsSavingKnowledgeDocument] = useState(false);
  const [deletingKnowledgeDocumentId, setDeletingKnowledgeDocumentId] = useState('');
  const [editingKnowledgeDocumentId, setEditingKnowledgeDocumentId] = useState('');
  const [knowledgeDocumentForm, setKnowledgeDocumentForm] = useState(defaultKnowledgeDocumentForm);
  const [uploadingKnowledgeDocuments, setUploadingKnowledgeDocuments] = useState(false);
  const [knowledgeUploadFiles, setKnowledgeUploadFiles] = useState<File[]>([]);
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelConfig[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    void fetchKnowledgeBases();
  }, [currentProject?.id]);

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

  const fetchKnowledgeBases = async () => {
    if (!currentProject) {
      setKnowledgeBases([]);
      return;
    }
    setIsLoadingKnowledgeBases(true);
    try {
      const data = await api.get<KnowledgeBase[]>(`/api/v1/knowledge-bases?project_id=${currentProject.id}`);
      setKnowledgeBases(data);
      if (editingKnowledgeBaseId && !data.find((item) => item.id === editingKnowledgeBaseId)) {
        setEditingKnowledgeBaseId('');
        setKnowledgeBaseForm(defaultKnowledgeBaseForm);
      }
      if (selectedKnowledgeBaseId && !data.find((item) => item.id === selectedKnowledgeBaseId)) {
        setSelectedKnowledgeBaseId('');
        setKnowledgeDocuments([]);
        setEditingKnowledgeDocumentId('');
        setKnowledgeDocumentForm(defaultKnowledgeDocumentForm);
      }
    } catch (err: any) {
      setError(err.message || t('knowledgeBaseLoadFailed', 'Failed to load knowledge bases'));
    } finally {
      setIsLoadingKnowledgeBases(false);
    }
  };

  const resetKnowledgeBaseForm = () => {
    setEditingKnowledgeBaseId('');
    setKnowledgeBaseForm(defaultKnowledgeBaseForm);
  };

  const validateKnowledgeBaseForm = () => {
    if (!currentProject) {
      return t('selectProjectBeforeManageKnowledgeBase', 'Please select a project before managing knowledge bases');
    }
    if (!knowledgeBaseForm.name.trim()) {
      return t('knowledgeBaseNameRequired', 'Knowledge base name is required');
    }
    if (knowledgeBaseForm.chunk_size < 64 || knowledgeBaseForm.chunk_size > 4096) {
      return t('knowledgeBaseChunkSizeRange', 'Chunk size must be between 64 and 4096');
    }
    if (knowledgeBaseForm.chunk_overlap < 0 || knowledgeBaseForm.chunk_overlap > 512) {
      return t('knowledgeBaseChunkOverlapRange', 'Chunk overlap must be between 0 and 512');
    }
    if (knowledgeBaseForm.chunk_overlap >= knowledgeBaseForm.chunk_size) {
      return t('knowledgeBaseChunkOverlapTooLarge', 'Chunk overlap must be less than chunk size');
    }
    if (knowledgeBaseForm.top_k < 1 || knowledgeBaseForm.top_k > 20) {
      return t('knowledgeBaseTopKRange', 'Top K must be between 1 and 20');
    }
    return '';
  };

  const handleSaveKnowledgeBase = async () => {
    setError('');
    setSuccess('');
    const validationMessage = validateKnowledgeBaseForm();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    if (!currentProject) return;
    setIsSavingKnowledgeBase(true);
    try {
      const payload = {
        name: knowledgeBaseForm.name.trim(),
        description: knowledgeBaseForm.description.trim() || null,
        embedding_model: knowledgeBaseForm.embedding_model.trim() || null,
        chunk_size: knowledgeBaseForm.chunk_size,
        chunk_overlap: knowledgeBaseForm.chunk_overlap,
        top_k: knowledgeBaseForm.top_k,
        is_active: knowledgeBaseForm.is_active,
        project_id: currentProject.id,
      };
      if (editingKnowledgeBaseId) {
        await api.put(`/api/v1/knowledge-bases/${editingKnowledgeBaseId}`, payload);
        setSuccess(t('knowledgeBaseUpdated', 'Knowledge base updated successfully'));
      } else {
        await api.post('/api/v1/knowledge-bases', payload);
        setSuccess(t('knowledgeBaseCreated', 'Knowledge base created successfully'));
      }
      await fetchKnowledgeBases();
      resetKnowledgeBaseForm();
    } catch (err: any) {
      setError(err.message || t('knowledgeBaseSaveFailed', 'Failed to save knowledge base'));
    } finally {
      setIsSavingKnowledgeBase(false);
    }
  };

  const handleEditKnowledgeBase = (item: KnowledgeBase) => {
    setEditingKnowledgeBaseId(item.id);
    setKnowledgeBaseForm({
      name: item.name || '',
      description: item.description || '',
      embedding_model: item.embedding_model || '',
      chunk_size: item.chunk_size,
      chunk_overlap: item.chunk_overlap,
      top_k: item.top_k,
      is_active: item.is_active,
    });
  };

  const handleDeleteKnowledgeBase = async (id: string) => {
    if (!window.confirm(t('confirmDeleteKnowledgeBase', 'Are you sure to delete this knowledge base?'))) {
      return;
    }
    setError('');
    setSuccess('');
    setDeletingKnowledgeBaseId(id);
    try {
      await api.delete(`/api/v1/knowledge-bases/${id}`);
      setSuccess(t('knowledgeBaseDeleted', 'Knowledge base deleted successfully'));
      if (editingKnowledgeBaseId === id) {
        resetKnowledgeBaseForm();
      }
      if (selectedKnowledgeBaseId === id) {
        setSelectedKnowledgeBaseId('');
        setKnowledgeDocuments([]);
        setEditingKnowledgeDocumentId('');
        setKnowledgeDocumentForm(defaultKnowledgeDocumentForm);
      }
      await fetchKnowledgeBases();
    } catch (err: any) {
      setError(err.message || t('knowledgeBaseDeleteFailed', 'Failed to delete knowledge base'));
    } finally {
      setDeletingKnowledgeBaseId('');
    }
  };

  const handleReindexKnowledgeBase = async (id: string) => {
    setError('');
    setSuccess('');
    setReindexingKnowledgeBaseId(id);
    try {
      await api.post(`/api/v1/knowledge-bases/${id}/reindex`, {});
      setSuccess(t('knowledgeBaseReindexSuccess', 'Knowledge base reindexed successfully'));
    } catch (err: any) {
      setError(err.message || t('knowledgeBaseReindexFailed', 'Failed to reindex knowledge base'));
    } finally {
      setReindexingKnowledgeBaseId('');
    }
  };

  const resetKnowledgeDocumentForm = () => {
    setEditingKnowledgeDocumentId('');
    setKnowledgeDocumentForm(defaultKnowledgeDocumentForm);
  };

  const fetchKnowledgeDocuments = async (kbId: string) => {
    if (!kbId) {
      setKnowledgeDocuments([]);
      return;
    }
    setIsLoadingKnowledgeDocuments(true);
    try {
      const data = await api.get<KnowledgeDocument[]>(`/api/v1/knowledge-bases/${kbId}/documents`);
      setKnowledgeDocuments(data);
      if (editingKnowledgeDocumentId && !data.find((item) => item.id === editingKnowledgeDocumentId)) {
        resetKnowledgeDocumentForm();
      }
    } catch (err: any) {
      setError(err.message || t('knowledgeDocumentLoadFailed', 'Failed to load knowledge documents'));
    } finally {
      setIsLoadingKnowledgeDocuments(false);
    }
  };

  const handleOpenKnowledgeDocuments = async (kbId: string) => {
    if (selectedKnowledgeBaseId === kbId) {
      setSelectedKnowledgeBaseId('');
      setKnowledgeDocuments([]);
      resetKnowledgeDocumentForm();
      return;
    }
    setSelectedKnowledgeBaseId(kbId);
    resetKnowledgeDocumentForm();
    await fetchKnowledgeDocuments(kbId);
  };

  const validateKnowledgeDocumentForm = () => {
    if (!selectedKnowledgeBaseId) {
      return t('selectKnowledgeBaseToManageDocuments', 'Please select a knowledge base to manage documents');
    }
    if (!knowledgeDocumentForm.title.trim()) {
      return t('knowledgeDocumentTitleRequired', 'Document title is required');
    }
    if (!knowledgeDocumentForm.content.trim()) {
      return t('knowledgeDocumentContentRequired', 'Document content is required');
    }
    const metadataText = knowledgeDocumentForm.metadata.trim();
    if (!metadataText) {
      return '';
    }
    try {
      JSON.parse(metadataText);
      return '';
    } catch {
      return t('knowledgeDocumentMetadataInvalid', 'Document metadata must be valid JSON');
    }
  };

  const handleSaveKnowledgeDocument = async () => {
    setError('');
    setSuccess('');
    const validationMessage = validateKnowledgeDocumentForm();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    if (!selectedKnowledgeBaseId) return;
    setIsSavingKnowledgeDocument(true);
    try {
      const metadataText = knowledgeDocumentForm.metadata.trim();
      const payload = {
        title: knowledgeDocumentForm.title.trim(),
        content: knowledgeDocumentForm.content.trim(),
        metadata: metadataText ? JSON.parse(metadataText) : {},
      };
      if (editingKnowledgeDocumentId) {
        await api.put(`/api/v1/knowledge-bases/${selectedKnowledgeBaseId}/documents/${editingKnowledgeDocumentId}`, payload);
        setSuccess(t('knowledgeDocumentUpdated', 'Knowledge document updated successfully'));
      } else {
        await api.post(`/api/v1/knowledge-bases/${selectedKnowledgeBaseId}/documents`, payload);
        setSuccess(t('knowledgeDocumentCreated', 'Knowledge document created successfully'));
      }
      await fetchKnowledgeDocuments(selectedKnowledgeBaseId);
      await fetchKnowledgeBases();
      resetKnowledgeDocumentForm();
    } catch (err: any) {
      setError(err.message || t('knowledgeDocumentSaveFailed', 'Failed to save knowledge document'));
    } finally {
      setIsSavingKnowledgeDocument(false);
    }
  };

  const handleEditKnowledgeDocument = (item: KnowledgeDocument) => {
    setEditingKnowledgeDocumentId(item.id);
    setKnowledgeDocumentForm({
      title: item.title || '',
      content: item.content || '',
      metadata: item.metadata && Object.keys(item.metadata).length > 0 ? JSON.stringify(item.metadata, null, 2) : '',
    });
  };

  const handleDeleteKnowledgeDocument = async (docId: string) => {
    if (!selectedKnowledgeBaseId) return;
    if (!window.confirm(t('confirmDeleteKnowledgeDocument', 'Are you sure to delete this document?'))) {
      return;
    }
    setError('');
    setSuccess('');
    setDeletingKnowledgeDocumentId(docId);
    try {
      await api.delete(`/api/v1/knowledge-bases/${selectedKnowledgeBaseId}/documents/${docId}`);
      if (editingKnowledgeDocumentId === docId) {
        resetKnowledgeDocumentForm();
      }
      setSuccess(t('knowledgeDocumentDeleted', 'Knowledge document deleted successfully'));
      await fetchKnowledgeDocuments(selectedKnowledgeBaseId);
      await fetchKnowledgeBases();
    } catch (err: any) {
      setError(err.message || t('knowledgeDocumentDeleteFailed', 'Failed to delete knowledge document'));
    } finally {
      setDeletingKnowledgeDocumentId('');
    }
  };

  const handleUploadKnowledgeDocuments = async () => {
    setError('');
    setSuccess('');
    if (!selectedKnowledgeBaseId) {
      setError(t('selectKnowledgeBaseToManageDocuments', 'Please select a knowledge base to manage documents'));
      return;
    }
    if (knowledgeUploadFiles.length === 0) {
      setError(t('knowledgeDocumentUploadEmpty', 'Please select files to upload'));
      return;
    }
    setUploadingKnowledgeDocuments(true);
    try {
      const formData = new FormData();
      knowledgeUploadFiles.forEach((file) => formData.append('files', file));
      await api.post(`/api/v1/knowledge-bases/${selectedKnowledgeBaseId}/documents/upload`, formData);
      setSuccess(t('knowledgeDocumentUploadSuccess', { count: knowledgeUploadFiles.length }));
      setKnowledgeUploadFiles([]);
      await fetchKnowledgeDocuments(selectedKnowledgeBaseId);
      await fetchKnowledgeBases();
    } catch (err: any) {
      setError(err.message || t('knowledgeDocumentUploadFailed', 'Failed to upload knowledge documents'));
    } finally {
      setUploadingKnowledgeDocuments(false);
    }
  };

  const selectedKnowledgeBase = knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId) || null;

  return (
    <div className="flex-1 flex flex-col h-full bg-muted/50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-background">
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <Database className="h-5 w-5 text-indigo-500" />
          {t('knowledgeBaseManagement', 'Knowledge Base Management')}
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="grid gap-6 max-w-4xl mx-auto">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">{error}</div>}
          {success && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-md p-3">{success}</div>}

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Database className="h-5 w-5 text-indigo-500" />
                {t('knowledgeBaseSettings')}
              </CardTitle>
              <CardDescription>{t('knowledgeBaseSettingsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                    value={knowledgeBaseForm.name}
                    placeholder={t('knowledgeBaseNamePlaceholder')}
                    onChange={(e) => setKnowledgeBaseForm((prev) => ({ ...prev, name: e.target.value }))}
                    disabled={!currentProject}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="knowledge-base-description">{t('description')}</Label>
                  <Input
                    id="knowledge-base-description"
                    value={knowledgeBaseForm.description}
                    placeholder={t('knowledgeBaseDescriptionPlaceholder')}
                    onChange={(e) => setKnowledgeBaseForm((prev) => ({ ...prev, description: e.target.value }))}
                    disabled={!currentProject}
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="knowledge-base-embedding-model">{t('knowledgeBaseEmbeddingModel')}</Label>
                  <Select
                    value={knowledgeBaseForm.embedding_model}
                    onValueChange={(val) => setKnowledgeBaseForm((prev) => ({ ...prev, embedding_model: val || '' }))}
                    disabled={!currentProject}
                  >
                    <SelectTrigger id="knowledge-base-embedding-model">
                      <SelectValue placeholder={t('knowledgeBaseEmbeddingModelPlaceholder', 'Select an embedding model')} />
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
                    value={knowledgeBaseForm.chunk_size}
                    onChange={(e) => setKnowledgeBaseForm((prev) => ({ ...prev, chunk_size: Number(e.target.value) || 0 }))}
                    disabled={!currentProject}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="knowledge-base-chunk-overlap">{t('knowledgeBaseChunkOverlap')}</Label>
                  <Input
                    id="knowledge-base-chunk-overlap"
                    type="number"
                    value={knowledgeBaseForm.chunk_overlap}
                    onChange={(e) => setKnowledgeBaseForm((prev) => ({ ...prev, chunk_overlap: Number(e.target.value) || 0 }))}
                    disabled={!currentProject}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="knowledge-base-top-k">{t('knowledgeBaseTopK')}</Label>
                  <Input
                    id="knowledge-base-top-k"
                    type="number"
                    value={knowledgeBaseForm.top_k}
                    onChange={(e) => setKnowledgeBaseForm((prev) => ({ ...prev, top_k: Number(e.target.value) || 0 }))}
                    disabled={!currentProject}
                  />
                </div>

                <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 mt-7">
                  <Label htmlFor="knowledge-base-active">{t('activeStatus')}</Label>
                  <Switch
                    id="knowledge-base-active"
                    checked={knowledgeBaseForm.is_active}
                    onCheckedChange={(checked) => setKnowledgeBaseForm((prev) => ({ ...prev, is_active: checked }))}
                    disabled={!currentProject}
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2">
                {editingKnowledgeBaseId ? (
                  <Button variant="outline" onClick={resetKnowledgeBaseForm} disabled={isSavingKnowledgeBase}>
                    {t('cancel')}
                  </Button>
                ) : null}
                <Button onClick={handleSaveKnowledgeBase} disabled={!currentProject || isSavingKnowledgeBase}>
                  {isSavingKnowledgeBase ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                  {editingKnowledgeBaseId ? t('updateKnowledgeBase') : t('createKnowledgeBase')}
                </Button>
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <div className="font-medium text-sm text-foreground/80">{t('knowledgeBaseList')}</div>
                {isLoadingKnowledgeBases ? (
                  <div className="h-20 flex items-center justify-center text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                ) : knowledgeBases.length === 0 ? (
                  <div className="text-sm text-muted-foreground rounded-md border border-dashed border-border p-4">
                    {t('noKnowledgeBases')}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {knowledgeBases.map((item) => (
                      <div key={item.id} className="rounded-lg border border-border p-3 flex items-start justify-between gap-3">
                        <div className="space-y-1 min-w-0">
                          <div className="font-medium text-sm text-foreground truncate">{item.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {t('knowledgeBaseMeta', {
                              count: item.documents?.length || 0,
                              updatedAt: new Date(item.updated_at).toLocaleString(),
                            })}
                          </div>
                          {item.description ? (
                            <div className="text-xs text-muted-foreground break-words">{item.description}</div>
                          ) : null}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              void handleOpenKnowledgeDocuments(item.id);
                            }}
                            title={t('manageKnowledgeDocuments')}
                          >
                            {selectedKnowledgeBaseId === item.id ? <Plus className="h-4 w-4 text-indigo-500" /> : <FileText className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleEditKnowledgeBase(item)} title={t('editKnowledgeBase')}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              void handleReindexKnowledgeBase(item.id);
                            }}
                            disabled={reindexingKnowledgeBaseId === item.id}
                            title={t('reindexKnowledgeBase')}
                          >
                            {reindexingKnowledgeBaseId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              void handleDeleteKnowledgeBase(item.id);
                            }}
                            disabled={deletingKnowledgeBaseId === item.id}
                            title={t('deleteKnowledgeBase')}
                          >
                            {deletingKnowledgeBaseId === item.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-500" />}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="border-t border-border pt-4 space-y-3">
                <div className="font-medium text-sm text-foreground/80">
                  {selectedKnowledgeBase
                    ? t('knowledgeDocumentManagerTitle', { name: selectedKnowledgeBase.name })
                    : t('knowledgeDocumentManagerTitleEmpty')}
                </div>
                {!selectedKnowledgeBase ? (
                  <div className="text-sm text-muted-foreground rounded-md border border-dashed border-border p-4">
                    {t('selectKnowledgeBaseToManageDocuments')}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-border p-3 space-y-3">
                      <div className="text-sm font-medium text-foreground">{t('knowledgeDocumentUploadTitle')}</div>
                      <Input
                        type="file"
                        multiple
                        onChange={(e) => setKnowledgeUploadFiles(Array.from(e.target.files || []))}
                        disabled={uploadingKnowledgeDocuments}
                      />
                      <div className="text-xs text-muted-foreground">
                        {t('knowledgeDocumentUploadHint')}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-muted-foreground">
                          {knowledgeUploadFiles.length > 0
                            ? t('knowledgeDocumentUploadSelected', { count: knowledgeUploadFiles.length })
                            : t('knowledgeDocumentUploadNone')}
                        </div>
                        <Button onClick={handleUploadKnowledgeDocuments} disabled={uploadingKnowledgeDocuments || knowledgeUploadFiles.length === 0}>
                          {uploadingKnowledgeDocuments ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                          {t('knowledgeDocumentUploadAction')}
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="knowledge-doc-title">{t('knowledgeDocumentTitle')}</Label>
                        <Input
                          id="knowledge-doc-title"
                          value={knowledgeDocumentForm.title}
                          placeholder={t('knowledgeDocumentTitlePlaceholder')}
                          onChange={(e) => setKnowledgeDocumentForm((prev) => ({ ...prev, title: e.target.value }))}
                          disabled={isSavingKnowledgeDocument}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="knowledge-doc-content">{t('knowledgeDocumentContent')}</Label>
                        <Textarea
                          id="knowledge-doc-content"
                          value={knowledgeDocumentForm.content}
                          placeholder={t('knowledgeDocumentContentPlaceholder')}
                          onChange={(e) => setKnowledgeDocumentForm((prev) => ({ ...prev, content: e.target.value }))}
                          disabled={isSavingKnowledgeDocument}
                          rows={5}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="knowledge-doc-metadata">{t('knowledgeDocumentMetadata')}</Label>
                        <Textarea
                          id="knowledge-doc-metadata"
                          value={knowledgeDocumentForm.metadata}
                          placeholder={t('knowledgeDocumentMetadataPlaceholder')}
                          onChange={(e) => setKnowledgeDocumentForm((prev) => ({ ...prev, metadata: e.target.value }))}
                          disabled={isSavingKnowledgeDocument}
                          rows={3}
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-end gap-2">
                      {editingKnowledgeDocumentId ? (
                        <Button variant="outline" onClick={resetKnowledgeDocumentForm} disabled={isSavingKnowledgeDocument}>
                          {t('cancel')}
                        </Button>
                      ) : null}
                      <Button onClick={handleSaveKnowledgeDocument} disabled={isSavingKnowledgeDocument}>
                        {isSavingKnowledgeDocument ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                        {editingKnowledgeDocumentId ? t('updateKnowledgeDocument') : t('createKnowledgeDocument')}
                      </Button>
                    </div>

                    {isLoadingKnowledgeDocuments ? (
                      <div className="h-20 flex items-center justify-center text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    ) : knowledgeDocuments.length === 0 ? (
                      <div className="text-sm text-muted-foreground rounded-md border border-dashed border-border p-4">
                        {t('noKnowledgeDocuments')}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {knowledgeDocuments.map((doc) => (
                          <div key={doc.id} className="rounded-lg border border-border p-3 flex items-start justify-between gap-3">
                            <div className="space-y-1 min-w-0">
                              <div className="font-medium text-sm text-foreground truncate">{doc.title}</div>
                              <div className="text-xs text-muted-foreground">
                                {t('knowledgeDocumentMeta', {
                                  updatedAt: new Date(doc.updated_at).toLocaleString(),
                                })}
                              </div>
                              <div className="text-xs text-muted-foreground break-words">{doc.content.slice(0, 120)}</div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <Button variant="ghost" size="icon" onClick={() => handleEditKnowledgeDocument(doc)} title={t('editKnowledgeDocument')}>
                                <Pencil className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => {
                                  void handleDeleteKnowledgeDocument(doc.id);
                                }}
                                disabled={deletingKnowledgeDocumentId === doc.id}
                                title={t('deleteKnowledgeDocument')}
                              >
                                {deletingKnowledgeDocumentId === doc.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-red-500" />}
                              </Button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
            <CardFooter className="bg-muted/50/50 border-t border-border pt-6">
              <Button variant="outline" onClick={() => void fetchKnowledgeBases()} disabled={!currentProject || isLoadingKnowledgeBases} className="ml-auto">
                {isLoadingKnowledgeBases ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                {t('refreshKnowledgeBaseList')}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
