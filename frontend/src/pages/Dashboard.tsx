import { useState, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Responsive, WidthProvider } from 'react-grid-layout/legacy';
import { useDashboardStore } from '../store/dashboardStore';
import { useProjectStore } from '../store/projectStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { X, Type, AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { VegaChart } from "@/components/VegaChart";
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const CHART_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
const TABLE_PREVIEW_LIMIT = 20;

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
  const { t } = useTranslation();
  const { dashboards, activeDashboardId, removeChart, updateLayout, loadDashboards, renameDashboard, updateDashboardTitleStyle } = useDashboardStore();
  const { currentProject } = useProjectStore();

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (currentProject) {
      loadDashboards(currentProject.id);
    }
  }, [currentProject, loadDashboards]);

  const activeDashboard = useMemo(() => {
    return dashboards.find((d) => d.id === activeDashboardId) || dashboards[0] || null;
  }, [dashboards, activeDashboardId]);

  const charts = activeDashboard?.charts || [];

  const ResponsiveGridLayout = useMemo(
    () => WidthProvider(Responsive as any) as any,
    []
  );

  const layouts = useMemo(() => ({
    lg: charts.map((c) => c.layout)
  }), [charts]);

  const onLayoutChange = (currentLayout: any[]) => {
    if (currentProject && activeDashboard) {
      updateLayout(
        currentLayout.map((item) => ({
          i: item.i,
          x: item.x,
          y: item.y,
          w: item.w,
          h: item.h,
        })),
        activeDashboard.id,
        currentProject.id
      );
    }
  };

  const handleTitleSubmit = () => {
    if (activeDashboard && currentProject && editTitle.trim()) {
      renameDashboard(activeDashboard.id, editTitle.trim(), currentProject.id);
    }
    setIsEditingTitle(false);
  };

  const handleStyleChange = (key: string, value: string) => {
    if (activeDashboard && currentProject) {
      updateDashboardTitleStyle(activeDashboard.id, { [key]: value }, currentProject.id);
    }
  };

  if (!currentProject) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>{t('selectProjectToViewDashboard')}</p>
      </div>
    );
  }

  if (dashboards.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>{t('noDashboardsInCurrentProject')}</p>
        <p className="text-sm">{t('createDashboardToGetStarted')}</p>
      </div>
    );
  }

  if (!activeDashboard || charts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>{t('noChartsInCurrentProject')}</p>
        <p className="text-sm">{t('goToChatToAddCharts')}</p>
      </div>
    );
  }

  return (
    <div className="p-4 h-full overflow-y-auto">
      <div className="mb-4 flex items-center justify-between group">
        {isEditingTitle ? (
          <Input
            ref={titleInputRef}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleTitleSubmit();
              if (e.key === 'Escape') setIsEditingTitle(false);
            }}
            className="text-2xl font-bold h-auto py-1 px-2 -ml-2 bg-transparent border-transparent hover:border-zinc-200 focus:border-indigo-500 focus:ring-indigo-500 max-w-md"
          />
        ) : (
          <div className="flex items-center gap-2">
            <h1 
              className="text-2xl font-bold cursor-pointer hover:bg-zinc-100 px-2 py-1 -ml-2 rounded transition-colors"
              style={{
                fontSize: activeDashboard.titleStyle?.fontSize || '1.5rem',
                fontWeight: activeDashboard.titleStyle?.fontWeight || '700',
                color: activeDashboard.titleStyle?.color || 'inherit',
                fontStyle: activeDashboard.titleStyle?.fontStyle || 'normal',
                textDecoration: activeDashboard.titleStyle?.textDecoration || 'none',
                textAlign: activeDashboard.titleStyle?.textAlign || 'left',
              }}
              onClick={() => {
                setEditTitle(activeDashboard.name || t('dashboardMenu'));
                setIsEditingTitle(true);
                setTimeout(() => titleInputRef.current?.focus(), 0);
              }}
            >
              {activeDashboard.name || t('dashboardMenu')}
            </h1>
            <Popover>
              <PopoverTrigger>
                <div className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-zinc-100 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Type className="h-4 w-4 text-zinc-500" />
                </div>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-3" align="start">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-500">{t('fontSize') || 'Font Size'}</label>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => handleStyleChange('fontSize', '1.25rem')}>S</Button>
                      <Button variant="outline" size="sm" onClick={() => handleStyleChange('fontSize', '1.5rem')}>M</Button>
                      <Button variant="outline" size="sm" onClick={() => handleStyleChange('fontSize', '1.875rem')}>L</Button>
                      <Button variant="outline" size="sm" onClick={() => handleStyleChange('fontSize', '2.25rem')}>XL</Button>
                    </div>
                  </div>
                  
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-500">{t('textStyle') || 'Text Style'}</label>
                    <div className="flex items-center gap-2">
                      <Button 
                        variant={activeDashboard.titleStyle?.fontWeight === 'normal' ? 'default' : 'outline'} 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => handleStyleChange('fontWeight', activeDashboard.titleStyle?.fontWeight === 'normal' ? '700' : 'normal')}
                      >
                        <Bold className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant={activeDashboard.titleStyle?.fontStyle === 'italic' ? 'default' : 'outline'} 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => handleStyleChange('fontStyle', activeDashboard.titleStyle?.fontStyle === 'italic' ? 'normal' : 'italic')}
                      >
                        <Italic className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant={activeDashboard.titleStyle?.textDecoration === 'underline' ? 'default' : 'outline'} 
                        size="icon" 
                        className="h-8 w-8"
                        onClick={() => handleStyleChange('textDecoration', activeDashboard.titleStyle?.textDecoration === 'underline' ? 'none' : 'underline')}
                      >
                        <Underline className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-xs font-medium text-zinc-500">{t('textColor') || 'Text Color'}</label>
                    <div className="flex items-center gap-2">
                      {['inherit', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'].map(color => (
                        <button
                          key={color}
                          className={`w-6 h-6 rounded-full border border-zinc-200 flex items-center justify-center ${activeDashboard.titleStyle?.color === color ? 'ring-2 ring-indigo-500 ring-offset-1' : ''}`}
                          style={{ backgroundColor: color === 'inherit' ? '#18181b' : color }}
                          onClick={() => handleStyleChange('color', color)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        )}
      </div>
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
        {charts.map((chart) => {
          const rows = chart.data as Record<string, unknown>[];
          const columns = Object.keys(rows[0] || {});
          const previewRows = chart.type === "table" ? rows.slice(0, TABLE_PREVIEW_LIMIT) : rows;
          const isTableTruncated = chart.type === "table" && rows.length > TABLE_PREVIEW_LIMIT;
          return (
          <div key={chart.id} className="relative group">
            <Card className="h-full flex flex-col shadow-sm border-muted">
              <CardHeader className="pb-2 shrink-0 flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">{chart.title}</CardTitle>
                  <CardDescription className="text-xs">
                    {chart.type === "table"
                      ? t('tableRowColDesc', { rowCount: rows.length, colCount: columns.length })
                      : `${chart.type.toUpperCase()} Chart`}
                  </CardDescription>
                </div>
                <Button 
                  variant="ghost" 
                  size="icon" 
                  className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => removeChart(chart.id, activeDashboard.id, currentProject.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-2">
                {(() => {
                  if (chart.type === "table") {
                    if (rows.length === 0) {
                      return (
                        <div className="h-full w-full flex items-center justify-center text-xs text-zinc-500">
                          当前表格没有可展示数据
                        </div>
                      );
                    }
                    if (columns.length === 0) {
                      return (
                        <div className="h-full w-full flex items-center justify-center text-xs text-zinc-500">
                          当前表格数据缺少可展示字段
                        </div>
                      );
                    }
                    return (
                      <div className="h-full w-full flex flex-col gap-2">
                        <div className="text-[11px] text-zinc-500 px-1">
                          {isTableTruncated ? t('previewTableRows', { previewLimit: TABLE_PREVIEW_LIMIT, rowCount: rows.length, colCount: columns.length }) : t('totalTableRows', { rowCount: rows.length, colCount: columns.length })}
                        </div>
                        <ScrollArea className="flex-1 w-full border rounded-md">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                {columns.map((col) => <TableHead key={col}>{col}</TableHead>)}
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {previewRows.map((row, i) => (
                                <TableRow key={i}>
                                  {columns.map((col) => (
                                    <TableCell key={`${i}-${col}`}>{String(row[col] ?? "")}</TableCell>
                                  ))}
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </ScrollArea>
                      </div>
                    );
                  }
                  if (chart.chartSpec && rows.length > 0) {
                    return (
                      <div className="h-full w-full rounded-xl border border-zinc-100 p-2 overflow-hidden">
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
        )})}
      </ResponsiveGridLayout>
    </div>
  );
}
