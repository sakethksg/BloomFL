import Link from "next/link";
import { IconScan } from "@tabler/icons-react";

export const metadata = {
  title: "Detection - BloomFL",
  description: "Object detection and segmentation inference",
};

export default function DetectionLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40">
        <div className="flex h-16 items-center px-4 md:px-8 gap-6">
          <Link href="/detection/yolo" className="flex items-center gap-2 font-semibold hover:text-primary transition-colors">
            <IconScan className="size-5" />
            <span>Detection</span>
          </Link>
          <nav className="flex gap-4 text-sm">
            <Link 
              href="/detection/yolo" 
              className="px-3 py-2 rounded-lg hover:bg-muted transition-colors"
            >
              YOLO
            </Link>
            <Link 
              href="/detection/fastsam" 
              className="px-3 py-2 rounded-lg hover:bg-muted transition-colors"
            >
              FastSAM
            </Link>
          </nav>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1">
        {children}
      </main>
    </div>
  );
}
