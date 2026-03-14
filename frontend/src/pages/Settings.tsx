import { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Save, Loader2 } from "lucide-react";
import { api } from "@/lib/api";

interface LLMConfig {
  id: string;
  provider: string;
  model: string;
  api_key?: string;
  api_base?: string;
  is_active: boolean;
}

export function Settings() {
  const [configId, setConfigId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('gpt-4-turbo');
  const [baseUrl, setBaseUrl] = useState('https://api.openai.com/v1');
  const [enableVoice, setEnableVoice] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setIsLoading(true);
    try {
        const configs = await api.get<LLMConfig[]>('/api/v1/llm');
        const activeConfig = configs.find(c => c.is_active) || configs[0];
        if (activeConfig) {
            setConfigId(activeConfig.id);
            setProvider(activeConfig.provider);
            setModel(activeConfig.model);
            setApiKey(activeConfig.api_key || '');
            setBaseUrl(activeConfig.api_base || '');
        }
    } catch (error) {
        console.error("Failed to fetch LLM config", error);
    } finally {
        setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
        const configData = {
            provider,
            model,
            api_key: apiKey,
            api_base: baseUrl,
            is_active: true
        };

        if (configId) {
            await api.put(`/api/v1/llm/${configId}`, configData);
        } else {
            const newId = Date.now().toString();
            await api.post('/api/v1/llm', { ...configData, id: newId });
            setConfigId(newId);
        }
        alert("Settings saved successfully!");
    } catch (error) {
        console.error("Failed to save settings", error);
        alert("Failed to save settings");
    } finally {
        setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
        <div className="h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
    );
  }

  return (
    <div className="p-6 h-full overflow-y-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Configure AI model and application preferences</p>
      </div>

      <div className="grid gap-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle>LLM Configuration</CardTitle>
            <CardDescription>Manage your Large Language Model settings</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="provider">Provider</Label>
              <Select value={provider} onValueChange={(val) => val && setProvider(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="azure">Azure OpenAI</SelectItem>
                  <SelectItem value="local">Local (Ollama/LM Studio)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="model">Model</Label>
              <Select value={model} onValueChange={(val) => val && setModel(val)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gpt-4-turbo">GPT-4 Turbo</SelectItem>
                  <SelectItem value="gpt-4o">GPT-4o</SelectItem>
                  <SelectItem value="gpt-3.5-turbo">GPT-3.5 Turbo</SelectItem>
                  <SelectItem value="claude-3-opus">Claude 3 Opus</SelectItem>
                  <SelectItem value="claude-3-sonnet">Claude 3 Sonnet</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key">API Key</Label>
              <Input 
                id="api-key" 
                type="password" 
                placeholder="sk-..." 
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="base-url">Base URL (Optional)</Label>
              <Input 
                id="base-url" 
                placeholder="https://api.openai.com/v1" 
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Interface Settings</CardTitle>
            <CardDescription>Customize your experience</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="voice-mode">Voice Mode</Label>
                <p className="text-sm text-muted-foreground">Enable voice input and output</p>
              </div>
              <Switch 
                id="voice-mode" 
                checked={enableVoice}
                onCheckedChange={setEnableVoice}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="dark-mode">Dark Mode</Label>
                <p className="text-sm text-muted-foreground">Toggle dark/light theme</p>
              </div>
              <Switch id="dark-mode" defaultChecked />
            </div>
          </CardContent>
          <CardFooter>
            <Button onClick={handleSave} className="ml-auto" disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
              Save Changes
            </Button>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}
