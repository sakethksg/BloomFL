"use client";

import { useCallback, useRef, useState } from "react";
import { IconUpload } from "@tabler/icons-react";

export function DropZone({ 
  onFile, 
  disabled, 
  compact = false 
}: { 
  onFile: (f: File) => void; 
  disabled?: boolean; 
  compact?: boolean 
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const f = e.dataTransfer.files[0];
      if (f && f.type.startsWith("image/")) onFile(f);
    },
    [onFile]
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`
        relative overflow-hidden group flex flex-col items-center justify-center transition-all cursor-pointer select-none
        border-2 border-dashed rounded-2xl
        ${dragging ? "border-primary bg-primary/5 scale-[1.02]" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/30"}
        ${disabled ? "opacity-50 cursor-not-allowed hover:scale-100" : ""}
        ${compact ? "p-8 py-10" : "p-12 py-20"}
      `}
    >
      <div className={`rounded-full flex items-center justify-center bg-background shadow-sm border mb-4 transition-transform group-hover:-translate-y-1 ${compact ? "size-12" : "size-16"}`}>
        <IconUpload className={`text-muted-foreground group-hover:text-primary transition-colors ${compact ? "size-5" : "size-7"}`} />
      </div>
      <div className="text-center space-y-1 relative z-10">
        <p className={`${compact ? "text-sm" : "text-base"} font-semibold text-foreground`}>
          Click or drag image to upload
        </p>
        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP up to 10MB</p>
      </div>
      <input
        ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) { onFile(f); e.target.value = ""; } }}
      />
    </div>
  );
}
