import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Code, Table as TableIcon, BarChart as ChartIcon, LayoutDashboard, Copy, Check } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDashboardStore, type ChartConfig } from "@/store/dashboardStore";
import { useProjectStore } from "@/store/projectStore";
import { useTranslation } from "react-i18next";
import type { ChartSpec } from "@/store/visualizationStore";
import { VegaChart } from "./VegaChart";
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { format } from 'sql-formatter';

interface InlineVisualizationCardProps {
  viz: {
    sql: string;
    rows: unknown[];
    chartSpec: ChartSpec | null;
    canVisualize: boolean;
    reasoning?: string;
    error?: string | null;
  };
}

export function InlineVisualizationCard({ viz }: InlineVisualizationCardProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<'table' | 'chart'>('chart');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [pendingChart, setPendingChart] = useState<Omit<ChartConfig, 'layout'> | null>(null);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>('');
  const { dashboards, addChart, loadDashboards } = useDashboardStore();
  const { currentProject } = useProjectStore();
  const objectRows = viz.rows.filter((row) => row && typeof row === "object" && !Array.isArray(row)) as Record<string, unknown>[];
  const columns = objectRows.length > 0 ? Object.keys(objectRows[0]) : [];

  useEffect(() => {
    if (currentProject) {
      loadDashboards(currentProject.id);
    }
  }, [currentProject, loadDashboards]);

  useEffect(() => {
    if (dashboards.length > 0 && !selectedDashboardId) {
      setSelectedDashboardId(dashboards[0].id);
    }
  }, [dashboards, selectedDashboardId]);

  const buildPendingChart = (): Omit<ChartConfig, 'layout'> => {
    if (view === "table") {
      return {
        id: Date.now().toString(),
        title: viz.chartSpec?.title || "Generated Analysis",
        type: "table",
        data: objectRows,
        sql: viz.sql,
        chartSpec: null,
      };
    }
    const mark = viz.chartSpec?.mark;
    const markType = typeof mark === "string" ? mark : mark?.type;
    const dashboardType = markType === "line" ? "line" : "bar";
    return {
      id: Date.now().toString(),
      title: viz.chartSpec?.title || "Generated Analysis",
      type: dashboardType,
      data: objectRows,
      sql: viz.sql,
      chartSpec: viz.chartSpec,
    };
  };

  const handleAddToDashboard = () => {
    if (!currentProject) return;
    const chart = buildPendingChart();
    setPendingChart(chart);
    setConfirmOpen(true);
  };

  const handleConfirmAdd = () => {
    if (!pendingChart || !currentProject || !selectedDashboardId) return;
    addChart(pendingChart, selectedDashboardId, currentProject.id);
    setConfirmOpen(false);
    setPendingChart(null);
  };

  const handleCopySql = () => {
    navigator.clipboard.writeText(viz.sql || "");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formattedSql = viz.sql ? format(viz.sql, { language: 'postgresql' }) : "--";

  if (viz.error) {
    return <div className="text-sm text-red-500">{viz.error}</div>;
  }

  return (
    <Card className="w-full border border-border shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{viz.chartSpec?.title || t('visualizationResult')}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex bg-muted rounded-md p-1">
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setView("table")}
            >
              <TableIcon className="h-3.5 w-3.5 mr-1.5" />
              Table
            </Button>
            <Button
              variant={view === "chart" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setView("chart")}
            >
              <ChartIcon className="h-3.5 w-3.5 mr-1.5" />
              Chart
            </Button>
            <Dialog>
              <DialogTrigger render={
                <Button variant="ghost" size="sm" className="h-7 px-3 text-xs">
                  <Code className="h-3.5 w-3.5 mr-1.5" />
                  SQL
                </Button>
              } />
              <DialogContent className="sm:max-w-[700px]">
                 <DialogHeader className="flex flex-row items-start justify-between pr-8">
                   <div>
                     <DialogTitle>Generated SQL Query</DialogTitle>
                     <DialogDescription className="mt-1">{t('sqlQueryDescription')}</DialogDescription>
                   </div>
                   <Button
                     variant="outline"
                     size="sm"
                     className="h-8 gap-1.5 shrink-0"
                     onClick={handleCopySql}
                   >
                    {copied ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        <span>{t('copied')}</span>
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        <span>{t('copy')}</span>
                      </>
                    )}
                  </Button>
                </DialogHeader>
                <div className="relative rounded-md overflow-hidden bg-[#1e1e1e] border border-border shadow-inner mt-2">
                  <ScrollArea className="max-h-[500px]">
                    <SyntaxHighlighter
                      language="sql"
                      style={vscDarkPlus}
                      customStyle={{
                        margin: 0,
                        padding: '1.25rem',
                        fontSize: '0.875rem',
                        lineHeight: '1.5',
                        background: 'transparent',
                      }}
                    >
                      {formattedSql}
                    </SyntaxHighlighter>
                  </ScrollArea>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddToDashboard} disabled={objectRows.length === 0 || dashboards.length === 0}>
              <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
              Add to Dashboard
            </Button>
          </div>
        </div>

        {view === "chart" ? (
          viz.chartSpec && objectRows.length > 0 ? (
            <div className="w-full h-80 min-h-[320px] rounded-xl border border-border p-2">
              <VegaChart data={objectRows} spec={viz.chartSpec} />
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">{t('resultNotSuitableForChart')}</div>
          )
        ) : objectRows.length > 0 ? (
          <ScrollArea className="h-80 border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  {columns.map((col) => <TableHead key={col}>{col}</TableHead>)}
                </TableRow>
              </TableHeader>
              <TableBody>
                {objectRows.map((row, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={`${i}-${col}`}>{String(row[col] ?? "")}</TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        ) : (
          <div className="text-sm text-muted-foreground">{t('noStructuredDataToRender')}</div>
        )}
      </CardContent>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('pinChartToDashboard')}</DialogTitle>
            <DialogDescription>
              {t('selectDashboardToPin')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <label className="text-sm font-medium mb-2 block">{t('dashboardMenu')}</label>
            <Select value={selectedDashboardId} onValueChange={(val) => { if (val) setSelectedDashboardId(val); }}>
              <SelectTrigger>
                <SelectValue placeholder={t('selectDashboard')}>
                  {dashboards.find(d => d.id === selectedDashboardId)?.name || t('selectDashboard')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {dashboards.map(d => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setPendingChart(null);
              }}
            >
              {t('cancel')}
            </Button>
            <Button onClick={handleConfirmAdd} disabled={!selectedDashboardId}>
              {t('submit')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
