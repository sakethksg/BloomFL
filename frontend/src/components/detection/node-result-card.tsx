import { NodeDetectionResult } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  IconAlertTriangle,
  IconLayersIntersect,
} from "@tabler/icons-react";
import { formatCoords } from "@/lib/detection";

export function NodeResultCard({ result }: { result: NodeDetectionResult }) {
  return (
    <Card className="overflow-hidden flex flex-col shadow-sm hover:shadow-md transition-shadow duration-300">
      <CardHeader className="p-4 border-b bg-muted/20">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0 space-y-1">
            <CardTitle className="text-sm font-semibold truncate flex items-center gap-2">
              <IconLayersIntersect className="size-4 text-primary" />
              {result.node_label}
            </CardTitle>
            <CardDescription className="truncate text-xs font-mono">{result.model_path}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            {result.error ? (
              <Badge variant="destructive" className="text-[10px] h-5">Failed</Badge>
            ) : result.person_count > 0 ? (
              <Badge className="bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 border-emerald-200 text-[10px] h-5">
                {result.person_count} Detections
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] h-5">No objects</Badge>
            )}
            <span className="text-[10px] text-muted-foreground font-mono">
              {result.inference_time_ms.toFixed(1)}ms
            </span>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0 flex-1 flex flex-col bg-muted/5">
        {result.error ? (
          <div className="p-4 m-4 rounded-lg bg-destructive/10 text-sm text-destructive font-medium border border-destructive/20 flex items-start gap-2">
             <IconAlertTriangle className="size-4 shrink-0 mt-0.5" />
             {result.error}
          </div>
        ) : (
          <div className="flex flex-col h-full">
            {result.annotated_jpeg_b64 && (
              <div className="p-4 pb-2 flex items-center justify-center bg-background border-b">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`data:image/jpeg;base64,${result.annotated_jpeg_b64}`}
                  alt={`Detection result for ${result.node_label}`}
                  className="w-full rounded-md object-contain max-h-[220px]"
                />
              </div>
            )}
            
            {result.boxes.length > 0 ? (
              <div className="overflow-auto max-h-[200px] custom-scrollbar">
                <Table>
                  <TableHeader className="bg-background sticky top-0 z-10 shadow-sm">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="text-xs font-medium h-8">Object</TableHead>
                      <TableHead className="text-xs font-medium h-8">Confidence</TableHead>
                      <TableHead className="text-xs font-medium h-8 text-right">Coordinates</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.boxes.map((box, i) => (
                      <TableRow key={i} className="h-8 hover:bg-muted/50">
                        <TableCell className="py-1 text-xs font-medium text-foreground">
                           {box.class_name || `Obj ${i + 1}`}
                        </TableCell>
                        <TableCell className="py-1 font-mono text-xs text-muted-foreground">
                          {(box.conf * 100).toFixed(1)}%
                        </TableCell>
                        <TableCell className="py-1 font-mono text-xs text-right text-muted-foreground">
                          {formatCoords(box)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center p-6 text-sm text-muted-foreground">
                No detections found.
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
