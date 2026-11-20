"use client";

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { EllipsisHorizontalIcon } from "@heroicons/react/24/outline";
import type { ReactNode } from "react";
import { useLanguage } from "@/context/LanguageContext";

export default function RankActions({ children }: { children: ReactNode }) {
  const { dict: { common } } = useLanguage();
  return <Popover className="group relative md:flex-1">
    <PopoverButton aria-label={common.actions} title={common.actions}
      className="flex size-9 items-center justify-center rounded border border-gray-300 text-gray-600 hover:bg-gray-100 md:hidden">
      <EllipsisHorizontalIcon className="size-5" />
    </PopoverButton>
    <PopoverPanel static className="absolute right-0 z-30 mt-1 hidden w-76 max-w-[calc(100vw-2rem)] flex-wrap items-center gap-2 rounded-md border border-gray-200 bg-white p-3 shadow-lg group-data-open:flex md:static md:mt-0 md:flex md:w-auto md:max-w-none md:border-0 md:p-0 md:shadow-none">
      {children}
    </PopoverPanel>
  </Popover>;
}
