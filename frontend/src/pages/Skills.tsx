import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trash2, Edit2, Plus, Terminal, Loader2, FolderOpen } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";
import { useProjectStore } from "@/store/projectStore";

interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  type: 'python' | 'sql' | 'api';
  project_id?: number;
}

export function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
  const [newSkill, setNewSkill] = useState<Partial<Skill>>({ type: 'python', content: '' });
  const { currentProject } = useProjectStore();

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

  const handleAddSkill = async () => {
    if (!currentProject) return;
    if (newSkill.name && newSkill.description && newSkill.content) {
      try {
          if (editingSkill) {
              const updatedSkill = await api.put<Skill>(`/api/v1/skills/${editingSkill.id}?project_id=${currentProject.id}`, {
                  ...newSkill,
                  project_id: currentProject.id
              });
              setSkills(skills.map(s => s.id === editingSkill.id ? updatedSkill : s));
          } else {
              const skillToCreate = {
                  ...newSkill,
                  id: Date.now().toString(),
                  project_id: currentProject.id
              };
              const createdSkill = await api.post<Skill>('/api/v1/skills', skillToCreate);
              setSkills([...skills, createdSkill]);
          }
          setNewSkill({ type: 'python', content: '' });
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
    <div className="p-6 h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">技能管理 - {currentProject.name}</h1>
          <p className="text-muted-foreground">管理该项目的 AI 技能和工具</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) {
                setEditingSkill(null);
                setNewSkill({ type: 'python', content: '' });
            }
        }}>
          <DialogTrigger render={
            <Button onClick={() => {
                setEditingSkill(null);
                setNewSkill({ type: 'python', content: '' });
                setIsDialogOpen(true);
            }}>
              <Plus className="h-4 w-4 mr-2" />
              添加技能
            </Button>
          } />
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>{editingSkill ? '编辑技能' : '添加新技能'}</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">名称</Label>
                <Input 
                  id="name" 
                  value={newSkill.name || ''} 
                  onChange={(e) => setNewSkill({...newSkill, name: e.target.value})}
                  className="col-span-3" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="type" className="text-right">类型</Label>
                <Select 
                    value={newSkill.type} 
                    onValueChange={(val: any) => setNewSkill({...newSkill, type: val})}
                >
                    <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="选择类型" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="python">Python</SelectItem>
                        <SelectItem value="sql">SQL</SelectItem>
                        <SelectItem value="api">API</SelectItem>
                    </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="description" className="text-right">描述</Label>
                <Textarea 
                  id="description" 
                  value={newSkill.description || ''} 
                  onChange={(e) => setNewSkill({...newSkill, description: e.target.value})}
                  className="col-span-3" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="content" className="text-right">内容</Label>
                <Textarea 
                  id="content" 
                  value={newSkill.content || ''} 
                  onChange={(e) => setNewSkill({...newSkill, content: e.target.value})}
                  className="col-span-3 font-mono text-xs" 
                  placeholder="Python 代码、SQL 查询模板或 API 规范..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAddSkill}>保存技能</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <ScrollArea className="flex-1">
        {isLoading ? (
            <div className="flex items-center justify-center h-40">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pb-4">
            {skills.map((skill) => (
                <Card key={skill.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                    <div className="space-y-1">
                    <CardTitle className="text-base font-medium flex items-center gap-2">
                        <Terminal className="h-4 w-4 text-muted-foreground" />
                        {skill.name}
                    </CardTitle>
                    <CardDescription>{skill.type.toUpperCase()}</CardDescription>
                    </div>
                    <div className="flex gap-1">
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-foreground"
                        onClick={() => handleEditSkill(skill)}
                    >
                        <Edit2 className="h-4 w-4" />
                    </Button>
                    <Button 
                        variant="ghost" 
                        size="icon" 
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                        onClick={() => handleDeleteSkill(skill.id)}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">{skill.description}</p>
                </CardContent>
                </Card>
            ))}
            {skills.length === 0 && (
                <div className="col-span-full py-12 text-center text-zinc-500 bg-zinc-50 rounded-xl border-2 border-dashed border-zinc-100">
                    <Terminal className="h-12 w-12 mx-auto mb-4 opacity-20" />
                    <p>该项目尚无技能，点击“添加技能”开始</p>
                </div>
            )}
            </div>
        )}
      </ScrollArea>
    </div>
  );
}
