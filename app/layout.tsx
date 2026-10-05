import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";

import { clerkEnabled } from "@/lib/clerk";
import "./globals.css";
import "@/styles/_variables.scss";
import "@/styles/_keyframe-animations.scss";
import "@/styles/inara.scss";

// Same families as inara-next: Geist for the interface, Montserrat for lesson text.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const montserrat = Montserrat({
  variable: "--font-montserrat",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Inara Course Editor",
  description: "Build Inara courses: levels, modules and interactive lessons",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${montserrat.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Sign-in is optional (lib/clerk.ts): only with Clerk keys configured. */}
        {clerkEnabled ? <ClerkProvider>{children}</ClerkProvider> : children}
      </body>
    </html>
  );
}
