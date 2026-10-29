import Navbar from "@/components/Navbar";
import Link from "next/link";
import { isCliEnabled } from "@/lib/cli-deployment";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      {/* 主内容区域 */}
      <main className="flex justify-center w-full max-w-full mx-auto p-4 sm:p-6 lg:p-8 bg-zinc-100">
        {children}
      </main>

      {/* 底部 Footer */}
      <footer className="bg-white border-t border-gray-200">
        <div className="max-w-7xl mx-auto py-6 px-4 text-center">
          {isCliEnabled() && <Link
            href="/cli"
            className="inline-block mb-3 text-xs text-blue-600 hover:underline"
          >
            安装 submit 命令行（Windows / macOS）
          </Link>}
          <p className="text-gray-500 text-xs">
            Powered by{" "}
            <a
              className=" text-gray-800"
              href="https://github.com/pppolf/NovaJudge"
              target="_blank"
            >
              NovaJudge
            </a>{" "}
            Community © {new Date().getFullYear()}.
          </p>
        </div>
      </footer>
    </div>
  );
}
