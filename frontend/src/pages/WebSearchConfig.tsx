import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Save, Loader2, Globe } from "lucide-react";
import { api } from "@/lib/api";

interface WebSearchConfig {
  provider: string;
  api_key?: string;
  base_url?: string;
  max_results: number;
}

export function WebSearchConfig() {
  const { t } = useTranslation();
  const [config, setConfig] = useState<WebSearchConfig>({ provider: 'duckduckgo', max_results: 5 });
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchConfig = async () => {
    setIsLoading(true);
    try {
      const data = await api.get<WebSearchConfig>('/api/v1/web-search/config');
      setConfig({
        provider: data.provider || 'duckduckgo',
        api_key: data.api_key || '',
        base_url: data.base_url || '',
        max_results: data.max_results || 5
      });
    } catch (err: unknown) {
      console.error("Failed to load web search config", err);
      setError(t('failedToLoadConfig', 'Failed to load configuration'));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setError('');
    setSuccess('');
    setIsSaving(true);
    try {
      await api.put('/api/v1/web-search/config', config);
      setSuccess(t('configSaved', 'Configuration saved successfully. Note: Active agents may require a restart to pick up the new configuration.'));
    } catch (err: unknown) {
      console.error("Failed to save web search config", err);
      const errorMessage = err instanceof Error ? err.message : t('failedToSaveConfig', 'Failed to save configuration');
      setError(errorMessage);
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const needsApiKey = ['brave', 'tavily', 'jina'].includes(config.provider);
  const needsBaseUrl = config.provider === 'searxng';

  return (
    <div className="flex-1 flex flex-col h-full bg-muted/50/30 overflow-hidden">
      <div className="h-14 px-6 flex items-center justify-between border-b border-border bg-background">
        <div className="flex items-center gap-2 text-foreground/80 font-medium">
          <Globe className="h-5 w-5 text-indigo-500" />
          {t('webSearchConfig', 'Web Search Configuration')}
        </div>
      </div>

      <div className="flex-1 p-6 overflow-auto">
        <div className="grid gap-6 max-w-4xl mx-auto">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-md p-3">{error}</div>}
          {success && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-100 rounded-md p-3">{success}</div>}
          
          <Card className="border-border shadow-sm">
            <CardHeader>
              <CardTitle className="text-xl">{t('webSearchConfig', 'Web Search Configuration')}</CardTitle>
              <CardDescription>{t('configureWebSearchProvider', 'Configure the default web search provider and settings for the AI agent.')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label>{t('provider', 'Provider')}</Label>
                <Select 
                  value={config.provider} 
                  onValueChange={(val) => { if (val) setConfig({ ...config, provider: val }) }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('selectProvider', 'Select a provider')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="duckduckgo">DuckDuckGo (Free, No API Key required)</SelectItem>
                    <SelectItem value="brave">Brave Search</SelectItem>
                    <SelectItem value="tavily">Tavily</SelectItem>
                    <SelectItem value="jina">Jina Reader</SelectItem>
                    <SelectItem value="searxng">SearXNG</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {needsApiKey && (
                <div className="space-y-2">
                  <Label>{t('apiKey', 'API Key')}</Label>
                  <Input 
                    type="password"
                    placeholder={t('enterApiKey', 'Enter API Key')}
                    value={config.api_key || ''}
                    onChange={(e) => setConfig({ ...config, api_key: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t('apiKeyRequiredFor', 'An API Key is required for {{provider}}', { provider: config.provider })}</p>
                </div>
              )}

              {needsBaseUrl && (
                <div className="space-y-2">
                  <Label>{t('baseUrl', 'Base URL')}</Label>
                  <Input 
                    placeholder="e.g. http://localhost:8080"
                    value={config.base_url || ''}
                    onChange={(e) => setConfig({ ...config, base_url: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{t('baseUrlRequiredFor', 'A Base URL is required for {{provider}}', { provider: config.provider })}</p>
                </div>
              )}

              <div className="space-y-2">
                <Label>{t('maxResults', 'Max Results')}</Label>
                <Input 
                  type="number"
                  min={1}
                  max={20}
                  value={config.max_results}
                  onChange={(e) => setConfig({ ...config, max_results: parseInt(e.target.value) || 5 })}
                />
                <p className="text-xs text-muted-foreground">{t('maxResultsDescription', 'Maximum number of search results to return (1-20)')}</p>
              </div>

            </CardContent>
            <CardFooter className="bg-muted/50/50 border-t border-border pt-6">
              <Button onClick={handleSave} className="ml-auto bg-indigo-600 hover:bg-indigo-700 text-primary-foreground" disabled={isSaving}>
                {isSaving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                {t('saveSettings', 'Save Settings')}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
