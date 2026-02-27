/**
 * Shared detection utilities for YOLO and FastSAM pages
 */

export const formatCoords = (box: any): string => {
  // Handle x1, y1, x2, y2 format (current API response)
  if (typeof box.x1 === "number" && typeof box.y1 === "number" && 
      typeof box.x2 === "number" && typeof box.y2 === "number") {
    return `[${Math.round(box.x1)}, ${Math.round(box.y1)}, ${Math.round(box.x2)}, ${Math.round(box.y2)}]`;
  }
  // Handle bbox array format
  if (box.bbox && Array.isArray(box.bbox)) {
    return `[${box.bbox.map((v: number) => Math.round(v)).join(", ")}]`;
  }
  // Handle x, y, w, h format
  if (typeof box.x === "number") {
    return `[${Math.round(box.x)}, ${Math.round(box.y)}, ${Math.round(box.w)}, ${Math.round(box.h)}]`;
  }
  return "N/A";
};

export const getDetectionTypeLabel = (type: "yolo" | "fastsam" | "unknown"): string => {
  const labels: Record<string, string> = {
    yolo: "YOLO Object Detection",
    fastsam: "FastSAM Segmentation",
    unknown: "Unknown",
  };
  return labels[type] || type;
};

export const getDetectionTypeDescription = (type: "yolo" | "fastsam"): string => {
  const descriptions: Record<string, string> = {
    yolo: "Real-time object detection using YOLO models",
    fastsam: "Fast segmentation of anything using FastSAM",
  };
  return descriptions[type] || "";
};
