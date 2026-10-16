"use client";
import AiSettingsPanel from "@/components/AiSettingsPanel";
import { PageHeader } from "@/components/ui";
export default function AiConnectionPage() {
  return <div className="page-shell p-4 lg:p-6 space-y-5 max-w-5xl mx-auto">
    <PageHeader title="AI connection" crumb="CONNECTIONS / AI" description="Provider credentials and current free-model availability, separate from chart analysis." />
    <AiSettingsPanel />
    <p className="text-xs text-mut">Keys and provider budgets belong to the operator and are shared across workspaces. AI display and strategy preferences belong to the selected workspace. No paid fallback. NVIDIA catalogs without pricing cannot establish free eligibility.</p>
  </div>;
}
