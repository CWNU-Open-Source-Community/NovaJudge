"use client";

import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { faFilter } from "@fortawesome/free-solid-svg-icons";
import type { BoardFilter } from "@/lib/domjudge-scoreboard";
import DomjudgeIcon from "./DomjudgeIcon";

export default function DomjudgeBoardFilter({ base, filters }: { base: string; filters: BoardFilter[] }) {
  if (!filters.length) return <div className="dj-filter-spacer" />;
  const filtered = filters.filter(filter => filter.selected.length).map(filter => filter.key);
  return <Popover className="dj-board-filter">
    <PopoverButton className="dj-filter-toggle">
      <DomjudgeIcon icon={faFilter} />{filtered.length ? `Filtered (${filtered.join(", ")})` : "Filter"}
    </PopoverButton>
    <PopoverPanel className="dj-filter-panel">
      <form method="get" action={base} role="search" aria-label="Filter scoreboard">
        <div className="dj-filter-fields">
          {filters.map(({ key, label, selected, options }) => <label key={key}>{label}
            <select name={key} multiple size={8} defaultValue={selected}>{options.map(option =>
              <option key={option.value} value={option.value}>{option.name}</option>
            )}</select>
          </label>)}
        </div>
        <button type="submit" className="dj-filter-apply">filter</button>
        <a className="dj-filter-clear" href={base}>clear</a>
      </form>
    </PopoverPanel>
  </Popover>;
}
