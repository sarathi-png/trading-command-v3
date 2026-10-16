"use client";
import { api } from "@/lib/api";
import { usePoll } from "@/lib/hooks";
export default function FreeModelCatalog({ provider, configured }: { provider: string; configured: boolean }) {
  const { data, loading, refresh } = usePoll(() => api.get<{ models: { id: string; name: string }[]; notice: string }>(`/api/ai/models?provider=${provider}`), 300000, { enabled: configured, deps: [provider, configured] });
  return <div className="text-[11px] space-y-2 rounded border border-edge p-3">
    <p className="font-medium">Automatic · verified free models only</p>
    <p className="text-mut">{!configured ? "Save an API key to discover this provider's current catalog." : loading ? "Checking current free-model availability…" : data?.notice ?? "Catalog unavailable; technical rules remain active."}</p>
    {!!data?.models.length && <details><summary className="cursor-pointer text-accent">{data.models.length} eligible models · ranked by compatibility</summary><ul className="max-h-40 overflow-auto mt-2 space-y-1">{data.models.map(m => <li key={m.id} className="break-all">{m.name}</li>)}</ul></details>}
    {configured && <button type="button" className="text-accent" onClick={refresh}>Check catalog</button>}
  </div>;
}
