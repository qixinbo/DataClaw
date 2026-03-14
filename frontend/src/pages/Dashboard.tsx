import { useMemo } from 'react';
import { Responsive } from 'react-grid-layout';
import WidthProvider from 'react-grid-layout';
import { useDashboardStore } from '../store/dashboardStore';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

export function Dashboard() {
  const { charts, removeChart } = useDashboardStore();
  const ResponsiveGridLayout = useMemo(() => WidthProvider(Responsive as any) as any, []);

  const layouts = useMemo(() => ({
    lg: charts.map((c) => c.layout)
  }), [charts]);

  const onLayoutChange = (_currentLayout: any, _allLayouts: any) => {
    // updateLayout(currentLayout); // This might cause infinite loops if not handled carefully
    // For simplicity, we just log it or update it if needed.
    // In a real app, we would debounce this and save to backend.
  };

  if (charts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <p>No charts in dashboard.</p>
        <p className="text-sm">Go to Chat and add some visualizations!</p>
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
                  onClick={() => removeChart(chart.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </CardHeader>
              <CardContent className="flex-1 min-h-0 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  {chart.type === 'bar' ? (
                    <BarChart data={chart.data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <Tooltip 
                        cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Bar dataKey="sales" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Sales" />
                      <Bar dataKey="profit" fill="#10b981" radius={[4, 4, 0, 0]} name="Profit" />
                    </BarChart>
                  ) : (
                    <LineChart data={chart.data}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                      <XAxis dataKey="name" tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 10, fill: '#6b7280' }} />
                      <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                      />
                      <Line type="monotone" dataKey="sales" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} />
                      <Line type="monotone" dataKey="profit" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} />
                    </LineChart>
                  )}
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        ))}
      </ResponsiveGridLayout>
    </div>
  );
}
