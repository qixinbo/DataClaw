import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table as TableIcon } from "lucide-react";

interface Column {
  name: string;
  type: string;
  properties?: {
    is_primary_key?: boolean;
    is_foreign_key?: boolean;
  };
}

interface TableNodeData {
  name: string;
  columns: Column[];
  onDetailClick: (name: string) => void;
}

export const TableNode = memo(({ data }: { data: TableNodeData }) => {
  return (
    <Card className="min-w-[220px] max-w-[280px] shadow-md border-t-4 border-t-blue-500 text-xs bg-background">
      <Handle type="target" position={Position.Top} className="!bg-blue-500" />
      
      <CardHeader 
        className="py-2 px-3 bg-muted/50 border-b flex flex-row items-center justify-between cursor-pointer hover:bg-muted"
        onClick={() => data.onDetailClick(data.name)}
      >
        <div className="font-semibold flex items-center gap-2 truncate" title={data.name}>
          <TableIcon className="w-3 h-3 text-blue-500 shrink-0" />
          <span className="truncate">{data.name}</span>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div className="max-h-[250px] overflow-y-auto">
          <table className="w-full text-left border-collapse">
            <tbody>
              {data.columns.map((col) => {
                const isPk = col.properties?.is_primary_key;
                const isFk = col.properties?.is_foreign_key;
                let keyText = "";
                if (isPk && isFk) keyText = "PK, FK";
                else if (isPk) keyText = "PK";
                else if (isFk) keyText = "FK";

                // Simplify type display, e.g., INTEGER -> int, CHARACTER VARYING -> string
                let displayType = (col.type || "string").toLowerCase();
                if (displayType.includes("int")) displayType = "int";
                else if (displayType.includes("char") || displayType.includes("text")) displayType = "string";
                else if (displayType.includes("time") || displayType.includes("date")) displayType = "date";
                else if (displayType.includes("bool")) displayType = "boolean";
                else if (displayType.includes("float") || displayType.includes("double") || displayType.includes("numeric") || displayType.includes("decimal")) displayType = "float";

                return (
                  <tr 
                    key={col.name} 
                    className="border-b last:border-0 hover:bg-muted/50"
                    title={`${col.name} (${col.type})`}
                  >
                    <td className="py-1.5 px-3 w-16 text-muted-foreground font-mono truncate border-r border-border">{displayType}</td>
                    <td className="py-1.5 px-3 font-medium truncate text-foreground">{col.name}</td>
                    <td className="py-1.5 px-3 w-10 text-center text-muted-foreground font-semibold text-[10px] border-l border-border">
                      {keyText}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
      
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500" />
    </Card>
  );
});
