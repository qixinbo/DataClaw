import { useState, useEffect, useMemo } from "react";
import { Code2, Eye, X, Download, Copy, ExternalLink, Check, ChevronDown, FileIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
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
  const [activeTab, setActiveTab] = useState<'code' | 'preview' | 'fallback'>('preview');
  const [code, setCode] = useState<string>('');
  const [loadingCode, setLoadingCode] = useState(false);
  const [copied, setCopied] = useState(false);

  const { canPreview, canCode, isMarkdown } = useMemo(() => {
    const extension = artifact.name.split('.').pop()?.toLowerCase() || '';
    const textExtensions = ['py', 'js', 'ts', 'jsx', 'tsx', 'json', 'csv', 'md', 'txt', 'css', 'html', 'xml', 'yaml', 'yml', 'sql', 'sh', 'bat'];
    const isTextExt = textExtensions.includes(extension);
    const isHtmlExt = extension === 'html' || extension === 'htm';
    const isMd = extension === 'md' || artifact.mimeType === 'text/markdown';

    const isImage = artifact.mimeType.startsWith('image/');
    const isPdf = artifact.mimeType === 'application/pdf' || extension === 'pdf';
    const isHtml = artifact.mimeType === 'text/html' || isHtmlExt;
    const isText = artifact.mimeType.startsWith('text/') || 
      ["application/json", "application/javascript", "application/xml", "application/sql", "application/x-sh"].includes(artifact.mimeType) ||
      isTextExt;

    return {
      canPreview: isImage || isPdf || isHtml || isMd,
      canCode: isText || isHtml || isMd,
      isMarkdown: isMd
    };
  }, [artifact.mimeType, artifact.name]);

  useEffect(() => {
    // Reset state when artifact changes
    setCode('');
    if (canPreview) {
      setActiveTab('preview');
    } else if (canCode) {
      setActiveTab('code');
    } else {
      setActiveTab('fallback');
    }
  }, [artifact, canPreview, canCode]);

  useEffect(() => {
    // Need to fetch code for both 'code' view and markdown 'preview' view
    const needsCodeFetch = (activeTab === 'code' || (activeTab === 'preview' && isMarkdown)) && !code && artifact.downloadUrl;
    
    if (needsCodeFetch) {
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
  }, [activeTab, artifact.downloadUrl, code, isMarkdown]);

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

  const showToggle = canPreview && canCode;

  return (
    <div className="h-full flex flex-col bg-background border-l border-border shadow-2xl">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-background z-10">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm truncate">{artifact.name}</span>
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        </div>
        
        {showToggle && (
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
        {activeTab === 'fallback' ? (
          <div className="w-full h-full bg-background flex flex-col items-center justify-center p-6 text-center">
            <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
              <FileIcon className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2">
              {t('noPreviewAvailable', 'No preview available')}
            </h3>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              {t('noPreviewDesc', 'This file type cannot be previewed in the browser. Please download the file to view its contents.')}
            </p>
            <a
              href={artifact.downloadUrl}
              download={artifact.name}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg text-sm font-medium transition-colors"
            >
              <Download className="h-4 w-4" />
              {t('downloadFile', 'Download File')}
            </a>
          </div>
        ) : activeTab === 'preview' ? (
          <div className="w-full h-full bg-white overflow-auto">
            {isMarkdown ? (
              <div className="prose prose-sm max-w-none p-6">
                <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]}>
                  {code || "Loading..."}
                </ReactMarkdown>
              </div>
            ) : artifact.mimeType.startsWith("image/") ? (
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
