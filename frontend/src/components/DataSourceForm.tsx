import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Check, AlertTriangle, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";

export interface DataSourceConfig {
  id?: number;
  name: string;
  type: string;
  config: Record<string, any>;
}

interface DataSourceFormProps {
  initialData?: DataSourceConfig | null;
  onSubmit: (data: Omit<DataSourceConfig, "id">) => Promise<void>;
  onTest: (type: string, config: Record<string, any>) => Promise<boolean>;
  onCancel: () => void;
}

export function DataSourceForm({ initialData, onSubmit, onTest, onCancel }: DataSourceFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialData?.name || "");
  const [type, setType] = useState(initialData?.type || "postgres");
  const [config, setConfig] = useState<Record<string, any>>(initialData?.config || {});
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleConfigChange = (key: string, value: any) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);

    try {
      // @ts-ignore
      const res = await api.post("/api/v1/upload/file", formData);
      if (res && (res as any).url) {
        handleConfigChange("file_path", (res as any).url);
      }
    } catch (error) {
      console.error("Upload failed", error);
      alert(t('uploadFailed'));
    } finally {
      setIsUploading(false);
      // Clear input value so same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleTest = async () => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const success = await onTest(type, config);
      setTestResult({
        success,
        message: success ? t('connectionSuccess') : t('connectionFailed'),
      });
    } catch (e: any) {
      setTestResult({
        success: false,
        message: e.message || t('connectionFailed'),
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      await onSubmit({ name, type, config });
    } finally {
      setIsSaving(false);
    }
  };

  const renderConfigFields = () => {
    switch (type) {
      case "supabase":
        return (
          <div className="space-y-4">
             <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Host</label>
                <Input 
                  value={config.host || ""} 
                  onChange={e => handleConfigChange("host", e.target.value)} 
                  placeholder="aws-0-[region].pooler.supabase.com" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Port</label>
                <Input 
                  type="number"
                  value={config.port || 6543} 
                  onChange={e => handleConfigChange("port", parseInt(e.target.value))} 
                  placeholder="6543"
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Database</label>
              <Input 
                value={config.database || "postgres"} 
                onChange={e => handleConfigChange("database", e.target.value)} 
                placeholder="postgres" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input 
                value={config.user || ""} 
                onChange={e => handleConfigChange("user", e.target.value)} 
                placeholder="postgres.[project-ref]" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input 
                type="password"
                value={config.password || ""} 
                onChange={e => handleConfigChange("password", e.target.value)} 
                placeholder="••••••" 
              />
            </div>
            <div className="text-xs text-zinc-500 pt-2">
              {t('orUseSupabaseConnectionString')}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Connection String</label>
              <Input 
                value={config.connection_string || ""} 
                onChange={e => handleConfigChange("connection_string", e.target.value)} 
                placeholder="postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require"
              />
            </div>
          </div>
        );
      case "postgres":
      case "postgresql":
      case "mysql":
      case "sqlserver":
      case "oracle":
      case "redshift":
        return (
          <div className="space-y-4">
             <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Host</label>
                <Input 
                  value={config.host || ""} 
                  onChange={e => handleConfigChange("host", e.target.value)} 
                  placeholder="localhost" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Port</label>
                <Input 
                  type="number"
                  value={config.port || (type === "postgres" ? 5432 : type === "mysql" ? 3306 : 5432)} 
                  onChange={e => handleConfigChange("port", parseInt(e.target.value))} 
                  placeholder={type === "postgres" ? "5432" : type === "mysql" ? "3306" : "5432"}
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Database</label>
              <Input 
                value={config.database || ""} 
                onChange={e => handleConfigChange("database", e.target.value)} 
                placeholder="database_name" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input 
                value={config.user || ""} 
                onChange={e => handleConfigChange("user", e.target.value)} 
                placeholder="username" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input 
                type="password"
                value={config.password || ""} 
                onChange={e => handleConfigChange("password", e.target.value)} 
                placeholder="••••••" 
              />
            </div>
            <div className="text-xs text-zinc-500 pt-2">
              {t('orUseConnectionString')}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Connection String</label>
              <Input 
                value={config.connection_string || ""} 
                onChange={e => handleConfigChange("connection_string", e.target.value)} 
                placeholder={type === "postgres" ? "postgresql://user:pass@host:5432/db" : "mysql://user:pass@host:3306/db"}
              />
            </div>
          </div>
        );
      case "clickhouse":
        return (
          <div className="space-y-4">
             <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Host</label>
                <Input 
                  value={config.host || ""} 
                  onChange={e => handleConfigChange("host", e.target.value)} 
                  placeholder="localhost" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Port</label>
                <Input 
                  type="number"
                  value={config.port || 9000} 
                  onChange={e => handleConfigChange("port", parseInt(e.target.value))} 
                  placeholder="9000" 
                />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Database</label>
              <Input 
                value={config.database || ""} 
                onChange={e => handleConfigChange("database", e.target.value)} 
                placeholder="default" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Username</label>
              <Input 
                value={config.user || ""} 
                onChange={e => handleConfigChange("user", e.target.value)} 
                placeholder="default" 
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <Input 
                type="password"
                value={config.password || ""} 
                onChange={e => handleConfigChange("password", e.target.value)} 
                placeholder="••••••" 
              />
            </div>
          </div>
        );
      case "sqlite":
      case "parquet":
      case "csv":
        return (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('fileUpload')}</label>
              <div className="flex gap-2">
                <Input 
                  value={config.file_path || ""} 
                  onChange={e => handleConfigChange("file_path", e.target.value)} 
                  placeholder="/path/to/file" 
                />
                <Button type="button" variant="outline" onClick={handleFileSelect} disabled={isUploading}>
                   {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                </Button>
                <input 
                  key={`${type}-input`}
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept={type === "sqlite" ? ".db,.sqlite,.sqlite3" : type === "parquet" ? ".parquet" : ".csv"}
                  onChange={handleFileUpload}
                />
              </div>
              <p className="text-xs text-zinc-500">{t('uploadFileOrEnterPath')}</p>
            </div>
          </div>
        );
      default:
        return (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <AlertTriangle className="h-10 w-10 text-amber-500 mb-3" />
            <h3 className="font-medium text-zinc-900">{t('unsupportedDataSourceType')}</h3>
            <p className="text-sm text-zinc-500 mt-1 max-w-[300px]">
              {t('dataSourceConnectorInDevelopment')}
            </p>
          </div>
        );
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <label className="text-sm font-medium">{t('name')}</label>
        <Input 
          value={name} 
          onChange={e => setName(e.target.value)} 
          placeholder={t('myDataSource')} 
          required 
        />
      </div>

      {!initialData?.type && (
        <div className="space-y-2">
          <label className="text-sm font-medium">{t('type')}</label>
          <select
            className="w-full h-10 px-3 rounded-md border border-zinc-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-zinc-950 focus:border-transparent"
            value={type}
            onChange={e => setType(e.target.value)}
          >
            <option value="postgres">PostgreSQL</option>
            <option value="clickhouse">ClickHouse</option>
            <option value="sqlite">SQLite</option>
            <option value="supabase">Supabase</option>
            <option value="parquet">Parquet</option>
            <option value="mysql">MySQL</option>
            <option value="csv">CSV</option>
          </select>
        </div>
      )}

      <div className="p-4 border border-zinc-200 rounded-lg bg-zinc-50/50">
        {renderConfigFields()}
      </div>

      {testResult && (
        <div className={`p-3 rounded-md flex items-center gap-2 text-sm ${testResult.success ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {testResult.success ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          {testResult.message}
        </div>
      )}

      <div className="flex justify-end gap-3 pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button 
          type="button" 
          variant="secondary" 
          onClick={handleTest}
          disabled={isTesting}
        >
          {isTesting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('testConnection')}
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
      </div>
    </form>
  );
}
