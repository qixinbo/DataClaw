import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Table as TableIcon } from "lucide-react";

interface Column {
  name: string;
  type: string;
}

interface TableNodeData {
  name: string;
  columns: Column[];
  onDetailClick: (name: string) => void;
}

export const TableNode = memo(({ data }: { data: TableNodeData }) => {
  return (
    <Card className="min-w-[180px] max-w-[240px] shadow-md border-t-4 border-t-blue-500 text-xs">
      <Handle type="target" position={Position.Top} className="!bg-blue-500" />
      
      <CardHeader 
        className="py-2 px-3 bg-gray-50 border-b flex flex-row items-center justify-between cursor-pointer hover:bg-gray-100"
        onClick={() => data.onDetailClick(data.name)}
      >
        <div className="font-semibold flex items-center gap-2 truncate" title={data.name}>
          <TableIcon className="w-3 h-3 text-blue-500 shrink-0" />
          <span className="truncate">{data.name}</span>
        </div>
      </CardHeader>
      
      <CardContent className="p-0">
        <div className="max-h-[200px] overflow-y-auto">
          {data.columns.map((col) => (
            <div 
              key={col.name} 
              className="py-1.5 px-3 border-b last:border-0 hover:bg-gray-50 flex items-center"
              title={`${col.name} (${col.type})`}
            >
              <span className="font-medium truncate">{col.name}</span>
              {/* 类型列已被隐藏 */}
            </div>
          ))}
        </div>
      </CardContent>
      
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500" />
    </Card>
  );
});
