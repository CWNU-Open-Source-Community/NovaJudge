import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { AuthProvider } from "@/context/AuthContext";
import { LanguageProvider } from "@/context/LanguageContext";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: {
    template: "%s | NovaJudge",
    default: "NovaJudge - XCPC Online Judge",
  },
  description: "High-performance Online Judge system",
};

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
