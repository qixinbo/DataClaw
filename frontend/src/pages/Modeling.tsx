import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ArrowLeft, Table as TableIcon, Network } from "lucide-react";

interface RawSchema {
  [table: string]: { name: string; type: string }[];
}

interface Column {
  name: string;
  type: string;
  isCalculated: boolean;
  relationship?: string;
  expression?: string;
  properties?: Record<string, unknown>;
}

interface Model {
  name: string;
  columns: Column[];
  primaryKey?: string;
  properties?: Record<string, any>;
}

interface Relationship {
  name: string;
  models: string[];
  joinType: string;
  condition: string;
}

interface MDLManifest {
  catalog: string;
  schema: string;
  dataSource: string;
  models: Model[];
  relationships: Relationship[];
}

interface ModelDetailResponse {
  model: {
    name: string;
    tableReference?: {
      table: string;
      schema?: string;
      catalog?: string;
    } | null;
    primaryKey?: string;
    properties?: Record<string, unknown>;
    columns: Column[];
  };
  relationships: {
    name: string;
    models: string[];
    joinType: string;
    condition: string;
    properties?: Record<string, unknown>;
  }[];
  preview_rows: Record<string, unknown>[];
}

export function Modeling() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [schema, setSchema] = useState<RawSchema | null>(null);
  const [mdl, setMdl] = useState<MDLManifest | null>(null);
  const [selectedTables, setSelectedTables] = useState<string[]>([]);
  const [selectedColumns, setSelectedColumns] = useState<Record<string, string[]>>({});
  const [expandedTables, setExpandedTables] = useState<Record<string, boolean>>({});
  const [step, setStep] = useState<"select" | "view">("select");
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [modelDetail, setModelDetail] = useState<ModelDetailResponse | null>(null);

  useEffect(() => {
    fetchInitialData();
  }, [id]);

  const initSelectionFromSchema = (schemaRes: RawSchema) => {
    const tableNames = Object.keys(schemaRes);
    const columnsMap: Record<string, string[]> = {};
    const expanded: Record<string, boolean> = {};
    for (const tableName of tableNames) {
      columnsMap[tableName] = schemaRes[tableName].map((c) => c.name);
      expanded[tableName] = true;
    }
    setSchema(schemaRes);
    setSelectedTables(tableNames);
    setSelectedColumns(columnsMap);
    setExpandedTables(expanded);
  };

  const fetchSchemaOnly = async () => {
    const schemaRes = await api.get(`/api/v1/semantic/${id}/schema`) as RawSchema;
    initSelectionFromSchema(schemaRes);
    setStep("select");
  };

  const fetchInitialData = async () => {
    try {
      setLoading(true);
      const mdlRes = await api.get(`/api/v1/semantic/${id}`) as any;
      if (mdlRes && mdlRes.models && mdlRes.models.length > 0) {
        setMdl(mdlRes as MDLManifest);
        setStep("view");
      } else {
        await fetchSchemaOnly();
      }
    } catch (error) {
      console.error("Failed to fetch modeling data:", error);
      try {
        await fetchSchemaOnly();
      } catch (e) {
        console.error("Failed to fetch schema:", e);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGenerate = async () => {
    try {
      setLoading(true);
      const res = await api.post(`/api/v1/semantic/${id}/generate`, {
        selected_tables: selectedTables,
        selected_columns: Object.fromEntries(
          selectedTables.map((table) => [table, selectedColumns[table] ?? []])
        ),
      }) as MDLManifest;
      setMdl(res);
      setStep("view");
    } catch (error) {
      console.error("Failed to generate MDL:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleTable = (table: string) => {
    setSelectedTables((prev) =>
      prev.includes(table) ? prev.filter((t) => t !== table) : [...prev, table]
    );
    if (!schema) return;
    if (!selectedTables.includes(table) && (!selectedColumns[table] || selectedColumns[table].length === 0)) {
      setSelectedColumns((prev) => ({
        ...prev,
        [table]: schema[table].map((c) => c.name),
      }));
    }
  };

  const toggleColumn = (table: string, column: string) => {
    setSelectedColumns((prev) => {
      const current = prev[table] ?? [];
      const has = current.includes(column);
      const next = has ? current.filter((c) => c !== column) : [...current, column];
      return { ...prev, [table]: next };
    });
    setSelectedTables((prev) => {
      const exists = prev.includes(table);
      const current = selectedColumns[table] ?? [];
      const has = current.includes(column);
      const nextLen = has ? current.length - 1 : current.length + 1;
      if (nextLen <= 0) {
        return prev.filter((t) => t !== table);
      }
      if (!exists) {
        return [...prev, table];
      }
      return prev;
    });
  };

  const toggleExpandTable = (table: string) => {
    setExpandedTables((prev) => ({ ...prev, [table]: !prev[table] }));
  };

  const handleSelectAll = () => {
    if (!schema) return;
    const tableNames = Object.keys(schema);
    setSelectedTables(tableNames);
    setSelectedColumns(
      Object.fromEntries(
        tableNames.map((table) => [table, schema[table].map((c) => c.name)])
      )
    );
  };

  const handleClearAll = () => {
    setSelectedTables([]);
    setSelectedColumns({});
  };

  const handleReselectTables = async () => {
    try {
      setLoading(true);
      await fetchSchemaOnly();
    } finally {
      setLoading(false);
    }
  };

  const openModelDetail = async (modelName: string) => {
    try {
      setDetailOpen(true);
      setDetailLoading(true);
      const detail = await api.get<ModelDetailResponse>(
        `/api/v1/semantic/${id}/models/${encodeURIComponent(modelName)}?limit=10`
      );
      setModelDetail(detail);
    } catch (error) {
      console.error("Failed to fetch model detail:", error);
      setModelDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-center">Loading modeling data...</div>;
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/datasources")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Data Modeling</h1>
            <p className="text-sm text-muted-foreground">
              DataSource ID: {id} • {step === "select" ? "Select Tables" : "Entity Relationship Diagram"}
            </p>
          </div>
        </div>
        {step === "view" && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleReselectTables}>
              Reselect Tables
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden p-6">
        {step === "select" ? (
          <div className="max-w-4xl mx-auto h-full flex flex-col">
            <Card className="flex-1 flex flex-col overflow-hidden">
              <CardHeader>
                <CardTitle>Select tables to create data models</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Choose the tables you want to include in your semantic model.
                </p>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div className="text-sm text-muted-foreground">
                    {selectedTables.length} / {schema ? Object.keys(schema).length : 0} selected
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleSelectAll}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearAll}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                
                <ScrollArea className="flex-1 border rounded-md p-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {schema && Object.keys(schema).map((table) => (
                      <div
                        key={table}
                        className={`p-3 rounded-lg border transition-colors ${
                          selectedTables.includes(table)
                            ? "bg-primary/5 border-primary"
                            : "bg-white hover:bg-gray-50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-3">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                              checked={selectedTables.includes(table)}
                              onChange={() => toggleTable(table)}
                            />
                            <Label className="cursor-pointer font-medium flex items-center gap-2">
                              <TableIcon className="w-4 h-4 text-muted-foreground" />
                              {table}
                            </Label>
                          </div>
                          <Button variant="ghost" size="sm" onClick={() => toggleExpandTable(table)}>
                            {expandedTables[table] ? "Hide Columns" : "Show Columns"}
                          </Button>
                        </div>
                        {expandedTables[table] && (
                          <div className="mt-3 max-h-48 overflow-auto border rounded-md bg-white">
                            {schema[table].map((col) => (
                              <label
                                key={`${table}:${col.name}`}
                                className="flex items-center justify-between px-3 py-2 border-b last:border-b-0 cursor-pointer hover:bg-gray-50"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                                    checked={(selectedColumns[table] ?? []).includes(col.name)}
                                    onChange={() => toggleColumn(table, col.name)}
                                  />
                                  <span className="text-sm truncate">{col.name}</span>
                                </div>
                                <span className="text-[10px] font-mono text-muted-foreground ml-2">{col.type}</span>
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </ScrollArea>
                
                <div className="pt-6 flex justify-end">
                  <Button onClick={handleGenerate} disabled={selectedTables.length === 0}>
                    Generate Model
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        ) : (
          <div className="h-full flex gap-6">
            {/* Sidebar List */}
            <Card className="w-64 flex flex-col h-full">
              <CardHeader className="py-4 px-4 border-b">
                <CardTitle className="text-sm font-medium">Models ({mdl?.models.length})</CardTitle>
              </CardHeader>
              <ScrollArea className="flex-1">
                <div className="p-2 space-y-1">
                  {mdl?.models.map((model) => (
                    <div
                      key={model.name}
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-gray-100 cursor-pointer"
                      onClick={() => openModelDetail(model.name)}
                    >
                      <TableIcon className="w-4 h-4 text-muted-foreground" />
                      <span className="truncate">{model.name}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </Card>

            {/* Canvas Area (Simulated) */}
            <div className="flex-1 overflow-auto bg-slate-100 rounded-lg border p-8 relative">
                <div className="absolute inset-0 pointer-events-none" 
                     style={{ 
                       backgroundImage: 'radial-gradient(#cbd5e1 1px, transparent 1px)', 
                       backgroundSize: '20px 20px' 
                     }} 
                />
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 relative z-10">
                  {mdl?.models.map((model) => (
                    <Card key={model.name} className="shadow-md border-t-4 border-t-blue-500 min-w-[240px] cursor-pointer" onClick={() => openModelDetail(model.name)}>
                      <CardHeader className="py-3 px-4 bg-gray-50 border-b flex flex-row items-center justify-between">
                        <div className="font-semibold text-sm flex items-center gap-2">
                            <TableIcon className="w-4 h-4 text-blue-500" />
                            {model.name}
                        </div>
                      </CardHeader>
                      <CardContent className="p-0">
                        <div className="max-h-[300px] overflow-y-auto text-xs">
                          {model.columns.map((col) => (
                            <div key={col.name} className="flex justify-between py-2 px-4 border-b last:border-0 hover:bg-gray-50">
                              <span className="font-medium">{col.name}</span>
                              <span className="text-muted-foreground font-mono text-[10px]">{col.type}</span>
                            </div>
                          ))}
                        </div>
                        {/* Show Relationships if any */}
                        {mdl.relationships.filter(r => r.models.includes(model.name)).length > 0 && (
                            <div className="bg-orange-50 p-2 border-t text-xs">
                                <div className="font-semibold text-orange-700 mb-1 flex items-center gap-1">
                                    <Network className="w-3 h-3" /> Relationships
                                </div>
                                {mdl.relationships
                                    .filter(r => r.models.includes(model.name))
                                    .map(r => {
                                        const other = r.models.find(m => m !== model.name);
                                        return (
                                            <div key={r.name} className="text-orange-600 truncate" title={`${r.joinType} with ${other}`}>
                                                ⟷ {other}
                                            </div>
                                        );
                                    })
                                }
                            </div>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
            </div>
          </div>
        )}
      </div>
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="sm:max-w-[1100px] max-h-[85vh] overflow-auto">
          <DialogHeader>
            <DialogTitle>{modelDetail?.model?.name ?? "Model Detail"}</DialogTitle>
          </DialogHeader>
          {detailLoading ? (
            <div className="py-8 text-center text-muted-foreground">Loading model detail...</div>
          ) : !modelDetail ? (
            <div className="py-8 text-center text-muted-foreground">No metadata available.</div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2">
                <div className="text-base font-semibold">Columns Metadata</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Description</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelDetail.model.columns.map((col) => (
                      <TableRow key={col.name}>
                        <TableCell>{col.name}</TableCell>
                        <TableCell>{col.type}</TableCell>
                        <TableCell>{String(col.properties?.description ?? "-")}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-2">
                <div className="text-base font-semibold">Relationships ({modelDetail.relationships.length})</div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Models</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Condition</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {modelDetail.relationships.map((rel) => (
                      <TableRow key={rel.name}>
                        <TableCell>{rel.name}</TableCell>
                        <TableCell>{rel.models.join(" ↔ ")}</TableCell>
                        <TableCell>{rel.joinType}</TableCell>
                        <TableCell>{rel.condition}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="space-y-2">
                <div className="text-base font-semibold">Data Preview (Top 10)</div>
                {modelDetail.preview_rows.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No preview data.</div>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {Object.keys(modelDetail.preview_rows[0]).map((key) => (
                          <TableHead key={key}>{key}</TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {modelDetail.preview_rows.map((row, idx) => (
                        <TableRow key={idx}>
                          {Object.keys(modelDetail.preview_rows[0]).map((key) => (
                            <TableCell key={key}>{String(row[key] ?? "")}</TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
