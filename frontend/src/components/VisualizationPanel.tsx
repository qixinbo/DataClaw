import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from 'recharts';
import { Code, Table as TableIcon, BarChart as ChartIcon, LineChart as LineChartIcon, Download, LayoutDashboard, Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useDashboardStore } from "@/store/dashboardStore";
import { useVisualizationStore } from "@/store/visualizationStore";

export function VisualizationPanel() {
  const [view, setView] = useState<'table' | 'chart'>('chart');
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');
  const { addChart } = useDashboardStore();
  const { currentData, currentSQL, isLoading, error } = useVisualizationStore();

  const handleAddToDashboard = () => {
    if (!currentData || !currentSQL) return;
    
    addChart({
      id: Date.now().toString(),
      title: 'Generated Analysis', // Could be dynamic based on query
      type: chartType,
      data: currentData,
      sql: currentSQL,
    });
    alert("Added to Dashboard!");
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
  const firstRow = objectRows[0] as Record<string, unknown>;
  const stringColumn = columns.find(col => typeof firstRow[col] === 'string') || columns[0];
  const numberColumns = columns.filter(col => typeof firstRow[col] === 'number');

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
           
           {view === 'chart' && (
             <div className="flex gap-1 mr-2 border-r pr-2">
               <Button variant={chartType === 'bar' ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => setChartType('bar')}>
                 <ChartIcon className="h-3.5 w-3.5" />
               </Button>
               <Button variant={chartType === 'line' ? 'secondary' : 'ghost'} size="icon" className="h-7 w-7" onClick={() => setChartType('line')}>
                 <LineChartIcon className="h-3.5 w-3.5" />
               </Button>
             </div>
           )}

          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleAddToDashboard}>
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
            <CardTitle>Analysis Result</CardTitle>
            <CardDescription>Generated from your query</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-4">
             {view === 'chart' ? (
                <div className="h-full w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    {chartType === 'bar' ? (
                      <BarChart data={objectRows} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey={stringColumn} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                        <Tooltip 
                          cursor={{ fill: 'rgba(0,0,0,0.05)' }}
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        {numberColumns.map((col, idx) => (
                             <Bar key={col} dataKey={col} fill={`hsl(${idx * 60 + 200}, 70%, 50%)`} radius={[4, 4, 0, 0]} name={col} />
                        ))}
                      </BarChart>
                    ) : (
                      <LineChart data={objectRows} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e7eb" />
                        <XAxis dataKey={stringColumn} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                        <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                        <Tooltip 
                          contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        {numberColumns.map((col, idx) => (
                             <Line key={col} type="monotone" dataKey={col} stroke={`hsl(${idx * 60 + 200}, 70%, 50%)`} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} name={col} />
                        ))}
                      </LineChart>
                    )}
                  </ResponsiveContainer>
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
    </div>
  );
}
