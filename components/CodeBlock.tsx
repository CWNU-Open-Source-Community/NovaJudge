'use client'; // 必须标记为客户端组件

import { useState } from 'react';
import { ClipboardDocumentIcon, CheckIcon } from '@heroicons/react/24/outline';
import { toast } from "sonner";
import { useLanguage } from "@/context/LanguageContext";

interface CodeBlockProps {
  code: string;
}

export default function CodeBlock({ code }: CodeBlockProps) {
  const { dict } = useLanguage();
  const [copied, setCopied] = useState(false);

  const copyToClipboard = async (text: string) => {
    // 1. 优先尝试使用现代 Clipboard API (仅在 HTTPS 或 localhost 下可用)
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (err) {
        console.warn("Clipboard API failed, trying fallback...", err);
      }
    }

    // 2. 回退方案：使用传统的 document.execCommand (兼容 HTTP 环境)
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      
      // 确保 textarea 不可见且不影响布局
      textArea.style.position = "fixed";
      textArea.style.left = "-9999px";
      textArea.style.top = "0";
      document.body.appendChild(textArea);
      
      textArea.focus();
      textArea.select();
      
      const successful = document.execCommand("copy");
      document.body.removeChild(textArea);
      
      return successful;
    } catch (err) {
      console.error("Fallback copy failed:", err);
      return false;
    }
  };

  const handleCopy = async () => {
    const success = await copyToClipboard(code);
    
    if (success) {
      setCopied(true);
      toast.success(dict.common.copied);
      
      // 2秒后恢复图标状态
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } else {
      toast.error(dict.common.copyFailed);
    }
  };

  return (
    <div className="relative group">
      {/* 复制按钮：
         - 默认透明或浅色
         - group-hover:block 可以实现只有鼠标悬停时才显示按钮（可选，这里我做成了常驻但半透明）
      */}
      <button
        onClick={handleCopy}
        className="absolute top-2 right-2 p-1.5 rounded-md bg-white border border-gray-200 shadow-sm text-gray-500 hover:text-blue-600 hover:border-blue-300 transition-all duration-200 z-10 cursor-pointer"
        title={dict.common.copyCode}
      >
        {copied ? (
          <CheckIcon className="w-4 h-4 text-green-600" />
        ) : (
          <ClipboardDocumentIcon className="w-4 h-4" />
        )}
      </button>

      {/* 代码显示区域 - 保持你喜欢的样式 */}
      <pre className="block bg-[#f5f5f5] p-3 rounded-sm border border-gray-300 text-gray-800 font-mono text-sm overflow-x-auto whitespace-pre pr-10">
        {code}
      </pre>
    </div>
  );
}