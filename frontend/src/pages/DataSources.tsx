import { useState, useEffect } from "react";
import { useTranslation } from 'react-i18next';
import { api } from "@/lib/api";
import { DataSourceForm, type DataSourceConfig } from "@/components/DataSourceForm";
import { Button } from "@/components/ui/button";
import { Plus, Database, Pencil, Trash2, Loader2, Info, ChevronLeft, FileText, Search, Network, GripVertical } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useProjectStore } from "@/store/projectStore";
import { useNavigate } from "react-router-dom";
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

const SOURCE_TYPES = [
  { id: "csv", name: "CSV Upload", icon: <FileText className="h-6 w-6 text-green-600" /> },
  { id: "bigquery", name: "BigQuery", icon: <Database className="h-6 w-6 text-blue-500" /> },
  { id: "postgres", name: "PostgreSQL", icon: <Database className="h-6 w-6 text-indigo-600" /> },
  { id: "supabase", name: "Supabase", icon: <Database className="h-6 w-6 text-emerald-500" /> },
  { id: "mysql", name: "MySQL", icon: <Database className="h-6 w-6 text-cyan-600" /> },
  { id: "oracle", name: "Oracle", icon: <Database className="h-6 w-6 text-red-600" /> },
  { id: "sqlserver", name: "SQL Server", icon: <Database className="h-6 w-6 text-red-500" /> },
  { id: "clickhouse", name: "ClickHouse", icon: <Database className="h-6 w-6 text-yellow-500" /> },
  { id: "trino", name: "Trino", icon: <Database className="h-6 w-6 text-pink-500" /> },
  { id: "snowflake", name: "Snowflake", icon: <Database className="h-6 w-6 text-blue-400" /> },
  { id: "athena-trino", name: "Athena (Trino)", icon: <Search className="h-6 w-6 text-purple-600" /> },
  { id: "redshift", name: "Redshift", icon: <Database className="h-6 w-6 text-purple-700" /> },
  { id: "databricks", name: "Databricks", icon: <Database className="h-6 w-6 text-orange-600" /> },
  { id: "emr-spark", name: "EMR (Spark)", icon: <Database className="h-6 w-6 text-indigo-800" /> },
  { id: "athena-spark", name: "Athena (Spark)", icon: <Search className="h-6 w-6 text-purple-500" /> },
  { id: "spark", name: "Spark", icon: <Database className="h-6 w-6 text-orange-500" /> },
  { id: "sqlite", name: "SQLite", icon: <Database className="h-6 w-6 text-blue-600" /> },
  { id: "parquet", name: "Parquet", icon: <FileText className="h-6 w-6 text-yellow-600" /> },
];

export function DataSources() {
  const { t } = useTranslation();
  const [datasources, setDatasources] = useState<DataSourceConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [view, setView] = useState<"list" | "select-type">("list");
  const [isOpen, setIsOpen] = useState(false);
  const [editingDs, setEditingDs] = useState<DataSourceConfig | null>(null);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const { currentProject } = useProjectStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (currentProject) {
      fetchDataSources();
    }
  }, [currentProject]);

  const fetchDataSources = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    try {
      const data = await api.get<DataSourceConfig[]>(`/api/v1/datasources?project_id=${currentProject.id}`);
      // 从 localStorage 中恢复顺序
      const savedOrderStr = localStorage.getItem(`datasources_order_${currentProject.id}`);
      if (savedOrderStr) {
        try {
          const savedOrder = JSON.parse(savedOrderStr) as string[];
          // 按照保存的 ID 顺序重新排列，同时把新添加的数据源放在末尾
          data.sort((a, b) => {
            const indexA = savedOrder.indexOf(a.id as unknown as string);
            const indexB = savedOrder.indexOf(b.id as unknown as string);
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
          });
        } catch (e) {
          console.error("Failed to parse saved datasource order", e);
        }
      }
      setDatasources(data);
    } catch (e) {
      console.error("Failed to fetch data sources", e);
    } finally {
      setIsLoading(false);
    }
  }

  const handleCreate = () => {
    setEditingDs(null);
    setSelectedType(null);
    setView("select-type");
  };

  const handleSelectType = (typeId: string) => {
    setSelectedType(typeId);
    setIsOpen(true);
  };

  const handleEdit = (ds: DataSourceConfig) => {
    setEditingDs(ds);
    setSelectedType(ds.type);
    setIsOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm(t('confirmDeleteDataSource'))) return;
    try {
      await api.delete(`/api/v1/datasources/${id}`);
      fetchDataSources();
    } catch (e) {
      console.error("Failed to delete data source", e);
    }
  };

  const handleSubmit = async (data: Omit<DataSourceConfig, "id">) => {
    if (!currentProject) return;
    try {
      if (editingDs?.id) {
        await api.put(`/api/v1/datasources/${editingDs.id}`, { ...data, project_id: currentProject.id });
      } else {
        await api.post("/api/v1/datasources", { ...data, project_id: currentProject.id });
      }
      setIsOpen(false);
      fetchDataSources();
    } catch (e) {
      console.error("Failed to save data source", e);
      alert(t('saveFailed') + (e as any).message);
    }
  };

  const handleTest = async (type: string, config: Record<string, any>) => {
    try {
      const res = await api.post<{ success: boolean; message: string }>("/api/v1/datasources/test", { type, config });
      return res.success;
    } catch (e) {
      console.error("Test connection failed", e);
      throw e;
    }
  };

  if (view === "select-type") {
    return (
      <div className="h-full flex flex-col bg-[#F9FAFB]">
        <div className="px-12 py-8">
          <button 
            onClick={() => setView("list")}
            className="flex items-center text-muted-foreground hover:text-foreground/90 transition-colors mb-6 group"
          >
            <ChevronLeft className="h-4 w-4 mr-1 group-hover:-translate-x-0.5 transition-transform" />
            {t('backToList')}
          </button>
          
          <h1 className="text-2xl font-semibold text-foreground/90 mb-6">Connect an external data source</h1>
          
          <div className="bg-blue-50 border border-blue-100 rounded-md p-3 mb-8 flex items-start gap-3">
            <Info className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
            <p className="text-sm text-blue-800">
              <span className="font-semibold">dbt integration</span> is available for PostgreSQL, MySQL, BigQuery, Redshift, and Snowflake (For Essential Plan and above). <a href="#" className="text-blue-600 hover:underline">Contact Us</a> to suggest new data sources.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {SOURCE_TYPES.map((type) => (
              <button
                key={type.id}
                onClick={() => handleSelectType(type.id)}
                className="flex items-center gap-4 bg-background p-4 rounded-lg border border-border hover:border-blue-500 hover:shadow-sm transition-all text-left group"
              >
                <div className="w-10 h-10 flex items-center justify-center rounded bg-muted/50 group-hover:bg-blue-50 transition-colors">
                  {type.icon}
                </div>
                <span className="font-medium text-foreground/80 group-hover:text-blue-600 transition-colors">
                  {type.name}
                </span>
              </button>
            ))}
          </div>
        </div>

        <Dialog open={isOpen} onOpenChange={(open) => {
          setIsOpen(open);
          if (!open && !editingDs) setSelectedType(null);
        }}>
          <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>
                {editingDs ? t('editDataSource') : t('createNewDataSourceWithType', { type: SOURCE_TYPES.find(t => t.id === selectedType)?.name || "" })}
              </DialogTitle>
            </DialogHeader>
            <div className="py-4">
              <DataSourceForm 
                initialData={editingDs ? editingDs : (selectedType ? { name: "", type: selectedType, config: {} } : null)} 
                onSubmit={handleSubmit} 
                onTest={handleTest}
                onCancel={() => setIsOpen(false)}
              />
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  // Helper function to extract host and db from connection string
  const parseConnectionString = (url: string | undefined, type: 'host' | 'database') => {
    if (!url) return null;
    try {
      // Very basic parser for postgresql://user:pass@host:port/dbname format
      // Works for postgresql, mysql, etc.
      const withoutScheme = url.split('://')[1];
      if (!withoutScheme) return null;
      
      const parts = withoutScheme.split('@');
      const hostPortPath = parts.length > 1 ? parts[1] : parts[0];
      
      const pathParts = hostPortPath.split('/');
      const hostAndPort = pathParts[0];
      const host = hostAndPort.split(':')[0];
      
      let db = pathParts.length > 1 ? pathParts[1] : null;
      if (db && db.includes('?')) {
        db = db.split('?')[0]; // Remove query params like ?sslmode=require
      }
      
      return type === 'host' ? host : db;
    } catch (e) {
      return null;
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // Require 8px movement before drag starts to avoid accidental drags
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      setDatasources((items) => {
        const oldIndex = items.findIndex((item) => item.id === active.id);
        const newIndex = items.findIndex((item) => item.id === over.id);
        
        const newItems = arrayMove(items, oldIndex, newIndex);
        
        // 保存新的顺序到 localStorage
        if (currentProject) {
          localStorage.setItem(
            `datasources_order_${currentProject.id}`, 
            JSON.stringify(newItems.map(i => i.id))
          );
        }
        
        return newItems;
      });
    }
  };

  // Sortable Item Component
  const SortableDataSourceCard = ({ ds }: { ds: DataSourceConfig }) => {
    const {
      attributes,
      listeners,
      setNodeRef,
      transform,
      transition,
      isDragging
    } = useSortable({ id: ds.id! });

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
              <Database className="h-5 w-5" />
            </div>
            <div>
              <h3 className="font-semibold text-foreground">{ds.name}</h3>
              <p className="text-xs text-muted-foreground font-mono mt-0.5 uppercase">{ds.type}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-blue-600" onClick={() => navigate(`/modeling/${ds.id}`)} title="Data Modeling">
              <Network className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-muted-foreground" onClick={() => handleEdit(ds)}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(ds.id!)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
        
        <div className="space-y-2 ml-8">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Host</span>
            <span className="font-medium text-foreground/80 truncate max-w-[150px]" title={ds.config.host || ds.config.connection_string || "Local / File"}>
              {ds.config.host || parseConnectionString(ds.config.connection_string, 'host') || "Local / File"}
            </span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Database</span>
            <span className="font-medium text-foreground/80 truncate max-w-[150px]" title={ds.config.database || (ds.config.file_path ? ds.config.file_path.split('/').pop() : ds.config.connection_string || "-")}>
              {ds.config.database || parseConnectionString(ds.config.connection_string, 'database') || (ds.config.file_path ? ds.config.file_path.split('/').pop() : "-")}
            </span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col bg-background">
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-background">
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <Database className="h-5 w-5 text-indigo-500" />
          {t('dataSourceConfig')}
        </div>
        <Button onClick={handleCreate} className="h-9 bg-[#ff4d29] hover:bg-[#ff4d29]/90 text-white gap-2 rounded-md px-3">
          <Plus className="h-4 w-4" />
          {t('newDataSource')}
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : datasources.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-border rounded-xl bg-muted/50/50">
            <Database className="h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground font-medium">{t('noDataSources')}</p>
            <p className="text-muted-foreground text-sm mt-1">{t('clickTopRightToAddFirstDataSource')}</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext 
              items={datasources.map(ds => ds.id!)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {datasources.map((ds) => (
                  <SortableDataSourceCard key={ds.id} ds={ds} />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={(open) => {
        setIsOpen(open);
        if (!open && !editingDs) setSelectedType(null);
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingDs ? t('editDataSourceWithType', { type: SOURCE_TYPES.find(t => t.id === editingDs.type)?.name || editingDs.type }) : t('createNewDataSourceWithType', { type: SOURCE_TYPES.find(t => t.id === selectedType)?.name || "" })}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <DataSourceForm 
              initialData={editingDs ? editingDs : (selectedType ? { name: "", type: selectedType, config: {} } : null)} 
              onSubmit={handleSubmit} 
              onTest={handleTest}
              onCancel={() => setIsOpen(false)}
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
