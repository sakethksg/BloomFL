"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import Aurora from "@/components/ui/aurora";
import {
  IconNetwork,
  IconDatabase,
  IconShield,
  IconZoomIn,
  IconArrowRight,
  IconCheck,
  IconLock,
  IconChartBar,
} from "@tabler/icons-react";

export default function LandingPage() {
  const features = [
    {
      icon: IconNetwork,
      title: "Decentralized Network",
      description: "Peer-to-peer communication without central servers. Every node participates equally.",
    },
    {
      icon: IconDatabase,
      title: "Federated Learning",
      description: "Train models collaboratively while keeping raw data on-device.",
    },
    {
      icon: IconShield,
      title: "Secure by Design",
      description: "Cryptographic protocols and differential privacy ensure data integrity.",
    },
    {
      icon: IconZoomIn,
      title: "Real-time Monitoring",
      description: "Visualize network topology, training rounds, and metrics live.",
    },
  ];

  const benefits = [
    { icon: IconLock, text: "End-to-end encrypted communications" },
    { icon: IconNetwork, text: "No central point of failure" },
    { icon: IconChartBar, text: "Horizontal scalability" },
    { icon: IconShield, text: "Privacy-preserving analytics" },
  ];

  const stats = [
    { value: "P2P", label: "Architecture" },
    { value: "0 KB", label: "Data Leaves Your Infra" },
    { value: "E2E", label: "Encryption" },
  ];

  return (
    <>
      {/* Aurora Background */}
      <div className="fixed inset-0 -z-10 pointer-events-none">
        <Aurora
          colorStops={["#B7E4C7", "#74C69D", "#2D6A4F"]}
          blend={0.55}
          amplitude={1.1}
          speed={0.4}
        />
      </div>

      {/* Animated mesh gradient blobs */}
      <div className="fixed inset-0 -z-10 pointer-events-none overflow-hidden">
        <div className="aurora-blob aurora-blob-1" />
        <div className="aurora-blob aurora-blob-2" />
        <div className="aurora-blob aurora-blob-3" />
        <div className="aurora-blob aurora-blob-4" />
      </div>

      {/* Hero Section */}
      <section className="relative min-h-[92vh] flex flex-col justify-center px-4 lg:px-8 pt-16">
        <div className="mx-auto max-w-5xl w-full">
          <div className="text-center space-y-8">

            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-[#1B4332]/20 bg-[#FFFDF5]/60 backdrop-blur-sm text-sm font-medium text-[#1B4332]">
              <span className="size-1.5 rounded-full bg-[#10b981] animate-pulse" />
              Decentralized AI Infrastructure
            </div>

            {/* Headline */}
            <h1 className="text-6xl md:text-7xl lg:text-8xl font-bold tracking-tight leading-[1.05] text-[#1B4332]">
              Build Smarter,{" "}
              <br />
              <span className="bg-gradient-to-r from-[#10b981] via-[#34d399] to-[#74C69D] bg-clip-text text-transparent">
                Train Together.
              </span>
            </h1>

            {/* Subtitle */}
            <p className="text-xl text-[#1B4332]/70 max-w-2xl mx-auto leading-relaxed font-light">
              BloomFL enables organizations to collaboratively train machine learning models
              while keeping data decentralized, secure, and private.
              No data leaves your infrastructure.
            </p>

            {/* CTA row */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
              <Link href="/dashboard">
                <Button
                  size="lg"
                  className="gap-2 bg-[#1B4332] hover:bg-[#1B4332]/90 text-white rounded-xl px-8 text-base shadow-xl shadow-[#1B4332]/20"
                >
                  Enter Dashboard
                  <IconArrowRight className="size-4" />
                </Button>
              </Link>
              <Button
                size="lg"
                variant="outline"
                className="rounded-xl px-8 text-base border-[#1B4332]/30 text-[#1B4332] hover:bg-[#1B4332]/5 bg-[#FFFDF5]/40 backdrop-blur-sm"
              >
                View Documentation
              </Button>
            </div>

            {/* Stats row */}
            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-6">
              {stats.map((s, i) => (
                <div
                  key={i}
                  className="flex flex-col items-center gap-1 px-10 py-4 rounded-2xl bg-[#FFFDF5]/50 backdrop-blur-sm border border-[#1B4332]/10"
                >
                  <span className="text-2xl font-bold text-[#1B4332]">{s.value}</span>
                  <span className="text-xs text-[#1B4332]/50 uppercase tracking-widest">{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="relative py-32 px-4 lg:px-8 scroll-mt-20">
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-16 space-y-3">
            <p className="text-sm font-semibold uppercase tracking-widest text-[#10b981]">Capabilities</p>
            <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-[#1B4332]">Powerful Features</h2>
            <p className="text-[#1B4332]/60 max-w-xl mx-auto">
              Everything you need for enterprise-grade distributed machine learning
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <div
                  key={feature.title}
                  className="group relative p-6 rounded-3xl border border-[#1B4332]/10 bg-[#FFFDF5]/40 backdrop-blur-md hover:bg-[#FFFDF5]/60 hover:border-[#10b981]/30 hover:shadow-xl hover:shadow-[#10b981]/10 transition-all duration-300 cursor-pointer"
                >
                  <div className="size-12 rounded-2xl bg-gradient-to-br from-[#10b981]/20 to-[#74C69D]/20 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                    <Icon className="size-5 text-[#1B4332]" />
                  </div>
                  <h3 className="font-semibold text-[#1B4332] mb-2">{feature.title}</h3>
                  <p className="text-sm text-[#1B4332]/60 leading-relaxed">{feature.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section id="benefits" className="relative py-32 px-4 lg:px-8 scroll-mt-20">
        <div className="mx-auto max-w-5xl">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div className="space-y-6">
              <p className="text-sm font-semibold uppercase tracking-widest text-[#10b981]">Why BloomFL</p>
              <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-[#1B4332] leading-tight">
                Enterprise-grade<br />privacy from day one.
              </h2>
              <p className="text-[#1B4332]/60 leading-relaxed">
                Built for organizations that cannot afford to compromise on security or performance.
                BloomFL brings the full power of federated learning with zero operational overhead.
              </p>
              <Link href="/dashboard">
                <Button className="mt-2 gap-2 bg-[#1B4332] hover:bg-[#1B4332]/90 text-white rounded-xl">
                  Start for free
                  <IconArrowRight className="size-4" />
                </Button>
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {benefits.map((b) => (
                <div
                  key={b.text}
                  className="flex items-center gap-4 p-5 rounded-2xl border border-[#1B4332]/10 bg-[#FFFDF5]/40 backdrop-blur-sm hover:bg-[#FFFDF5]/60 hover:border-[#10b981]/30 transition-all duration-200"
                >
                  <div className="size-9 rounded-xl bg-gradient-to-br from-[#10b981]/20 to-[#74C69D]/20 flex items-center justify-center shrink-0">
                    <IconCheck className="size-4 text-[#10b981]" />
                  </div>
                  <span className="font-medium text-[#1B4332]">{b.text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="cta" className="relative py-32 px-4 lg:px-8 scroll-mt-20">
        <div className="mx-auto max-w-4xl">
          <div className="relative overflow-hidden rounded-3xl bg-[#1B4332] px-8 py-20 text-center shadow-2xl shadow-[#1B4332]/30">
            <div className="absolute inset-0 bg-gradient-to-br from-[#10b981]/20 to-transparent pointer-events-none" />
            <div className="absolute -top-20 -right-20 w-64 h-64 rounded-full bg-[#74C69D]/10 blur-3xl pointer-events-none" />
            <div className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full bg-[#10b981]/10 blur-3xl pointer-events-none" />
            <div className="relative space-y-6">
              <p className="text-sm font-semibold uppercase tracking-widest text-[#74C69D]">Get started today</p>
              <h2 className="text-4xl md:text-5xl font-bold text-white leading-tight">
                Ready to deploy BloomFL?
              </h2>
              <p className="text-white/60 max-w-lg mx-auto">
                Start federated learning in minutes. No vendor lock-in. Full control over your data.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 justify-center pt-2">
                <Link href="/dashboard">
                  <Button
                    size="lg"
                    className="gap-2 bg-[#10b981] hover:bg-[#10b981]/90 text-white rounded-xl px-8 shadow-lg shadow-[#10b981]/30"
                  >
                    Launch Dashboard
                    <IconArrowRight className="size-4" />
                  </Button>
                </Link>
                <Link href="https://github.com/sakethksg/BloomFL" target="_blank" rel="noopener noreferrer">
                  <Button
                    size="lg"
                    variant="outline"
                    className="rounded-xl px-8 border-white/20 text-white hover:bg-white/10 bg-transparent"
                  >
                    View on GitHub
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-[#1B4332]/10 bg-[#FFFDF5]/30 backdrop-blur-sm py-16 px-4 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-10">
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-[#1B4332] flex items-center justify-center text-white font-bold text-sm">
                  B
                </div>
                <span className="font-bold text-[#1B4332]">BloomFL</span>
              </div>
              <p className="text-sm text-[#1B4332]/50 leading-relaxed">
                Decentralized federated<br />learning infrastructure.
              </p>
            </div>

            {[
              { title: "Product", links: ["Features", "Pricing", "Security"] },
              { title: "Resources", links: ["Documentation", "Blog", "Community"] },
              { title: "Company", links: ["About", "Contact", "Privacy"] },
            ].map((section) => (
              <div key={section.title} className="space-y-4">
                <h4 className="font-semibold text-sm text-[#1B4332]">{section.title}</h4>
                <ul className="space-y-2">
                  {section.links.map((link) => (
                    <li key={link}>
                      <a href="#" className="text-sm text-[#1B4332]/50 hover:text-[#1B4332] transition-colors">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-[#1B4332]/10 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-[#1B4332]/40">© 2026 BloomFL. All rights reserved.</p>
            <div className="flex gap-6">
              {["Twitter", "GitHub", "Discord"].map((s) => (
                <a key={s} href="#" className="text-sm text-[#1B4332]/40 hover:text-[#1B4332] transition-colors">{s}</a>
              ))}
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
