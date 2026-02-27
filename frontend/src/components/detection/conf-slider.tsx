import { IconSettings2 } from "@tabler/icons-react";
import { Badge } from "@/components/ui/badge";

export function ConfSlider({ 
  value, 
  onChange,
  label = "Confidence",
}: { 
  value: number; 
  onChange: (v: number) => void;
  label?: string;
}) {
  return (
    <div className="w-full space-y-4">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          <IconSettings2 className="size-4 text-muted-foreground" />
          {label}
        </label>
        <Badge variant="secondary" className="font-mono">{Math.round(value * 100)}%</Badge>
      </div>
      <input
        type="range"
        min={0.01}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
      />
    </div>
  );
}
