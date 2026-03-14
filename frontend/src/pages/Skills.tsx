import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Trash2, Edit2, Plus, Terminal, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/lib/api";

interface Skill {
  id: string;
  name: string;
  description: string;
  content: string;
  type: 'python' | 'sql' | 'api';
}

export function Skills() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [newSkill, setNewSkill] = useState<Partial<Skill>>({ type: 'python', content: '' });

  useEffect(() => {
    fetchSkills();
  }, []);

  const fetchSkills = async () => {
    setIsLoading(true);
    try {
        const data = await api.get<Skill[]>('/api/v1/skills');
        setSkills(data);
    } catch (error) {
        console.error("Failed to fetch skills", error);
    } finally {
        setIsLoading(false);
    }
  };

  const handleAddSkill = async () => {
    if (newSkill.name && newSkill.description && newSkill.content) {
      try {
          const skillToCreate = {
              ...newSkill,
              id: Date.now().toString(),
          };
          const createdSkill = await api.post<Skill>('/api/v1/skills', skillToCreate);
          setSkills([...skills, createdSkill]);
          setNewSkill({ type: 'python', content: '' });
          setIsDialogOpen(false);
      } catch (error) {
          console.error("Failed to create skill", error);
      }
    }
  };

  const handleDeleteSkill = async (id: string) => {
    try {
        await api.delete(`/api/v1/skills/${id}`);
        setSkills(skills.filter(s => s.id !== id));
    } catch (error) {
        console.error("Failed to delete skill", error);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col overflow-hidden">
      <div className="flex justify-between items-center mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-bold">Skills</h1>
          <p className="text-muted-foreground">Manage AI capabilities and tools</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger render={
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Skill
            </Button>
          } />
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Add New Skill</DialogTitle>
            </DialogHeader>
            <div className="grid gap-4 py-4">
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="name" className="text-right">Name</Label>
                <Input 
                  id="name" 
                  value={newSkill.name || ''} 
                  onChange={(e) => setNewSkill({...newSkill, name: e.target.value})}
                  className="col-span-3" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="type" className="text-right">Type</Label>
                <Select 
                    value={newSkill.type} 
                    onValueChange={(val: any) => setNewSkill({...newSkill, type: val})}
                >
                    <SelectTrigger className="col-span-3">
                        <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="python">Python</SelectItem>
                        <SelectItem value="sql">SQL</SelectItem>
                        <SelectItem value="api">API</SelectItem>
                    </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="description" className="text-right">Description</Label>
                <Textarea 
                  id="description" 
                  value={newSkill.description || ''} 
                  onChange={(e) => setNewSkill({...newSkill, description: e.target.value})}
                  className="col-span-3" 
                />
              </div>
              <div className="grid grid-cols-4 items-center gap-4">
                <Label htmlFor="content" className="text-right">Content</Label>
                <Textarea 
                  id="content" 
                  value={newSkill.content || ''} 
                  onChange={(e) => setNewSkill({...newSkill, content: e.target.value})}
                  className="col-span-3 font-mono text-xs" 
                  placeholder="Python code, SQL query template, or API spec..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={handleAddSkill}>Save Skill</Button>
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
                    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground">
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
                    <p className="text-sm text-muted-foreground line-clamp-2">
                    {skill.description}
                    </p>
                </CardContent>
                </Card>
            ))}
            </div>
        )}
      </ScrollArea>
    </div>
  );
}
