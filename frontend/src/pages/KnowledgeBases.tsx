import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Save, Loader2, RefreshCw, Pencil, Trash2, FileText, Plus, BookOpen, GripVertical } from "lucide-react";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { Textarea } from "@/components/ui/textarea";
import { KnowledgeBaseForm, type KnowledgeBaseFormValues } from "@/components/KnowledgeBaseForm";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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

interface KnowledgeDocument {
  id: string;
  title: string;
  content: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

const defaultKnowledgeDocumentForm = {
  title: '',
  content: '',
  metadata: '',
};

export function KnowledgeBases() {
  const { t } = useTranslation();
  const { currentProject } = useProjectStore();
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  
  // KB Form Dialog State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingKb, setEditingKb] = useState<KnowledgeBase | null>(null);
  const [isSavingKb, setIsSavingKb] = useState(false);
  const [reindexingKbId, setReindexingKbId] = useState('');
  
  // Docs Dialog State
  const [docsDialogOpen, setDocsDialogOpen] = useState(false);
  const [selectedKbForDocs, setSelectedKbForDocs] = useState<KnowledgeBase | null>(null);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  
  // Doc Form State inside Docs Dialog
  const [isSavingDoc, setIsSavingDoc] = useState(false);
  const [editingDocId, setEditingDocId] = useState('');
  const [docForm, setDocForm] = useState(defaultKnowledgeDocumentForm);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);

  useEffect(() => {
    void fetchKnowledgeBases();
  }, [currentProject?.id]);

  const fetchKnowledgeBases = async () => {
    if (!currentProject) {
      setKnowledgeBases([]);
      return;
    }
    setIsLoading(true);
    try {
      const data = await api.get<KnowledgeBase[]>(`/api/v1/knowledge-bases?project_id=${currentProject.id}`);
      
      // 从 localStorage 中恢复顺序
      const savedOrderStr = localStorage.getItem(`knowledge_bases_order_${currentProject.id}`);
      if (savedOrderStr) {
        try {
          const savedOrder = JSON.parse(savedOrderStr) as string[];
          data.sort((a, b) => {
            const indexA = savedOrder.indexOf(a.id);
            const indexB = savedOrder.indexOf(b.id);
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
          });
        } catch (e) {
          console.error("Failed to parse saved kb order", e);
        }
      }
      
      setKnowledgeBases(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateKb = () => {
    setEditingKb(null);
    setIsFormOpen(true);
  };

  const handleEditKb = (kb: KnowledgeBase) => {
    setEditingKb(kb);
    setIsFormOpen(true);
  };

  const handleSaveKb = async (data: KnowledgeBaseFormValues) => {
    if (!currentProject) return;
    setIsSavingKb(true);
    try {
      const payload = {
        ...data,
        project_id: currentProject.id,
      };
      if (editingKb) {
        await api.put(`/api/v1/knowledge-bases/${editingKb.id}`, payload);
      } else {
        await api.post('/api/v1/knowledge-bases', payload);
      }
      setIsFormOpen(false);
      await fetchKnowledgeBases();
    } finally {
      setIsSavingKb(false);
    }
  };

  const handleDeleteKb = async (id: string) => {
    if (!window.confirm(t('confirmDeleteKnowledgeBase', 'Are you sure to delete this knowledge base?'))) {
      return;
    }
    try {
      await api.delete(`/api/v1/knowledge-bases/${id}`);
      await fetchKnowledgeBases();
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleReindexKb = async (id: string) => {
    setReindexingKbId(id);
    try {
      await api.post(`/api/v1/knowledge-bases/${id}/reindex`, {});
      alert(t('knowledgeBaseReindexSuccess', 'Knowledge base reindexed successfully'));
    } catch (err: any) {
      console.error(err);
      alert(t('knowledgeBaseReindexFailed', 'Failed to reindex knowledge base'));
    } finally {
      setReindexingKbId('');
    }
  };

  // --- Document Management Methods ---

  const handleManageDocs = async (kb: KnowledgeBase) => {
    setSelectedKbForDocs(kb);
    setDocsDialogOpen(true);
    setEditingDocId('');
    setDocForm(defaultKnowledgeDocumentForm);
    await fetchKnowledgeDocuments(kb.id);
  };

  const fetchKnowledgeDocuments = async (kbId: string) => {
    if (!kbId) return;
    setIsLoadingDocs(true);
    try {
      const data = await api.get<KnowledgeDocument[]>(`/api/v1/knowledge-bases/${kbId}/documents`);
      setKnowledgeDocuments(data);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoadingDocs(false);
    }
  };

  const resetDocForm = () => {
    setEditingDocId('');
    setDocForm(defaultKnowledgeDocumentForm);
  };

  const handleSaveDoc = async () => {
    if (!selectedKbForDocs) return;
    if (!docForm.title.trim() || !docForm.content.trim()) {
      alert(t('knowledgeDocumentTitleRequired', 'Document title and content are required'));
      return;
    }
    
    let parsedMetadata = {};
    if (docForm.metadata.trim()) {
      try {
        parsedMetadata = JSON.parse(docForm.metadata.trim());
      } catch {
        alert(t('knowledgeDocumentMetadataInvalid', 'Document metadata must be valid JSON'));
        return;
      }
    }

    setIsSavingDoc(true);
    try {
      const payload = {
        title: docForm.title.trim(),
        content: docForm.content.trim(),
        metadata: parsedMetadata,
      };
      
      if (editingDocId) {
        await api.put(`/api/v1/knowledge-bases/${selectedKbForDocs.id}/documents/${editingDocId}`, payload);
      } else {
        await api.post(`/api/v1/knowledge-bases/${selectedKbForDocs.id}/documents`, payload);
      }
      resetDocForm();
      await fetchKnowledgeDocuments(selectedKbForDocs.id);
      await fetchKnowledgeBases(); // To update doc count
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsSavingDoc(false);
    }
  };

  const handleEditDoc = (doc: KnowledgeDocument) => {
    setEditingDocId(doc.id);
    setDocForm({
      title: doc.title || '',
      content: doc.content || '',
      metadata: doc.metadata && Object.keys(doc.metadata).length > 0 ? JSON.stringify(doc.metadata, null, 2) : '',
    });
  };

  const handleDeleteDoc = async (docId: string) => {
    if (!selectedKbForDocs) return;
    if (!window.confirm(t('confirmDeleteKnowledgeDocument', 'Are you sure to delete this document?'))) return;
    try {
      await api.delete(`/api/v1/knowledge-bases/${selectedKbForDocs.id}/documents/${docId}`);
      if (editingDocId === docId) resetDocForm();
      await fetchKnowledgeDocuments(selectedKbForDocs.id);
      await fetchKnowledgeBases();
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleUploadDocs = async () => {
    if (!selectedKbForDocs || uploadFiles.length === 0) return;
    setUploadingDocs(true);
    try {
      const formData = new FormData();
      uploadFiles.forEach((file) => formData.append('files', file));
      await api.post(`/api/v1/knowledge-bases/${selectedKbForDocs.id}/documents/upload`, formData);
      setUploadFiles([]);
      await fetchKnowledgeDocuments(selectedKbForDocs.id);
      await fetchKnowledgeBases();
    } catch (err: any) {
      console.error(err);
      alert(t('knowledgeDocumentUploadFailed', 'Failed to upload knowledge documents'));
    } finally {
      setUploadingDocs(false);
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setKnowledgeBases((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        
        const newItems = arrayMove(items, oldIndex, newIndex);
        
        // 保存新的顺序到 localStorage
        if (currentProject) {
          localStorage.setItem(
            `knowledge_bases_order_${currentProject.id}`, 
            JSON.stringify(newItems.map(i => i.id))
          );
        }
        
        return newItems;
      });
    }
  };

  const SortableKbCard = ({ kb }: { kb: KnowledgeBase }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging
    } = useSortable({ id: kb.id });

    const style = {
      transform: CSS.Transform.toString(transform),
      transition,
    };

    return (
      <div 
        ref={setNodeRef}
        style={style}
        className={`group relative bg-background border border-border rounded-xl p-5 hover:shadow-md transition-all hover:border-border
          ${isDragging ? 'opacity-50 z-50 ring-2 ring-indigo-500 shadow-xl' : ''}
        `}
      >
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div 
              {...attributes} 
              {...listeners}
              className="cursor-grab active:cursor-grabbing p-1 -ml-2 text-muted-foreground/50 hover:text-foreground/80 transition-colors"
              title="Drag to reorder"
            >
              <GripVertical className="h-5 w-5" />
            </div>
            <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground flex items-center gap-2">
                {kb.name}
                {!kb.is_active && (
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">Inactive</span>
                )}
              </h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {kb.documents?.length || 0} Documents
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-blue-600" onClick={() => handleManageDocs(kb)} title={t('manageKnowledgeDocuments')}>
              <FileText className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-green-600" onClick={() => handleReindexKb(kb.id)} disabled={reindexingKbId === kb.id} title={t('reindexKnowledgeBase')}>
              {reindexingKbId === kb.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-muted-foreground" onClick={() => handleEditKb(kb)} title={t('editKnowledgeBase')}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50" onClick={() => handleDeleteKb(kb.id)} title={t('deleteKnowledgeBase')}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div className="space-y-2 ml-8">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Model</span>
            <span className="font-medium text-foreground/80 truncate max-w-[150px]" title={kb.embedding_model || 'Default'}>
              {kb.embedding_model ? kb.embedding_model.substring(0, 15) + (kb.embedding_model.length > 15 ? '...' : '') : 'Default'}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Chunking</span>
            <span className="font-medium text-foreground/80">
              {kb.chunk_size} / {kb.chunk_overlap}
            </span>
          </div>
          {kb.description && (
            <p className="text-xs text-muted-foreground mt-3 line-clamp-2" title={kb.description}>
              {kb.description}
            </p>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="border-b border-border px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{t('knowledgeBases')}</h1>
          <p className="text-sm text-muted-foreground mt-1">{t('knowledgeBaseSettingsDesc', 'Manage knowledge bases and their documents')}</p>
        </div>
        <Button onClick={handleCreateKb} className="bg-indigo-600 hover:bg-indigo-700 text-primary-foreground gap-2" disabled={!currentProject}>
          <Plus className="h-4 w-4" />
          {t('createKnowledgeBase', 'New Knowledge Base')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {!currentProject ? (
          <div className="flex justify-center items-center h-64">
             <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-4">
              {t('selectProjectBeforeManageKnowledgeBase')}
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : knowledgeBases.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-border rounded-xl bg-muted/50/50">
            <BookOpen className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground font-medium">{t('noKnowledgeBases')}</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext 
              items={knowledgeBases.map(kb => kb.id)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {knowledgeBases.map((kb) => (
                  <SortableKbCard key={kb.id} kb={kb} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Form Dialog */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingKb ? t('updateKnowledgeBase', 'Edit Knowledge Base') : t('createKnowledgeBase', 'New Knowledge Base')}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <KnowledgeBaseForm 
              initialData={editingKb ? {
                name: editingKb.name,
                description: editingKb.description || '',
                embedding_model: editingKb.embedding_model || '',
                chunk_size: editingKb.chunk_size,
                chunk_overlap: editingKb.chunk_overlap,
                top_k: editingKb.top_k,
                is_active: editingKb.is_active,
              } : null}
              onSubmit={handleSaveKb}
              onCancel={() => setIsFormOpen(false)}
              isSubmitting={isSavingKb}
            />
          </div>
        </DialogContent>
      </Dialog>

      {/* Docs Management Dialog */}
      <Dialog open={docsDialogOpen} onOpenChange={(open) => {
        setDocsDialogOpen(open);
        if (!open) {
          setSelectedKbForDocs(null);
          setKnowledgeDocuments([]);
        }
      }}>
        <DialogContent className="sm:max-w-[800px] max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-500" />
              {selectedKbForDocs ? t('knowledgeDocumentManagerTitle', { name: selectedKbForDocs.name }) : 'Manage Documents'}
            </DialogTitle>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Upload Section */}
            <div className="rounded-lg border border-border p-4 bg-muted/30">
              <div className="text-sm font-medium text-foreground mb-3">{t('knowledgeDocumentUploadTitle')}</div>
              <div className="flex items-center gap-3">
                <Input
                  type="file"
                  multiple
                  onChange={(e) => setUploadFiles(Array.from(e.target.files || []))}
                  disabled={uploadingDocs}
                  className="flex-1"
                />
                <Button onClick={handleUploadDocs} disabled={uploadingDocs || uploadFiles.length === 0} className="shrink-0">
                  {uploadingDocs ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
                  {t('knowledgeDocumentUploadAction')}
                </Button>
              </div>
              {uploadFiles.length > 0 && (
                <div className="text-xs text-muted-foreground mt-2">
                  {t('knowledgeDocumentUploadSelected', { count: uploadFiles.length })}
                </div>
              )}
            </div>

            {/* Edit/Create Doc Form */}
            <div className="rounded-lg border border-border p-4">
              <div className="text-sm font-medium text-foreground mb-3">
                {editingDocId ? t('updateKnowledgeDocument') : t('createKnowledgeDocument')}
              </div>
              <div className="grid gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="doc-title">{t('knowledgeDocumentTitle')}</Label>
                  <Input
                    id="doc-title"
                    value={docForm.title}
                    placeholder={t('knowledgeDocumentTitlePlaceholder')}
                    onChange={(e) => setDocForm((p) => ({ ...p, title: e.target.value }))}
                    disabled={isSavingDoc}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-content">{t('knowledgeDocumentContent')}</Label>
                  <Textarea
                    id="doc-content"
                    value={docForm.content}
                    placeholder={t('knowledgeDocumentContentPlaceholder')}
                    onChange={(e) => setDocForm((p) => ({ ...p, content: e.target.value }))}
                    disabled={isSavingDoc}
                    rows={4}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="doc-metadata">{t('knowledgeDocumentMetadata')} (JSON)</Label>
                  <Textarea
                    id="doc-metadata"
                    value={docForm.metadata}
                    placeholder='{"key": "value"}'
                    onChange={(e) => setDocForm((p) => ({ ...p, metadata: e.target.value }))}
                    disabled={isSavingDoc}
                    rows={2}
                    className="font-mono text-sm"
                  />
                </div>
                <div className="flex items-center justify-end gap-2 mt-2">
                  {editingDocId && (
                    <Button variant="outline" size="sm" onClick={resetDocForm} disabled={isSavingDoc}>
                      {t('cancel')}
                    </Button>
                  )}
                  <Button size="sm" onClick={handleSaveDoc} disabled={isSavingDoc}>
                    {isSavingDoc ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                    {t('save')}
                  </Button>
                </div>
              </div>
            </div>

            {/* Document List */}
            <div>
              <div className="font-medium text-sm text-foreground/80 mb-3 flex items-center justify-between">
                Documents ({knowledgeDocuments.length})
                <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => selectedKbForDocs && fetchKnowledgeDocuments(selectedKbForDocs.id)}>
                  <RefreshCw className={`h-4 w-4 mr-1 ${isLoadingDocs ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>
              
              {isLoadingDocs ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : knowledgeDocuments.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground border border-dashed border-border rounded-lg bg-muted/20">
                  {t('noKnowledgeDocuments')}
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2">
                  {knowledgeDocuments.map((doc) => (
                    <div key={doc.id} className="group rounded-lg border border-border p-3 flex items-start justify-between gap-3 bg-background hover:border-indigo-200 transition-colors">
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="font-medium text-sm text-foreground truncate">{doc.title}</div>
                        <div className="text-xs text-muted-foreground truncate">{doc.content.slice(0, 100)}...</div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                          {new Date(doc.updated_at).toLocaleString()}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-indigo-600" onClick={() => handleEditDoc(doc)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-red-600" onClick={() => handleDeleteDoc(doc.id)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
