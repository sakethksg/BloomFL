"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  IconNetwork,
  IconDatabase,
  IconShield,
  IconZoomIn,
  IconArrowRight,
  IconCheck,
} from "@tabler/icons-react";

export default function LandingPage() {
  const features = [
    {
      icon: IconNetwork,
      title: "Decentralized Network",
      description: "Peer-to-peer communication without central servers",
    },
    {
      icon: IconDatabase,
      title: "Federated Learning",
      description: "Train models while preserving data privacy",
    },
    {
      icon: IconShield,
      title: "Secure by Design",
      description: "Cryptographic protocols ensure data integrity",
    },
    {
      icon: IconZoomIn,
      title: "Real-time Monitoring",
      description: "Visualize network topology and metrics live",
    },
  ];

  const benefits = [
    "End-to-end encrypted communications",
    "No central point of failure",
    "Horizontal scalability",
    "Privacy-preserving analytics",
  ];

  return (
    <>
      {/* Background Effects */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        {/* Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-background via-background to-primary/5" />

          <div className="absolute top-0 right-0 w-96 h-96 bg-primary/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "0s" }} />
          <div className="absolute bottom-0 left-0 w-96 h-96 bg-accent/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "1.5s" }} />
          <div className="absolute top-1/4 left-1/2 w-72 h-72 bg-chart-2/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: "3s" }} />
      </div>

      {/* Hero Section */}
      <section className="relative pt-16 pb-24 px-4 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="text-center space-y-6 mb-12">
            <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold tracking-tight leading-tight">
              Decentralized{" "}
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Federated Learning
              </span>
            </h1>

            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              BloomFL enables organizations to collaboratively train machine learning models while keeping data decentralized, secure, and private. No data leaves your infrastructure.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center pt-6">
              <Link href="/dashboard">
                <Button size="lg" className="gap-2">
                  Enter Dashboard
                  <IconArrowRight className="size-4" />
                </Button>
              </Link>
              <Button size="lg" variant="outline">
                View Documentation
              </Button>
            </div>
          </div>

          {/* Hero Card with subtle border */}
          <div className="relative group">
            <div className="absolute inset-0 bg-gradient-to-r from-primary/20 to-accent/20 rounded-xl blur-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
            <Card className="border-2 border-border/50 relative backdrop-blur-sm">
              <CardContent className="pt-8">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                  {[
                    { label: "Nodes", value: "3+" },
                    { label: "Latency", value: "<100ms" },
                    { label: "Privacy", value: "100%" },
                    { label: "Uptime", value: "99.9%" },
                  ].map((stat) => (
                    <div key={stat.label} className="text-center">
                      <div className="text-2xl font-bold">{stat.value}</div>
                      <div className="text-xs text-muted-foreground">{stat.label}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section
        id="features"
        className="relative py-24 px-4 lg:px-8 bg-muted/20 scroll-mt-36"
      >
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-12 space-y-2">
            <h2 className="text-4xl font-bold tracking-tight">Powerful Features</h2>
            <p className="text-muted-foreground">
              Everything you need for distributed machine learning
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((feature) => {
              const Icon = feature.icon;
              return (
                <Card key={feature.title} className="border-border/60 hover:border-primary/50 hover:shadow-lg transition-all duration-300 group cursor-pointer">
                  <CardHeader>
                    <div className="size-12 rounded-lg bg-primary/10 flex items-center justify-center mb-3 group-hover:bg-primary/20 transition-colors">
                      <Icon className="size-6 text-primary" />
                    </div>
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <CardDescription className="text-sm">
                      {feature.description}
                    </CardDescription>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </section>

      {/* Benefits Section */}
      <section
        id="benefits"
        className="relative py-24 px-4 lg:px-8 bg-muted/40 scroll-mt-36"
      >
        <div className="mx-auto max-w-6xl">
          <div className="space-y-8">
            <div className="text-center space-y-2">
              <h2 className="text-4xl font-bold tracking-tight">Why Choose BloomFL?</h2>
              <p className="text-muted-foreground">
                Enterprise-grade federated learning infrastructure
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {benefits.map((benefit) => (
                <div key={benefit} className="flex items-start gap-4 p-6 rounded-lg border border-border/40 hover:border-primary/50 hover:bg-card/50 transition-all duration-300">
                  <IconCheck className="size-6 text-primary shrink-0 mt-1" />
                  <span className="text-lg font-medium">{benefit}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section id="cta" className="relative py-24 px-4 lg:px-8 scroll-mt-36">
        <div className="mx-auto max-w-3xl">
          <Card className="border-2 border-primary/50 bg-gradient-to-br from-primary/5 to-accent/5 relative">
            <CardHeader className="text-center">
              <CardTitle className="text-3xl mb-2">Ready to get started?</CardTitle>
              <CardDescription className="text-base">
                Deploy BloomFL and start federated learning in minutes
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/dashboard">
                <Button size="lg" className="w-full sm:w-auto">
                  Launch Dashboard
                </Button>
              </Link>
              <Link href="https://github.com/sakethksg/BloomFL" target="_blank" rel="noopener noreferrer">
                <Button size="lg" variant="outline" className="w-full sm:w-auto">
                  View Docs
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="relative border-t border-border/40 bg-muted/20 py-16 px-4 lg:px-8">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <div className="size-8 rounded-lg bg-gradient-to-br from-primary to-primary/60 flex items-center justify-center text-white font-bold text-sm">
                  B
                </div>
                <span className="font-bold">BloomFL</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Decentralized federated learning infrastructure
              </p>
            </div>

            {[
              {
                title: "Product",
                links: ["Features", "Pricing", "Security"],
              },
              {
                title: "Resources",
                links: ["Documentation", "Blog", "Community"],
              },
              {
                title: "Company",
                links: ["About", "Contact", "Privacy"],
              },
            ].map((section) => (
              <div key={section.title} className="space-y-4">
                <h4 className="font-semibold text-sm">{section.title}</h4>
                <ul className="space-y-2">
                  {section.links.map((link) => (
                    <li key={link}>
                      <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                        {link}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          <div className="border-t border-border/40 pt-8 flex flex-col md:flex-row items-center justify-between">
            <p className="text-sm text-muted-foreground">
              © 2026 BloomFL. All rights reserved.
            </p>
            <div className="flex gap-6 mt-4 md:mt-0">
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Twitter
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                GitHub
              </a>
              <a href="#" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                Discord
              </a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}
