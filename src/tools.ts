import { planRiskOrder } from "./risk.js";
import type {
  Mt5Api,
  OrderSide,
  PlaceOrderInput,
  ToolResult,
} from "./types.js";

export interface ToolContext {
  api: Mt5Api;
}

function ok(text: string): ToolResult {
  return { text };
}
function err(text: string): ToolResult {
  return { text, isError: true };
}

function asSide(v: unknown): OrderSide | undefined {
  if (v === "buy" || v === "sell") return v;
  return undefined;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export async function handleTool(
  name: string,
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  try {
    switch (name) {
      case "account_info":
        return await accountInfo(ctx);
      case "symbol_info":
        return await symbolInfo(args, ctx);
      case "get_positions":
        return await getPositions(args, ctx);
      case "place_market_order":
        return await placeMarketOrder(args, ctx);
      case "place_risk_order":
        return await placeRiskOrder(args, ctx);
      case "close_position":
        return await closePosition(args, ctx);
      case "modify_position":
        return await modifyPosition(args, ctx);
      default:
        return err(`Unknown tool: ${name}`);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return err(`${name} failed: ${msg}`);
  }
}

async function accountInfo(ctx: ToolContext): Promise<ToolResult> {
  const a = await ctx.api.accountInfo();
  return ok(
    [
      `login: ${a.login}`,
      `currency: ${a.currency}`,
      `balance: ${a.balance.toFixed(2)}`,
      `equity: ${a.equity.toFixed(2)}`,
      `margin: ${a.margin.toFixed(2)}`,
      `free_margin: ${a.free_margin.toFixed(2)}`,
      `leverage: 1:${a.leverage}`,
    ].join("\n"),
  );
}

async function symbolInfo(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const symbol = asString(args.symbol);
  if (!symbol) return err("symbol is required");
  const s = await ctx.api.symbolInfo(symbol);
  return ok(JSON.stringify(s, null, 2));
}

async function getPositions(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const symbol = asString(args.symbol);
  const positions = await ctx.api.positions(symbol);
  if (positions.length === 0) {
    return ok(symbol ? `No open positions on ${symbol}.` : "No open positions.");
  }
  const lines = positions.map(
    (p) =>
      `#${p.ticket} ${p.side.toUpperCase()} ${p.volume} ${p.symbol} @ ${p.price_open} sl=${p.sl} tp=${p.tp} pnl=${p.profit.toFixed(2)}`,
  );
  return ok(lines.join("\n"));
}

async function placeMarketOrder(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const symbol = asString(args.symbol);
  const side = asSide(args.side);
  const volume = asNumber(args.volume);
  if (!symbol) return err("symbol is required");
  if (!side) return err("side must be 'buy' or 'sell'");
  if (!volume || volume <= 0) return err("volume must be > 0");

  const input: PlaceOrderInput = {
    symbol,
    side,
    volume,
    sl: asNumber(args.sl),
    tp: asNumber(args.tp),
    comment: asString(args.comment),
  };
  const r = await ctx.api.placeOrder(input);
  return ok(
    `Placed ${r.side.toUpperCase()} ${r.volume} ${r.symbol} @ ${r.price} (ticket #${r.ticket}, sl=${r.sl}, tp=${r.tp}).`,
  );
}

async function placeRiskOrder(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const symbol = asString(args.symbol);
  const side = asSide(args.side);
  const stop_loss_pips = asNumber(args.stop_loss_pips);
  const risk_reward_ratio = asNumber(args.risk_reward_ratio);
  const risk_percent = asNumber(args.risk_percent);
  if (!symbol) return err("symbol is required");
  if (!side) return err("side must be 'buy' or 'sell'");
  if (stop_loss_pips === undefined) return err("stop_loss_pips is required");
  if (risk_reward_ratio === undefined) return err("risk_reward_ratio is required");
  if (risk_percent === undefined) return err("risk_percent is required");

  const [account, sym] = await Promise.all([
    ctx.api.accountInfo(),
    ctx.api.symbolInfo(symbol),
  ]);

  const plan = planRiskOrder({
    account,
    symbol: sym,
    side,
    stop_loss_pips,
    risk_reward_ratio,
    risk_percent,
  });

  const dryRun = args.dry_run === true;
  const planText = [
    `Plan: ${plan.side.toUpperCase()} ${plan.volume} ${plan.symbol} @ ${plan.entry}`,
    `  sl=${plan.sl} tp=${plan.tp}`,
    `  risk=${plan.risk_amount.toFixed(2)} ${account.currency}  reward=${plan.expected_reward.toFixed(2)} ${account.currency}`,
    `  (${stop_loss_pips} pips SL, R:R 1:${risk_reward_ratio}, ${risk_percent}% of ${account.balance.toFixed(2)} ${account.currency})`,
  ].join("\n");

  if (dryRun) return ok(`[dry-run]\n${planText}`);
  if (plan.volume <= 0) return err(`computed volume ${plan.volume} is not tradable`);

  const r = await ctx.api.placeOrder({
    symbol: plan.symbol,
    side: plan.side,
    volume: plan.volume,
    sl: plan.sl,
    tp: plan.tp,
    comment: asString(args.comment) ?? `risk ${risk_percent}% R:R 1:${risk_reward_ratio}`,
  });

  return ok(
    `${planText}\nExecuted #${r.ticket} @ ${r.price} (sl=${r.sl}, tp=${r.tp}).`,
  );
}

async function closePosition(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const ticket = asNumber(args.ticket);
  if (!ticket) return err("ticket is required");
  const r = await ctx.api.closePosition(ticket);
  return ok(r.closed ? `Closed position #${r.ticket}.` : `Position #${r.ticket} was not open.`);
}

async function modifyPosition(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<ToolResult> {
  const ticket = asNumber(args.ticket);
  if (!ticket) return err("ticket is required");
  const sl = asNumber(args.sl);
  const tp = asNumber(args.tp);
  if (sl === undefined && tp === undefined) return err("provide at least sl or tp");
  const r = await ctx.api.modifyPosition({ ticket, sl, tp });
  const parts: string[] = [];
  if (sl !== undefined) parts.push(`sl=${sl}`);
  if (tp !== undefined) parts.push(`tp=${tp}`);
  return ok(`Modified #${r.ticket} (${parts.join(", ")}).`);
}
