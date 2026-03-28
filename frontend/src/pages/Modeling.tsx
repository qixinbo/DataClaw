import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ReactFlow, Background, Controls, useNodesState, useEdgesState, MarkerType, type Node, type Edge, ConnectionLineType } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import dagre from "dagre";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Label } from "../components/ui/label";
import { ScrollArea } from "../components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { ArrowLeft, Table as TableIcon } from "lucide-react";
import { TableNode } from "../components/modeling/TableNode";

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

const dagreGraph = new dagre.graphlib.Graph();
dagreGraph.setDefaultEdgeLabel(() => ({}));

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  // If there are few or no edges, use grid layout to spread out nodes
  if (edges.length === 0 || edges.length < nodes.length * 0.3) {
    const COLUMNS = 4;
    const ROW_HEIGHT = 400; // Height per row including spacing
    const COL_WIDTH = 300;  // Width per column including spacing
    
    return {
      nodes: nodes.map((node, index) => {
        const col = index % COLUMNS;
        const row = Math.floor(index / COLUMNS);
        return {
          ...node,
          position: {
            x: col * COL_WIDTH,
            y: row * ROW_HEIGHT,
          },
        };
      }),
      edges,
    };
  }

  // Otherwise use Dagre for connected graphs
  dagreGraph.setGraph({ rankdir: 'TB', nodesep: 100, ranksep: 120 });

  nodes.forEach((node) => {
    // Estimating height based on column count
    const height = 50 + (node.data.columns as Column[]).length * 28;
    dagreGraph.setNode(node.id, { width: 240, height });
  });

  edges.forEach((edge) => {
    dagreGraph.setEdge(edge.source, edge.target);
  });

  dagre.layout(dagreGraph);

  const layoutedNodes = nodes.map((node) => {
    const nodeWithPosition = dagreGraph.node(node.id);
    return {
      ...node,
      position: {
        x: nodeWithPosition.x - 120, // center offset (width/2)
        y: nodeWithPosition.y - (nodeWithPosition.height / 2),
      },
    };
  });

  return { nodes: layoutedNodes, edges };
};

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

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const nodeTypes = useMemo(() => ({ table: TableNode }), []);

  // Save layout to localStorage when nodes change (dragged)
  const onNodeDragStop = useCallback(() => {
    if (nodes.length > 0) {
      const layoutData = nodes.map(n => ({ id: n.id, position: n.position }));
      localStorage.setItem(`er-layout-${id}`, JSON.stringify(layoutData));
    }
  }, [nodes, id]);

  useEffect(() => {
    fetchInitialData();
  }, [id]);

  useEffect(() => {
    if (step === 'view' && mdl) {
      // Try to load saved layout
      const savedLayoutStr = localStorage.getItem(`er-layout-${id}`);
      let savedPositions: Record<string, {x: number, y: number}> = {};
      
      if (savedLayoutStr) {
        try {
          const parsed = JSON.parse(savedLayoutStr);
          if (Array.isArray(parsed)) {
            parsed.forEach((item: any) => {
              if (item.id && item.position) {
                savedPositions[item.id] = item.position;
              }
            });
          }
        } catch (e) {
          console.error("Failed to parse saved layout", e);
        }
      }

      const initialNodes: Node[] = mdl.models.map((model) => ({
        id: model.name,
        type: 'table',
        position: savedPositions[model.name] || { x: 0, y: 0 },
        data: { 
          name: model.name, 
          columns: model.columns,
          onDetailClick: openModelDetail 
        },
      }));

      const initialEdges: Edge[] = mdl.relationships.map((rel, index) => {
        // Assuming rel.models has at least 2 elements
        if (rel.models.length < 2) return null;
        return {
          id: `e-${index}`,
          source: rel.models[0],
          target: rel.models[1],
          type: ConnectionLineType.SmoothStep,
          animated: false,
          label: rel.joinType,
          style: { stroke: '#94a3b8' },
          labelStyle: { fill: '#64748b', fontSize: 11 },
          markerEnd: {
            type: MarkerType.ArrowClosed,
            color: '#94a3b8',
          },
        };
      }).filter(Boolean) as Edge[];

      // Only run auto-layout if we don't have saved positions for most nodes
      // or if user explicitly requests it (future feature)
      const hasSavedLayout = Object.keys(savedPositions).length >= initialNodes.length * 0.5;
      
      if (hasSavedLayout) {
        setNodes(initialNodes);
        setEdges(initialEdges);
      } else {
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
          initialNodes,
          initialEdges
        );
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
      }
    }
  }, [step, mdl, id]);

  const handleAutoLayout = () => {
    if (!mdl) return;
    const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
      nodes,
      edges
    );
    setNodes([...layoutedNodes]);
    setEdges([...layoutedEdges]);
    // Clear saved layout to prefer auto layout
    localStorage.removeItem(`er-layout-${id}`);
  };

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
    <div className="flex flex-col h-full bg-muted/50">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 bg-background border-b">
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
            <Button variant="outline" onClick={handleAutoLayout}>
              Auto Layout
            </Button>
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
                            : "bg-background hover:bg-muted/50"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center space-x-3">
                            <input
                              type="checkbox"
                              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
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
                          <div className="mt-3 max-h-48 overflow-auto border rounded-md bg-background">
                            {schema[table].map((col) => (
                              <label
                                key={`${table}:${col.name}`}
                                className="flex items-center justify-between px-3 py-2 border-b last:border-b-0 cursor-pointer hover:bg-muted/50"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
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
                      className="flex items-center gap-2 px-3 py-2 text-sm rounded-md hover:bg-muted cursor-pointer"
                      onClick={() => openModelDetail(model.name)}
                    >
                      <TableIcon className="w-4 h-4 text-muted-foreground" />
                      <span className="truncate">{model.name}</span>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </Card>

            {/* Canvas Area (ReactFlow) */}
            <div className="flex-1 overflow-hidden bg-muted/50 rounded-lg border relative">
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStop={onNodeDragStop}
                nodeTypes={nodeTypes}
                fitView
                minZoom={0.1}
                maxZoom={1.5}
                attributionPosition="bottom-right"
              >
                <Background color="#cbd5e1" gap={20} size={1} />
                <Controls />
              </ReactFlow>
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
