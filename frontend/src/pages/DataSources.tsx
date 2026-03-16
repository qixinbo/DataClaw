import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { DataSourceForm, type DataSourceConfig } from "@/components/DataSourceForm";
import { Button } from "@/components/ui/button";
import { Plus, Database, Pencil, Trash2, Loader2, FolderOpen } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuthStore } from "@/store/authStore";
import { useProjectStore } from "@/store/projectStore";
import { useNavigate } from "react-router-dom";

export function DataSources() {
  const [datasources, setDatasources] = useState<DataSourceConfig[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [editingDs, setEditingDs] = useState<DataSourceConfig | null>(null);
  const { user } = useAuthStore();
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
      setDatasources(data);
    } catch (e) {
      console.error("Failed to fetch data sources", e);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreate = () => {
    setEditingDs(null);
    setIsOpen(true);
  };

  const handleEdit = (ds: DataSourceConfig) => {
    setEditingDs(ds);
    setIsOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("确定要删除这个数据源吗？")) return;
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
      alert("保存失败: " + (e as any).message);
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

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="border-b border-zinc-100 px-8 py-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900">数据源配置</h1>
          <p className="text-sm text-zinc-500 mt-1">管理可用于问答的数据源连接</p>
        </div>
        <Button onClick={handleCreate} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
          <Plus className="h-4 w-4" />
          新建数据源
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {isLoading ? (
          <div className="flex justify-center items-center h-64">
            <Loader2 className="h-8 w-8 animate-spin text-zinc-400" />
          </div>
        ) : datasources.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-200 rounded-xl bg-zinc-50/50">
            <Database className="h-10 w-10 text-zinc-300 mb-3" />
            <p className="text-zinc-500 font-medium">暂无数据源</p>
            <p className="text-zinc-400 text-sm mt-1">点击右上角按钮添加第一个数据源</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {datasources.map((ds) => (
              <div 
                key={ds.id} 
                className="group relative bg-white border border-zinc-200 rounded-xl p-5 hover:shadow-md transition-all hover:border-zinc-300"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center text-indigo-600">
                      <Database className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-zinc-900">{ds.name}</h3>
                      <p className="text-xs text-zinc-500 font-mono mt-0.5 uppercase">{ds.type}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-zinc-600" onClick={() => handleEdit(ds)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-zinc-400 hover:text-red-600 hover:bg-red-50" onClick={() => handleDelete(ds.id!)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Host</span>
                    <span className="font-medium text-zinc-700 truncate max-w-[150px]">
                      {ds.config.host || "Local / File"}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-500">Database</span>
                    <span className="font-medium text-zinc-700 truncate max-w-[150px]">
                      {ds.config.database || ds.config.file_path ? (ds.config.file_path?.split('/').pop()) : "-"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingDs ? "编辑数据源" : "新建数据源"}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <DataSourceForm 
              initialData={editingDs} 
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
