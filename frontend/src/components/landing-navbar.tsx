"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { IconMenu2, IconX } from "@tabler/icons-react";

const navLinks = [
  { href: "#features", label: "Features" },
  { href: "#benefits", label: "Benefits" },
  { href: "#cta", label: "Get Started" },
];

export function LandingNavbar() {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header
      className="fixed inset-x-0 top-0 z-50 bg-[#FFFDF5]/60 backdrop-blur-md border-b border-[#1B4332]/10 shadow-sm"
    >
      <div className="mx-auto max-w-7xl px-4 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-2 group">
            <div className="size-8 rounded-lg bg-[#1B4332] flex items-center justify-center text-white font-bold text-sm group-hover:shadow-lg transition-shadow">
              B
            </div>
            <span className="font-bold text-lg tracking-tight text-[#1B4332]">BloomFL</span>
          </Link>

          {/* Desktop nav links */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="px-4 py-2 rounded-md text-sm font-medium text-[#1B4332]/60 hover:text-[#1B4332] hover:bg-[#1B4332]/5 transition-colors"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Desktop CTA buttons */}
          <div className="hidden md:flex items-center gap-2">
            <Button asChild variant="ghost" size="sm" className="text-[#1B4332]/70 hover:text-[#1B4332]">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
            <Button asChild size="sm" className="bg-[#1B4332] hover:bg-[#1B4332]/90 text-white rounded-lg">
              <a href="#cta">Get Started</a>
            </Button>
          </div>

          {/* Mobile hamburger */}
          <button
            className="md:hidden p-2 rounded-md text-[#1B4332]/60 hover:text-[#1B4332] hover:bg-[#1B4332]/5 transition-colors"
            onClick={() => setMobileOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            {mobileOpen ? <IconX className="size-5" /> : <IconMenu2 className="size-5" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-[#1B4332]/10 bg-[#FFFDF5]/95 backdrop-blur-md px-4 pb-6 pt-4 space-y-1">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={() => setMobileOpen(false)}
              className="block px-4 py-3 rounded-md text-sm font-medium text-[#1B4332]/60 hover:text-[#1B4332] hover:bg-[#1B4332]/5 transition-colors"
            >
              {link.label}
            </a>
          ))}
          <div className="flex flex-col gap-3 pt-4">
            <Button asChild variant="outline" className="w-full">
              <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
                Dashboard
              </Link>
            </Button>
            <Button asChild className="w-full">
              <a href="#cta" onClick={() => setMobileOpen(false)}>
                Get Started
              </a>
            </Button>
          </div>
        </div>
      )}
    </header>
  );
}
