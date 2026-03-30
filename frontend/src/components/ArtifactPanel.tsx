import { useState, useEffect } from "react";
import { Code2, Eye, X, Download, Copy, ExternalLink, Check, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { cn } from "@/lib/utils";

interface ArtifactPreviewTarget {
  name: string;
  mimeType: string;
  previewUrl: string;
  downloadUrl: string;
}

interface ArtifactPanelProps {
  artifact: ArtifactPreviewTarget;
  onClose: () => void;
}

export function ArtifactPanel({ artifact, onClose }: ArtifactPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<'code' | 'preview'>('preview');
  const [code, setCode] = useState<string>('');
  const [loadingCode, setLoadingCode] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Reset state when artifact changes
    setCode('');
    if (artifact.mimeType.startsWith("image/") || artifact.mimeType.startsWith("application/pdf")) {
      setActiveTab('preview');
    } else {
      setActiveTab('preview');
    }
  }, [artifact]);

  useEffect(() => {
    if (activeTab === 'code' && !code && artifact.downloadUrl) {
      setLoadingCode(true);
      fetch(artifact.downloadUrl)
        .then(res => res.text())
        .then(text => {
          setCode(text);
          setLoadingCode(false);
        })
        .catch(err => {
          console.error("Failed to fetch code", err);
          setCode("Failed to load code.");
          setLoadingCode(false);
        });
    }
  }, [activeTab, artifact.downloadUrl, code]);

  const handleCopy = async () => {
    if (code) {
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    }
  };

  const isCodeViewSupported = !artifact.mimeType.startsWith("image/") && !artifact.mimeType.startsWith("application/pdf");

  return (
    <div className="h-full flex flex-col bg-background border-l border-border shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background z-10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm truncate">{artifact.name}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        
        {isCodeViewSupported && (
          <div className="flex items-center bg-muted/50 rounded-lg p-0.5 ml-4">
            <button
              onClick={() => setActiveTab('code')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                activeTab === 'code' 
                  ? "bg-background text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              <Code2 className="h-4 w-4" />
            </button>
            <button
              onClick={() => setActiveTab('preview')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all",
                activeTab === 'preview' 
                  ? "bg-background text-foreground shadow-sm" 
                  : "text-muted-foreground hover:text-foreground hover:bg-background/50"
              )}
            >
              <Eye className="h-4 w-4" />
            </button>
          </div>
        )}

        <div className="flex items-center gap-1 ml-auto">
          {activeTab === 'code' && (
            <button
              onClick={handleCopy}
              className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
              title={t('copy', 'Copy')}
            >
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
            </button>
          )}
          <a
            href={artifact.previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title={t('openInNewTab', 'Open in new tab')}
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <a
            href={artifact.downloadUrl}
            download={artifact.name}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title={t('download', 'Download')}
          >
            <Download className="h-4 w-4" />
          </a>
          <div className="w-px h-4 bg-border mx-1" />
          <button
            onClick={onClose}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors"
            title={t('close', 'Close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0 relative bg-zinc-950">
        {activeTab === 'preview' ? (
          <div className="w-full h-full bg-white">
            {artifact.mimeType.startsWith("image/") ? (
              <img
                src={artifact.previewUrl}
                alt={artifact.name}
                className="w-full h-full object-contain bg-muted/50"
              />
            ) : (
              <iframe
                title={artifact.name}
                src={artifact.previewUrl}
                className="w-full h-full border-0"
                sandbox="allow-same-origin allow-scripts"
                onLoad={(e) => {
                  try {
                    const doc = (e.target as HTMLIFrameElement).contentDocument;
                    if (doc) {
                      const style = doc.createElement('style');
                      style.textContent = `html, body { overflow: auto !important; }`;
                      doc.head.appendChild(style);
                    }
                  } catch (err) {
                    console.error("Failed to inject styles into iframe", err);
                  }
                }}
              />
            )}
          </div>
        ) : (
          <div className="w-full h-full overflow-auto text-[13px]">
            {loadingCode ? (
              <div className="h-full flex items-center justify-center text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                  Loading code...
                </div>
              </div>
            ) : (
              <SyntaxHighlighter
                language={artifact.name.split('.').pop() || 'text'}
                style={vscDarkPlus}
                customStyle={{
                  margin: 0,
                  padding: '1rem',
                  background: 'transparent',
                  minHeight: '100%'
                }}
                showLineNumbers
              >
                {code}
              </SyntaxHighlighter>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
