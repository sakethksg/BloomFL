import { ReactNode } from "react";
import { LandingNavbar } from "@/components/landing-navbar";

export default function LandingLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <div className="relative min-h-screen bg-background">
      <LandingNavbar />
      {children}
    </div>
  );
}
