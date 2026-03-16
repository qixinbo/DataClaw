import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trash2, Edit2, Plus, Terminal, Loader2, FolderOpen, Share2, Download, Eye, ShieldCheck, AlertCircle, Wand2, Upload } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";
import { useRef } from 'react';

interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  type: string;
  project_id?: number;
  source: string;
  installation_time: string;
  status: string;
  file_path?: string;
}

export function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [newSkill, setNewSkill] = useState<Partial<Skill>>({ type: 'python', content: '', source: '本地导入', status: '安全' });
  const { currentProject } = useProjectStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentProject) {
      fetchSkills();
    }
  }, [currentProject]);

  const fetchSkills = async () => {
    if (!currentProject) return;
    setIsLoading(true);
    try {
        const data = await api.get<Skill[]>(`/api/v1/skills?project_id=${currentProject.id}`);
        setSkills(data);
    } catch (error) {
        console.error("Failed to fetch skills", error);
    } finally {
        setIsLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !currentProject) return;

    const formData = new FormData();
    formData.append('file', file);
    formData.append('project_id', currentProject.id.toString());

    setIsLoading(true);
    try {
      await api.post('/api/v1/skills/upload', formData);
      await fetchSkills();
    } catch (error: any) {
      console.error("Failed to upload skill", error);
      const errorMessage = error.response?.data?.detail || error.message || "未知错误";
      alert("上传失败: " + errorMessage);
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAddSkill = async () => {
    if (!currentProject) return;
    if (newSkill.name && newSkill.description && newSkill.content) {
      try {
          if (editingSkill) {
              await api.put<Skill>(`/api/v1/skills/${editingSkill.id}?project_id=${currentProject.id}`, {
                  ...newSkill,
                  project_id: currentProject.id
              });
          } else {
              const skillToCreate = {
                  ...newSkill,
                  id: Date.now().toString(),
                  project_id: currentProject.id
              };
              await api.post<Skill>('/api/v1/skills', skillToCreate);
          }
          await fetchSkills();
          setNewSkill({ type: 'python', content: '', source: '本地导入', status: '安全' });
          setEditingSkill(null);
          setIsDialogOpen(false);
      } catch (error) {
          console.error("Failed to save skill", error);
      }
    }
  };

  const handleEditSkill = (skill: Skill) => {
    setEditingSkill(skill);
    setNewSkill(skill);
    setIsDialogOpen(true);
  };

  const handleDeleteSkill = async (id: string) => {
    if (!currentProject) return;
    if (!window.confirm("确定要删除这个技能吗？")) return;
    try {
        await api.delete(`/api/v1/skills/${id}?project_id=${currentProject.id}`);
        setSkills(skills.filter(s => s.id !== id));
    } catch (error) {
        console.error("Failed to delete skill", error);
    }
  };

  if (!currentProject) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-zinc-500 gap-4">
        <FolderOpen className="h-12 w-12 text-zinc-200" />
        <p>请先在顶部选择一个项目以管理其技能</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="border-b border-zinc-100 px-8 py-5 flex items-center justify-between bg-white shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 flex items-center gap-2">
            < Wand2 className="h-6 w-6 text-indigo-500" />
            Skills 仓库 - {currentProject.name}
          </h1>
          <p className="text-sm text-zinc-500 mt-1">管理该项目的 AI 技能和工具，支持符合 agentskills.io 标准的文件上传</p>
        </div>
        <div className="flex gap-3">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileUpload}
            className="hidden"
            accept=".md,.zip,.tar.gz,.tgz"
          />
          <Button 
            className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            上传 Skill
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-8 bg-zinc-50/30">
        <div className="bg-white rounded-xl border border-zinc-200 shadow-sm overflow-hidden min-w-[800px] lg:min-w-0">
          <Table className="table-fixed w-full">
            <TableHeader className="bg-zinc-50/50">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[40%] font-semibold text-zinc-700 py-3 px-4 text-sm">名称</TableHead>
                <TableHead className="w-[15%] font-semibold text-zinc-700 py-3 px-4 text-sm">来源</TableHead>
                <TableHead className="w-[15%] font-semibold text-zinc-700 py-3 px-4 text-sm text-center">安装时间</TableHead>
                <TableHead className="w-[15%] font-semibold text-zinc-700 py-3 px-4 text-sm text-center">状态</TableHead>
                <TableHead className="w-[15%] font-semibold text-zinc-700 py-3 px-4 text-sm text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-24 text-center">
                    <div className="flex items-center justify-center">
                      <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {skills.map((skill) => (
                    <TableRow key={skill.id} className="group hover:bg-zinc-50/50 transition-colors border-zinc-100">
                      <TableCell className="py-4 px-4 overflow-hidden">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 mt-0.5 shrink-0">
                            <Terminal className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                              <h3 className="font-bold text-zinc-900 text-sm md:text-base truncate flex-1" title={skill.name}>{skill.name}</h3>
                              {skill.type === 'agentskill' && (
                                <span className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 text-[10px] font-bold rounded uppercase tracking-wider shrink-0">
                                  Agent
                                </span>
                              )}
                            </div>
                            <p 
                              className="text-zinc-500 text-xs leading-relaxed truncate cursor-help"
                              title={skill.description}
                            >
                              {skill.description}
                            </p>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-zinc-600 text-sm">
                        <div className="truncate" title={skill.source}>{skill.source}</div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-zinc-400 text-center text-xs">
                        <div className="truncate">{skill.installation_time}</div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-center">
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] md:text-xs font-medium whitespace-nowrap ${
                          skill.status === '安全' 
                          ? 'bg-green-50 text-green-700 border border-green-100' 
                          : 'bg-amber-50 text-amber-700 border border-amber-100'
                        }`}>
                          {skill.status === '安全' ? (
                            <ShieldCheck className="h-3 w-3" />
                          ) : (
                            <AlertCircle className="h-3 w-3" />
                          )}
                          {skill.status}
                        </div>
                      </TableCell>
                      <TableCell className="py-4 px-4 text-right">
                        <div className="flex justify-end gap-1">
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-zinc-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-md transition-all"
                            onClick={() => handleEditSkill(skill)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button 
                            variant="ghost" 
                            size="icon" 
                            className="h-8 w-8 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 rounded-md transition-all"
                            onClick={() => handleDeleteSkill(skill.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {skills.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5} className="py-24 text-center">
                        <div className="flex flex-col items-center gap-3 text-zinc-400">
                          <div className="p-4 bg-zinc-50 rounded-2xl">
                            <Terminal className="h-10 w-10 opacity-20" />
                          </div>
                          <p className="text-sm">该项目尚无技能，点击“导入 Skill”开始</p>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
              setEditingSkill(null);
              setNewSkill({ type: 'python', content: '', source: '本地导入', status: '安全' });
          }
      }}>
        <DialogContent className="sm:max-w-[600px] max-h-[90vh] flex flex-col rounded-2xl p-0 overflow-hidden">
          <DialogHeader className="p-6 pb-2">
            <DialogTitle className="text-xl font-bold text-zinc-900">{editingSkill ? '编辑技能' : '添加新技能'}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-2">
            <div className="grid gap-5">
              <div className="grid gap-1.5">
                <Label htmlFor="name" className="text-zinc-600 font-medium text-sm">名称</Label>
                <Input 
                  id="name" 
                  placeholder="技能名称"
                  value={newSkill.name || ''} 
                  onChange={(e) => setNewSkill({...newSkill, name: e.target.value})}
                  className="rounded-lg border-zinc-200 h-10" 
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="grid gap-1.5">
                  <Label htmlFor="type" className="text-zinc-600 font-medium text-sm">类型</Label>
                  <Select 
                      value={newSkill.type} 
                      onValueChange={(val: any) => setNewSkill({...newSkill, type: val})}
                  >
                      <SelectTrigger className="rounded-lg border-zinc-200 h-10">
                          <SelectValue placeholder="选择类型" />
                      </SelectTrigger>
                      <SelectContent className="rounded-lg">
                          <SelectItem value="python">Python</SelectItem>
                          <SelectItem value="sql">SQL</SelectItem>
                          <SelectItem value="api">API</SelectItem>
                      </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="status" className="text-zinc-600 font-medium text-sm">状态</Label>
                  <Select 
                      value={newSkill.status} 
                      onValueChange={(val: any) => setNewSkill({...newSkill, status: val})}
                  >
                      <SelectTrigger className="rounded-lg border-zinc-200 h-10">
                          <SelectValue placeholder="选择状态" />
                      </SelectTrigger>
                      <SelectContent className="rounded-lg">
                          <SelectItem value="安全">安全</SelectItem>
                          <SelectItem value="低风险">低风险</SelectItem>
                      </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="description" className="text-zinc-600 font-medium text-sm">描述</Label>
                <Textarea 
                  id="description" 
                  placeholder="简要描述技能的功能..."
                  value={newSkill.description || ''} 
                  onChange={(e) => setNewSkill({...newSkill, description: e.target.value})}
                  className="rounded-lg border-zinc-200 min-h-[80px] py-2 text-sm" 
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="content" className="text-zinc-600 font-medium text-sm">内容</Label>
                <Textarea 
                  id="content" 
                  value={newSkill.content || ''} 
                  onChange={(e) => setNewSkill({...newSkill, content: e.target.value})}
                  className="rounded-lg border-zinc-200 font-mono text-xs min-h-[160px] py-3 bg-zinc-50" 
                  placeholder="Python 代码、SQL 查询模板或 API 规范..."
                />
              </div>
            </div>
          </div>
          <DialogFooter className="p-6 pt-2">
            <Button onClick={handleAddSkill} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg px-6 h-10 w-full">
              保存技能
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

