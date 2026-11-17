import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { AuthProvider } from "@/context/AuthContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { Toaster } from "sonner";
import { getSiteConfig } from "@/lib/site-config";

export function generateMetadata(): Metadata {
  const site = getSiteConfig();
  return {
    title: { template: `%s | ${site.name}`, default: `${site.name} - ${site.description}` },
    description: site.description,
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Browser extensions can add attributes to <html> before hydration (e.g. vq-enabled).
  // Limit suppression to the root element; descendants still report mismatches.
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="font-sans antialiased overflow-x-hidden">
        <LanguageProvider>
          <AuthProvider>
            {children}
            <Toaster position="top-center" richColors />
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
