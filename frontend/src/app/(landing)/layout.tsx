import { ReactNode } from "react";

export default function LandingLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <div className="relative min-h-screen bg-background">
      {children}
    </div>
  );
}
