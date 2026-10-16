import { resolveKey } from "@/lib/ai/keys";
import { discoverFreeModels } from "@/lib/ai/models";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const provider = new URL(req.url).searchParams.get("provider");
  if (provider !== "openrouter" && provider !== "nvidia") return Response.json({ error: "Invalid provider" }, { status: 400 });
  const { key } = resolveKey(provider);
  if (!key) return Response.json({ models: [], notice: "Configure the provider API key first." });
  try {
    const models = await discoverFreeModels(provider, key);
    return Response.json({ models, notice: models.length ? "Automatic selection ranks verified zero-cost models by structured-output support and usable context. Limits apply to every attempt." : "This provider returned no verifiable zero-cost models. NVIDIA trial credits cannot be established from an unpriced catalog; technical rules remain active." });
  } catch { return Response.json({ models: [], notice: "Free-model discovery unavailable. No paid model will be used." }); }
}
