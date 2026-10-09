import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";

import { Nav } from "@/components/nav";
import { getProvider } from "@/lib/llm";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "TCF Coach",
  description: "Adaptive TCF Canada French practice with a persistent learner model.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Rendered per request so the mode badge reflects the runtime environment, not the build.
  await connection();
  const provider = getProvider();
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <Nav mode={provider.name === "mock" ? "mock" : "live"} model={provider.model} />
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
