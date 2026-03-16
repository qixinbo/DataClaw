import { useMemo, useEffect } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { useDashboardStore } from '../store/dashboardStore';
import { useProjectStore } from '../store/projectStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { VegaChart } from "@/components/VegaChart";
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];

function isNumericValue(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed);
  }
  return false;
}

function inferChartKeys(data: Record<string, unknown>[]) {
  if (data.length === 0) {
    return { xKey: null as string | null, yKeys: [] as string[] };
  }
  const allKeys = Object.keys(data[0] || {});
  if (allKeys.length === 0) {
    return { xKey: null as string | null, yKeys: [] as string[] };
  }
  const preferredX = ['name', 'date', 'time', 'category', 'label'];
  const xKey = preferredX.find((k) => allKeys.includes(k)) || allKeys[0];
  const candidateY = allKeys.filter((k) => k !== xKey);
  const numericY = candidateY.filter((key) => data.some((row) => isNumericValue(row[key])));
  const yKeys = (numericY.length > 0 ? numericY : candidateY).slice(0, 3);
  return { xKey, yKeys };
}

export function Dashboard() {
  const { charts, removeChart, updateLayout, loadCharts } = useDashboardStore();
  const { currentProject } = useProjectStore();

  useEffect(() => {
    if (currentProject) {
      loadCharts(currentProject.id);
    }
  }, [currentProject, loadCharts]);

  const ResponsiveGridLayout = useMemo(
    () => WidthProvider(Responsive as any) as any,
    []
  );

  const layouts = useMemo(() => ({
    lg: charts.map((c) => c.layout)
  }), [charts]);

  const onLayoutChange = (currentLayout: any[]) => {
    if (currentProject) {
      updateLayout(
        currentLayout.map((item) => ({
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        })),
        currentProject.id
      );
    }
  };

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>请选择一个项目以查看仪表板。</p>
      </div>
    );
  }

  if (charts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>当前项目暂无图表。</p>
        <p className="text-sm">前往对话页并添加可视化结果！</p>
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-y-auto">
      <h1 className="text-2xl font-bold mb-4">Dashboard</h1>
      <ResponsiveGridLayout
        className="layout"
        layouts={layouts}
        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
        rowHeight={100}
        onLayoutChange={onLayoutChange}
        isDraggable
        isResizable
      >
        {charts.map((chart) => (
          <div key={chart.id} className="relative group">
            <Card className="h-full flex flex-col shadow-sm border-muted">
              <CardHeader className="pb-2 shrink-0 flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{chart.title}</CardTitle>
                  <CardDescription className="text-xs">{chart.type.toUpperCase()} Chart</CardDescription>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeChart(chart.id, currentProject.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-2">
                {(() => {
                  const rows = chart.data as Record<string, unknown>[];
                  if (chart.chartSpec && rows.length > 0) {
                    return (
                      <div className="h-full w-full rounded-xl border border-zinc-100 p-2">
                        <VegaChart data={rows} spec={chart.chartSpec} />
                      </div>
                    );
                  }
                  const { xKey, yKeys } = inferChartKeys(rows);
                  if (!xKey || yKeys.length === 0) {
                    return (
                      <div className="h-full w-full flex items-center justify-center text-xs text-zinc-500">
                        当前图表数据缺少可绘制字段
                      </div>
                    );
                  }
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      {chart.type === 'bar' ? (
                        <BarChart data={rows}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                          <Tooltip
                            cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          />
                          {yKeys.map((key, index) => (
                            <Bar key={key} dataKey={key} fill={CHART_COLORS[index % CHART_COLORS.length]} radius={[4, 4, 0, 0]} name={key} />
                          ))}
                        </BarChart>
                      ) : (
                        <LineChart data={rows}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                          <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                          <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                          <Tooltip
                            contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                          />
                          {yKeys.map((key, index) => (
                            <Line key={key} type="monotone" dataKey={key} stroke={CHART_COLORS[index % CHART_COLORS.length]} strokeWidth={2} dot={{ r: 3 }} />
                          ))}
                        </LineChart>
                      )}
                    </ResponsiveContainer>
                  );
                })()}
              </CardContent>
            </Card>
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
