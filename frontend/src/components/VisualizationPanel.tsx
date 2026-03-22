import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Code, Table as TableIcon, BarChart as ChartIcon, Download, LayoutDashboard, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDashboardStore, type ChartConfig } from "@/store/dashboardStore";
import { useVisualizationStore } from "@/store/visualizationStore";
import { useProjectStore } from "@/store/projectStore";
import { useTranslation } from "react-i18next";
import { VegaChart } from "./VegaChart";

export function VisualizationPanel() {
  const { t } = useTranslation();
  const [view, setView] = useState<'table' | 'chart'>('chart');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingChart, setPendingChart] = useState<Omit<ChartConfig, 'layout'> | null>(null);
  const [selectedDashboardId, setSelectedDashboardId] = useState<string>('');
  const { dashboards, addChart, loadDashboards } = useDashboardStore();
  const { currentProject } = useProjectStore();
  const { currentData, currentSQL, currentChartSpec, currentChartInfo, isLoading, error } = useVisualizationStore();

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

  const buildPendingChart = (): Omit<ChartConfig, 'layout'> | null => {
    if (!currentData || !currentSQL) return null;
    if (view === "table") {
      return {
        id: Date.now().toString(),
        title: currentChartSpec?.title || 'Generated Analysis',
        type: "table",
        data: currentData,
        sql: currentSQL,
        chartSpec: null,
      };
    }
    const mark = currentChartSpec?.mark;
    const markType = typeof mark === "string" ? mark : mark?.type;
    const dashboardType = markType === "line" ? "line" : "bar";
    return {
      id: Date.now().toString(),
      title: currentChartSpec?.title || 'Generated Analysis',
      type: dashboardType,
      data: currentData,
      sql: currentSQL,
      chartSpec: currentChartSpec,
    };
  };

  const handleAddToDashboard = () => {
    if (!currentProject) return;
    const chart = buildPendingChart();
    if (!chart) return;
    setPendingChart(chart);
    setConfirmOpen(true);
  };

  const handleConfirmAdd = () => {
    if (!pendingChart || !currentProject || !selectedDashboardId) return;
    addChart(pendingChart, selectedDashboardId, currentProject.id);
    setConfirmOpen(false);
    setPendingChart(null);
  };

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center bg-muted/10">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-2 text-muted-foreground">Generating visualization...</span>
      </div>
    );
  }

  if (error) {
    return (
        <div className="h-full flex flex-col items-center justify-center bg-muted/10 p-4">
            <div className="text-destructive font-semibold mb-2">Visualization Error</div>
            <div className="text-sm text-muted-foreground text-center">{error}</div>
        </div>
    )
  }

  if (!currentData || currentData.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-muted/10 text-muted-foreground">
        <ChartIcon className="h-12 w-12 mb-4 opacity-20" />
        <p>No data to visualize.</p>
        <p className="text-sm">Ask the chat to generate some insights!</p>
      </div>
    );
  }

  const objectRows = currentData.filter((row) => row && typeof row === "object" && !Array.isArray(row));
  if (objectRows.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-muted/10 text-muted-foreground">
        <ChartIcon className="h-12 w-12 mb-4 opacity-20" />
        <p>Data format is not supported for visualization.</p>
      </div>
    );
  }

  const columns = Object.keys(objectRows[0] as Record<string, unknown>);

  return (
    <div className="h-full flex flex-col bg-muted/10 overflow-hidden">
      {/* Toolbar */}
      <div className="border-b p-3 bg-background flex justify-between items-center shrink-0">
        <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground ml-2">Visualization</h2>
        <div className="flex gap-2 items-center">
           <div className="flex bg-muted rounded-md p-1 mr-2">
            <Button 
              variant={view === 'table' ? "secondary" : "ghost"} 
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setView('table')}
            >
              <TableIcon className="h-3.5 w-3.5 mr-1.5" />
              Table
            </Button>
            <Button 
              variant={view === 'chart' ? "secondary" : "ghost"} 
              size="sm"
              className="h-7 px-3 text-xs"
              onClick={() => setView('chart')}
            >
              <ChartIcon className="h-3.5 w-3.5 mr-1.5" />
              Chart
            </Button>
           </div>
           
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddToDashboard} disabled={dashboards.length === 0}>
            <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
            Add to Dashboard
          </Button>

          <Dialog>
            <DialogTrigger render={
              <Button variant="outline" size="sm" className="h-7 text-xs">
                <Code className="h-3.5 w-3.5 mr-1.5" />
                SQL
              </Button>
            } />
            <DialogContent className="sm:max-w-[625px]">
              <DialogHeader>
                <DialogTitle>Generated SQL Query</DialogTitle>
                <DialogDescription>
                  This is the SQL query generated by the AI to retrieve the data shown below.
                </DialogDescription>
              </DialogHeader>
              <div className="bg-slate-950 text-slate-50 p-4 rounded-md overflow-x-auto relative group">
                <pre className="text-sm font-mono">{currentSQL}</pre>
                <Button size="icon" variant="secondary" className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 h-6 w-6">
                  <Code className="h-3 w-3" />
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          
          <Button variant="outline" size="sm" className="h-7 text-xs">
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Export
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-4 overflow-hidden min-h-0">
        <Card className="h-full flex flex-col shadow-sm border-muted">
          <CardHeader className="pb-2 shrink-0">
            <CardTitle>{currentChartSpec?.title || 'Analysis Result'}</CardTitle>
            <CardDescription>{currentChartInfo?.reasoning || currentChartSpec?.description || 'Generated from your query'}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-4">
             {view === 'chart' ? (
                <div className="h-full w-full">
                  {currentChartSpec ? (
                    <VegaChart data={objectRows} spec={currentChartSpec} />
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                       <ChartIcon className="h-12 w-12 mb-4 opacity-20" />
                       <p>No chart configuration available for this data.</p>
                       <Button variant="link" onClick={() => setView('table')}>View Table</Button>
                    </div>
                  )}
                </div>
             ) : (
               <ScrollArea className="h-full border rounded-md">
                 <Table>
                   <TableHeader>
                     <TableRow>
                       {columns.map(col => <TableHead key={col}>{col}</TableHead>)}
                     </TableRow>
                   </TableHeader>
                   <TableBody>
                     {objectRows.map((row, i) => (
                       <TableRow key={i}>
                         {columns.map(col => (
                            <TableCell key={`${i}-${col}`}>{String((row as Record<string, unknown>)[col] ?? "")}</TableCell>
                         ))}
                       </TableRow>
                     ))}
                   </TableBody>
                 </Table>
               </ScrollArea>
             )}
          </CardContent>
        </Card>
      </div>
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
            <Button onClick={handleConfirmAdd} disabled={!selectedDashboardId}>{t('submit')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
