import { getResearch } from "@/lib/research/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 10;

export async function GET() {
  const research = await getResearch();
  return Response.json(research, {
    headers: { "cache-control": "private, max-age=60" },
  });
}
