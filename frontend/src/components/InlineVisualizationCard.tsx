import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Code, Table as TableIcon, BarChart as ChartIcon, LayoutDashboard } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDashboardStore, type ChartConfig } from "@/store/dashboardStore";
import { useProjectStore } from "@/store/projectStore";
import type { ChartSpec } from "@/store/visualizationStore";
import { VegaChart } from "./VegaChart";

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
  const [view, setView] = useState<'table' | 'chart'>('chart');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingChart, setPendingChart] = useState<Omit<ChartConfig, 'layout'> | null>(null);
  const { addChart } = useDashboardStore();
  const { currentProject } = useProjectStore();
  const objectRows = viz.rows.filter((row) => row && typeof row === "object" && !Array.isArray(row)) as Record<string, unknown>[];
  const columns = objectRows.length > 0 ? Object.keys(objectRows[0]) : [];

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
    if (!pendingChart || !currentProject) return;
    addChart(pendingChart, currentProject.id);
    setConfirmOpen(false);
    setPendingChart(null);
  };

  if (viz.error) {
    return <div className="text-sm text-red-500">{viz.error}</div>;
  }

  return (
    <Card className="w-full border border-zinc-100 shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{viz.chartSpec?.title || "可视化结果"}</CardTitle>
        <CardDescription>{viz.reasoning || "根据当前回答生成的可视化"}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex bg-zinc-100 rounded-md p-1">
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
              <DialogContent className="sm:max-w-[625px]">
                <DialogHeader>
                  <DialogTitle>Generated SQL Query</DialogTitle>
                  <DialogDescription>用于生成当前图表的数据查询语句。</DialogDescription>
                </DialogHeader>
                <div className="bg-slate-950 text-slate-50 p-4 rounded-md overflow-x-auto">
                  <pre className="text-sm font-mono">{viz.sql || "--"}</pre>
                </div>
              </DialogContent>
            </Dialog>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddToDashboard} disabled={objectRows.length === 0}>
              <LayoutDashboard className="h-3.5 w-3.5 mr-1.5" />
              Add to Dashboard
            </Button>
          </div>
        </div>

        {view === "chart" ? (
          viz.canVisualize && viz.chartSpec && objectRows.length > 0 ? (
            <div className="w-full h-80 rounded-xl border border-zinc-100 p-2">
              <VegaChart data={objectRows} spec={viz.chartSpec} />
            </div>
          ) : (
            <div className="text-sm text-zinc-500">本次结果不适合图表展示。</div>
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
          <div className="text-sm text-zinc-500">当前结果没有可渲染的结构化数据。</div>
        )}
      </CardContent>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>确认加入 Dashboard</DialogTitle>
            <DialogDescription>
              将当前图表添加到 Dashboard，是否继续？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setConfirmOpen(false);
                setPendingChart(null);
              }}
            >
              取消
            </Button>
            <Button onClick={handleConfirmAdd}>
              确认添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
