"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconMenu2, IconX } from "@tabler/icons-react";

const navLinks = [
  { href: "/docs", label: "Docs" },
  { href: "/features", label: "Features" },
  { href: "/about", label: "About" },
];

export function LandingNavbar() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 border-b border-border/40 backdrop-blur-xl bg-background/75 shadow-sm">
      <div className="mx-auto max-w-6xl px-4 lg:px-8 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="size-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white font-bold text-sm group-hover:shadow-lg transition-shadow">
              B
            </div>
            <span className="font-bold text-lg tracking-tight">BloomFL</span>
          </Link>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              >
                {link.label}
              </Link>
            ))}
          </div>

          {/* CTA Buttons */}
          <div className="flex items-center gap-2">
            <Link href="/dashboard" className="hidden sm:inline-block">
              <Button variant="ghost" size="sm" className="text-sm">
                Dashboard
              </Button>
            </Link>
            <Button size="sm" className="text-sm">
              Get Started
            </Button>

            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setIsOpen(!isOpen)}
              className="md:hidden p-2 rounded-md hover:bg-muted/50 transition-colors"
            >
              {isOpen ? (
                <IconX className="size-5" />
              ) : (
                <IconMenu2 className="size-5" />
              )}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {isOpen && (
          <div className="md:hidden border-t border-border/40 mt-4 pt-4 space-y-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="block px-4 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                onClick={() => setIsOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  );
}
