import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Save, Loader2, Database, RefreshCw, Pencil, Trash2, FileText, Plus } from "lucide-react";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/authStore";
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

interface KnowledgeGlobalConfig {
  api_base?: string | null;
  api_key?: string | null;
  api_key_masked?: string | null;
  has_api_key: boolean;
  default_embedding_model?: string | null;
}

interface KnowledgeConnectionTestResult {
  success: boolean;
  message: string;
  model_name?: string | null;
  embedding_dimension?: number | null;
  resolved_api_base?: string | null;
  available_models?: string[];
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

export function Settings() {
  const { t } = useTranslation();
  const { user, updateUser } = useAuthStore();
  const { currentProject } = useProjectStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingKnowledgeBases, setIsLoadingKnowledgeBases] = useState(false);
  const [isSavingKnowledgeBase, setIsSavingKnowledgeBase] = useState(false);
  const [deletingKnowledgeBaseId, setDeletingKnowledgeBaseId] = useState('');
  const [reindexingKnowledgeBaseId, setReindexingKnowledgeBaseId] = useState('');
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [editingKnowledgeBaseId, setEditingKnowledgeBaseId] = useState('');
  const [knowledgeBaseForm, setKnowledgeBaseForm] = useState<KnowledgeBaseForm>(defaultKnowledgeBaseForm);
  const [knowledgeGlobalConfig, setKnowledgeGlobalConfig] = useState<KnowledgeGlobalConfig>({
    api_base: '',
    api_key: null,
    api_key_masked: null,
    has_api_key: false,
    default_embedding_model: '',
  });
  const [knowledgeGlobalForm, setKnowledgeGlobalForm] = useState({
    api_base: '',
    api_key: '',
    default_embedding_model: '',
  });
  const [isLoadingKnowledgeGlobalConfig, setIsLoadingKnowledgeGlobalConfig] = useState(false);
  const [isSavingKnowledgeGlobalConfig, setIsSavingKnowledgeGlobalConfig] = useState(false);
  const [isTestingKnowledgeGlobalConnection, setIsTestingKnowledgeGlobalConnection] = useState(false);
  const [knowledgeConnectionTestResult, setKnowledgeConnectionTestResult] = useState<KnowledgeConnectionTestResult | null>(null);
  const [selectedKnowledgeBaseId, setSelectedKnowledgeBaseId] = useState('');
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingKnowledgeDocuments, setIsLoadingKnowledgeDocuments] = useState(false);
  const [isSavingKnowledgeDocument, setIsSavingKnowledgeDocument] = useState(false);
  const [deletingKnowledgeDocumentId, setDeletingKnowledgeDocumentId] = useState('');
  const [editingKnowledgeDocumentId, setEditingKnowledgeDocumentId] = useState('');
  const [knowledgeDocumentForm, setKnowledgeDocumentForm] = useState(defaultKnowledgeDocumentForm);
  const [uploadingKnowledgeDocuments, setUploadingKnowledgeDocuments] = useState(false);
  const [knowledgeUploadFiles, setKnowledgeUploadFiles] = useState<File[]>([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (user) {
      setEmail(user.email || '');
    }
  }, [user]);

  useEffect(() => {
    void fetchKnowledgeBases();
  }, [currentProject?.id]);

  useEffect(() => {
    void fetchKnowledgeGlobalConfig();
  }, []);

  const isPasswordMismatch = password !== '' && confirmPassword !== '' && password !== confirmPassword;

  const fetchKnowledgeGlobalConfig = async () => {
    setIsLoadingKnowledgeGlobalConfig(true);
    try {
      const data = await api.get<KnowledgeGlobalConfig>('/api/v1/knowledge-bases/global-config');
      setKnowledgeGlobalConfig(data);
      setKnowledgeGlobalForm({
        api_base: data.api_base || '',
        api_key: '',
        default_embedding_model: data.default_embedding_model || '',
      });
    } catch (err: any) {
      setError(err.message || t('knowledgeGlobalConfigLoadFailed'));
    } finally {
      setIsLoadingKnowledgeGlobalConfig(false);
    }
  };

  const validateKnowledgeGlobalConfig = () => {
    const normalizedApiBase = knowledgeGlobalForm.api_base.trim();
    if (!normalizedApiBase) {
      return '';
    }
    if (!(normalizedApiBase.startsWith('http://') || normalizedApiBase.startsWith('https://'))) {
      return t('knowledgeGlobalConfigApiBaseInvalid');
    }
    if (normalizedApiBase.toLowerCase().endsWith('/embeddings')) {
      return t('knowledgeGlobalConfigApiBaseShouldBeBaseUrl');
    }
    return '';
  };

  const validateKnowledgeGlobalModelName = () => {
    const normalizedModelName = knowledgeGlobalForm.default_embedding_model.trim();
    if (!normalizedModelName) {
      return '';
    }
    if (normalizedModelName.length > 200) {
      return t('knowledgeGlobalModelNameTooLong');
    }
    return '';
  };

  const handleSaveKnowledgeGlobalConfig = async () => {
    setError('');
    setSuccess('');
    const validationMessage = validateKnowledgeGlobalConfig();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    const modelValidationMessage = validateKnowledgeGlobalModelName();
    if (modelValidationMessage) {
      setError(modelValidationMessage);
      return;
    }
    setIsSavingKnowledgeGlobalConfig(true);
    try {
      const payload: Record<string, string | null> = {
        api_base: knowledgeGlobalForm.api_base.trim() || null,
        default_embedding_model: knowledgeGlobalForm.default_embedding_model.trim() || null,
      };
      const normalizedApiKey = knowledgeGlobalForm.api_key.trim();
      if (normalizedApiKey) {
        payload.api_key = normalizedApiKey;
      }
      const data = await api.put<KnowledgeGlobalConfig>('/api/v1/knowledge-bases/global-config', payload);
      setKnowledgeGlobalConfig(data);
      setKnowledgeGlobalForm({
        api_base: data.api_base || '',
        api_key: '',
        default_embedding_model: data.default_embedding_model || '',
      });
      setKnowledgeConnectionTestResult(null);
      setSuccess(t('knowledgeGlobalConfigSaved'));
    } catch (err: any) {
      setError(err.message || t('knowledgeGlobalConfigSaveFailed'));
    } finally {
      setIsSavingKnowledgeGlobalConfig(false);
    }
  };

  const handleTestKnowledgeGlobalConnection = async () => {
    setError('');
    setSuccess('');
    setKnowledgeConnectionTestResult(null);
    const validationMessage = validateKnowledgeGlobalConfig();
    if (validationMessage) {
      setError(validationMessage);
      return;
    }
    const modelValidationMessage = validateKnowledgeGlobalModelName();
    if (modelValidationMessage) {
      setError(modelValidationMessage);
      return;
    }
    const normalizedModelName = knowledgeGlobalForm.default_embedding_model.trim();
    if (!normalizedModelName) {
      setError(t('knowledgeGlobalModelNameRequiredForTest'));
      return;
    }
    setIsTestingKnowledgeGlobalConnection(true);
    try {
      const payload: Record<string, string> = {};
      const normalizedApiBase = knowledgeGlobalForm.api_base.trim();
      const normalizedApiKey = knowledgeGlobalForm.api_key.trim();
      if (normalizedApiBase) payload.api_base = normalizedApiBase;
      if (normalizedApiKey) payload.api_key = normalizedApiKey;
      if (normalizedModelName) payload.model_name = normalizedModelName;
      const result = await api.post<KnowledgeConnectionTestResult>('/api/v1/knowledge-bases/global-config/test-connection', payload);
      setKnowledgeConnectionTestResult(result);
      setSuccess(t('knowledgeGlobalConnectionTestPassed'));
    } catch (err: any) {
      setError(err.message || t('knowledgeGlobalConnectionTestFailed'));
    } finally {
      setIsTestingKnowledgeGlobalConnection(false);
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
      setError(err.message || t('knowledgeBaseLoadFailed'));
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
      return t('selectProjectBeforeManageKnowledgeBase');
    }
    if (!knowledgeBaseForm.name.trim()) {
      return t('knowledgeBaseNameRequired');
    }
    if (knowledgeBaseForm.chunk_size < 64 || knowledgeBaseForm.chunk_size > 4096) {
      return t('knowledgeBaseChunkSizeRange');
    }
    if (knowledgeBaseForm.chunk_overlap < 0 || knowledgeBaseForm.chunk_overlap > 512) {
      return t('knowledgeBaseChunkOverlapRange');
    }
    if (knowledgeBaseForm.chunk_overlap >= knowledgeBaseForm.chunk_size) {
      return t('knowledgeBaseChunkOverlapTooLarge');
    }
    if (knowledgeBaseForm.top_k < 1 || knowledgeBaseForm.top_k > 20) {
      return t('knowledgeBaseTopKRange');
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
        setSuccess(t('knowledgeBaseUpdated'));
      } else {
        await api.post('/api/v1/knowledge-bases', payload);
        setSuccess(t('knowledgeBaseCreated'));
      }
      await fetchKnowledgeBases();
      resetKnowledgeBaseForm();
    } catch (err: any) {
      setError(err.message || t('knowledgeBaseSaveFailed'));
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
    if (!window.confirm(t('confirmDeleteKnowledgeBase'))) {
      return;
    }
    setError('');
    setSuccess('');
    setDeletingKnowledgeBaseId(id);
    try {
      await api.delete(`/api/v1/knowledge-bases/${id}`);
      setSuccess(t('knowledgeBaseDeleted'));
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
      setError(err.message || t('knowledgeBaseDeleteFailed'));
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
      setSuccess(t('knowledgeBaseReindexSuccess'));
    } catch (err: any) {
      setError(err.message || t('knowledgeBaseReindexFailed'));
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
      setError(err.message || t('knowledgeDocumentLoadFailed'));
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
      return t('selectKnowledgeBaseToManageDocuments');
    }
    if (!knowledgeDocumentForm.title.trim()) {
      return t('knowledgeDocumentTitleRequired');
    }
    if (!knowledgeDocumentForm.content.trim()) {
      return t('knowledgeDocumentContentRequired');
    }
    const metadataText = knowledgeDocumentForm.metadata.trim();
    if (!metadataText) {
      return '';
    }
    try {
      JSON.parse(metadataText);
      return '';
    } catch {
      return t('knowledgeDocumentMetadataInvalid');
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
        setSuccess(t('knowledgeDocumentUpdated'));
      } else {
        await api.post(`/api/v1/knowledge-bases/${selectedKnowledgeBaseId}/documents`, payload);
        setSuccess(t('knowledgeDocumentCreated'));
      }
      await fetchKnowledgeDocuments(selectedKnowledgeBaseId);
      await fetchKnowledgeBases();
      resetKnowledgeDocumentForm();
    } catch (err: any) {
      setError(err.message || t('knowledgeDocumentSaveFailed'));
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
    if (!window.confirm(t('confirmDeleteKnowledgeDocument'))) {
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
      setSuccess(t('knowledgeDocumentDeleted'));
      await fetchKnowledgeDocuments(selectedKnowledgeBaseId);
      await fetchKnowledgeBases();
    } catch (err: any) {
      setError(err.message || t('knowledgeDocumentDeleteFailed'));
    } finally {
      setDeletingKnowledgeDocumentId('');
    }
  };

  const handleUploadKnowledgeDocuments = async () => {
    setError('');
    setSuccess('');
    if (!selectedKnowledgeBaseId) {
      setError(t('selectKnowledgeBaseToManageDocuments'));
      return;
    }
    if (knowledgeUploadFiles.length === 0) {
      setError(t('knowledgeDocumentUploadEmpty'));
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
      setError(err.message || t('knowledgeDocumentUploadFailed'));
    } finally {
      setUploadingKnowledgeDocuments(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');
    
    if (isPasswordMismatch) {
      setError(t('passwordsDoNotMatch'));
      return;
    }

    setIsSaving(true);
    try {
        const updateData: any = {
          email: email
        };
        
        if (password) {
          updateData.password = password;
        }

        if (user && user.id) {
            const response = await api.put<any>(`/api/v1/users/${user.id}`, updateData);
            let successMsg = t('personalSettingsSaved');
            if (password) {
              successMsg = t('personalSettingsAndPasswordSaved');
            }
            setSuccess(successMsg);
            setPassword('');
            setConfirmPassword('');
            
            // Update global state with new email
            updateUser({ email: response.email });
        }
    } catch (error: any) {
        console.error("Failed to save settings", error);
        setError(error.message || t('failedToSaveSettings'));
    } finally {
        setIsSaving(false);
    }
  };

  const selectedKnowledgeBase = knowledgeBases.find((item) => item.id === selectedKnowledgeBaseId) || null;

  return (
    <div className="flex-1 flex flex-col h-full bg-muted/50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-background">
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <Save className="h-5 w-5 text-indigo-500" />
          {t('personalSettings')}
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="grid gap-6 max-w-4xl mx-auto">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">{error}</div>}
          {success && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-md p-3">{success}</div>}
          
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">{t('accountInfo')}</CardTitle>
              <CardDescription>{t('modifyLoginEmailAndPassword')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">{t('username')}</Label>
                <Input 
                  id="username" 
                  value={user?.username || ''}
                  disabled
                  className="bg-muted/50 text-muted-foreground"
                />
                <p className="text-xs text-muted-foreground">{t('usernameCannotBeModified')}</p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">{t('emailAddress')}</Label>
                <Input 
                  id="email" 
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>

              <div className="space-y-2 pt-4 border-t border-border">
                <Label htmlFor="new-password">{t('newPassword')}</Label>
                <Input 
                  id="new-password" 
                  type="password" 
                  placeholder={t('leaveBlankIfNotModifying')} 
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError('');
                  }}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirm-password">{t('confirmNewPassword')}</Label>
                <Input 
                  id="confirm-password" 
                  type="password" 
                  placeholder={t('leaveBlankIfNotModifying')} 
                  value={confirmPassword}
                  onChange={(e) => {
                    setConfirmPassword(e.target.value);
                    setError('');
                  }}
                />
                {isPasswordMismatch && <p className="text-sm text-red-600">{t('passwordsDoNotMatch')}</p>}
              </div>
            </CardContent>
            <CardFooter className="bg-muted/50/50 border-t border-border pt-6">
              <Button onClick={handleSave} className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-primary-foreground" disabled={isSaving || isPasswordMismatch}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {t('saveSettings')}
              </Button>
            </CardFooter>
          </Card>

          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Database className="h-5 w-5 text-indigo-500" />
                {t('knowledgeBaseSettings')}
              </CardTitle>
              <CardDescription>{t('knowledgeBaseSettingsDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="rounded-lg border border-border p-4 space-y-4">
                <div className="space-y-1">
                  <div className="text-sm font-medium text-foreground">{t('knowledgeGlobalConfigTitle')}</div>
                  <div className="text-xs text-muted-foreground">{t('knowledgeGlobalConfigDesc')}</div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="knowledge-global-api-base">{t('knowledgeGlobalApiBase')}</Label>
                    <Input
                      id="knowledge-global-api-base"
                      value={knowledgeGlobalForm.api_base}
                      placeholder={t('knowledgeGlobalApiBasePlaceholder')}
                      onChange={(e) => setKnowledgeGlobalForm((prev) => ({ ...prev, api_base: e.target.value }))}
                      disabled={isLoadingKnowledgeGlobalConfig || isSavingKnowledgeGlobalConfig}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="knowledge-global-api-key">{t('knowledgeGlobalApiKey')}</Label>
                    <Input
                      id="knowledge-global-api-key"
                      type="password"
                      value={knowledgeGlobalForm.api_key}
                      placeholder={t('knowledgeGlobalApiKeyPlaceholder')}
                      onChange={(e) => setKnowledgeGlobalForm((prev) => ({ ...prev, api_key: e.target.value }))}
                      disabled={isLoadingKnowledgeGlobalConfig || isSavingKnowledgeGlobalConfig}
                    />
                    <div className="text-xs text-muted-foreground">
                      {knowledgeGlobalConfig.has_api_key
                        ? t('knowledgeGlobalApiKeyMasked', { masked: knowledgeGlobalConfig.api_key_masked || '******' })
                        : t('knowledgeGlobalApiKeyEmpty')}
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="knowledge-global-default-embedding-model">{t('knowledgeGlobalDefaultEmbeddingModel')}</Label>
                    <Input
                      id="knowledge-global-default-embedding-model"
                      value={knowledgeGlobalForm.default_embedding_model}
                      placeholder={t('knowledgeGlobalDefaultEmbeddingModelPlaceholder')}
                      onChange={(e) => setKnowledgeGlobalForm((prev) => ({ ...prev, default_embedding_model: e.target.value }))}
                      disabled={isLoadingKnowledgeGlobalConfig || isSavingKnowledgeGlobalConfig || isTestingKnowledgeGlobalConnection}
                    />
                    <div className="text-xs text-muted-foreground">
                      {t('knowledgeGlobalModelNameHint')}
                    </div>
                  </div>
                </div>
                {knowledgeConnectionTestResult ? (
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700 space-y-1">
                    <div>{knowledgeConnectionTestResult.message}</div>
                    {knowledgeConnectionTestResult.model_name ? (
                      <div>{t('knowledgeGlobalConnectionModelResult', { model: knowledgeConnectionTestResult.model_name })}</div>
                    ) : null}
                    {typeof knowledgeConnectionTestResult.embedding_dimension === 'number' ? (
                      <div>{t('knowledgeGlobalConnectionDimensionResult', { dim: knowledgeConnectionTestResult.embedding_dimension })}</div>
                    ) : null}
                    {knowledgeConnectionTestResult.available_models && knowledgeConnectionTestResult.available_models.length > 0 ? (
                      <div>{t('knowledgeGlobalConnectionAvailableModelsResult', { models: knowledgeConnectionTestResult.available_models.slice(0, 5).join(', ') })}</div>
                    ) : null}
                  </div>
                ) : null}
                <div className="flex items-center justify-end gap-2">
                  <Button
                    variant="outline"
                    onClick={handleTestKnowledgeGlobalConnection}
                    disabled={isLoadingKnowledgeGlobalConfig || isSavingKnowledgeGlobalConfig || isTestingKnowledgeGlobalConnection}
                  >
                    {isTestingKnowledgeGlobalConnection ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Database className="h-4 w-4 mr-2" />}
                    {t('testKnowledgeGlobalConnection')}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => void fetchKnowledgeGlobalConfig()}
                    disabled={isLoadingKnowledgeGlobalConfig || isSavingKnowledgeGlobalConfig || isTestingKnowledgeGlobalConnection}
                  >
                    {isLoadingKnowledgeGlobalConfig ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                    {t('refresh')}
                  </Button>
                  <Button onClick={handleSaveKnowledgeGlobalConfig} disabled={isLoadingKnowledgeGlobalConfig || isSavingKnowledgeGlobalConfig || isTestingKnowledgeGlobalConnection}>
                    {isSavingKnowledgeGlobalConfig ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    {t('saveKnowledgeGlobalConfig')}
                  </Button>
                </div>
              </div>

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
                  <Input
                    id="knowledge-base-embedding-model"
                    value={knowledgeBaseForm.embedding_model}
                    placeholder={t('knowledgeBaseEmbeddingModelPlaceholder')}
                    onChange={(e) => setKnowledgeBaseForm((prev) => ({ ...prev, embedding_model: e.target.value }))}
                    disabled={!currentProject}
                  />
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
