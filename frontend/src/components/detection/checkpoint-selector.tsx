import { CheckpointInfo } from "@/lib/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconAlertTriangle } from "@tabler/icons-react";

export function CheckpointSelector({
  checkpoints,
  selected,
  onToggle,
  onSelectAll,
  loading,
}: {
  checkpoints: CheckpointInfo[];
  selected: Set<string>;
  onToggle: (path: string) => void;
  onSelectAll: () => void;
  loading: boolean;
}) {
  if (loading) return <Skeleton className="h-[200px] w-full rounded-xl" />;
  if (!checkpoints.length) return (
    <div className="text-sm text-muted-foreground p-4 bg-muted/30 rounded-lg text-center border border-dashed">
      No checkpoints found.
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
          {selected.size} / {checkpoints.length} selected
        </span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs hover:bg-muted" onClick={onSelectAll}>
          {selected.size === checkpoints.length ? "Clear All" : "Select All"}
        </Button>
      </div>
      <div className="flex flex-col gap-1.5 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
        {checkpoints.map((ckpt) => (
          <label
            key={ckpt.path}
            className={`
              flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-all duration-200
              ${selected.has(ckpt.path) ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/30 hover:bg-muted/30"}
              ${!ckpt.exists ? "opacity-50 grayscale cursor-not-allowed" : ""}
            `}
          >
            <input
              type="checkbox"
              className="size-4 rounded border-muted accent-primary focus:ring-primary/20"
              checked={selected.has(ckpt.path)}
              disabled={!ckpt.exists}
              onChange={() => onToggle(ckpt.path)}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{ckpt.label}</p>
            </div>
            {ckpt.is_pretrained && <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">base</Badge>}
            {!ckpt.exists && <IconAlertTriangle className="size-4 text-destructive shrink-0" />}
          </label>
        ))}
      </div>
    </div>
  );
}
