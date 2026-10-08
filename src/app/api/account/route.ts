import { getAccountState } from "@/lib/account";
import { exchangeAccountConfigured } from "@/lib/credentials";
import { flags } from "@/lib/flags";
import { getSettings } from "@/lib/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const [account, settings, exchangeConfigured] = await Promise.all([
      getAccountState(),
      getSettings(),
      exchangeAccountConfigured(),
    ]);
    return Response.json({
      account,
      mode: settings.mode,
      liveArmed: settings.liveArmed,
      exchangeAccountConfigured: exchangeConfigured,
      paperTradingEnabled: flags.paperTrading(),
    });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Account data unavailable" },
      { status: 500 }
    );
  }
}
