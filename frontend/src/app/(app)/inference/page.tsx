"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function InferencePageRedirect() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to new detection/yolo page
    router.replace("/detection/yolo");
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        <p className="text-muted-foreground">Redirecting to YOLO Detection...</p>
      </div>
    </div>
  );
}
