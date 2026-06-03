"use client";

import { useState } from "react";

import { LeadFinderForm } from "@/components/lead-finder-form";
import { OutreachContactsTab } from "@/components/outreach-contacts-tab";
import { OutreachProvider } from "@/components/outreach-provider";

type AppTab = "find" | "outreach";

const TABS: { id: AppTab; label: string }[] = [
  { id: "find", label: "Find leads" },
  { id: "outreach", label: "Outreach" },
];

export function AppShell() {
  const [activeTab, setActiveTab] = useState<AppTab>("find");

  return (
    <OutreachProvider>
      <div className="flex flex-col gap-8">
        <nav
          role="tablist"
          aria-label="SiteSearch sections"
          className="flex flex-wrap gap-2 border-b border-neutral-200 pb-1 dark:border-neutral-800"
        >
          {TABS.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={`relative px-4 py-2.5 text-sm font-semibold transition ${
                  selected
                    ? "text-neutral-950 dark:text-neutral-50"
                    : "text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200"
                }`}
              >
                {tab.label}
                {selected ? (
                  <span className="absolute inset-x-2 -bottom-[5px] h-0.5 rounded-full bg-neutral-950 dark:bg-neutral-50" />
                ) : null}
              </button>
            );
          })}
        </nav>

        <div role="tabpanel">
          {activeTab === "find" ? <LeadFinderForm /> : <OutreachContactsTab />}
        </div>
      </div>
    </OutreachProvider>
  );
}
