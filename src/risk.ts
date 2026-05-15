import type { AccountInfo, OrderSide, SymbolInfo } from "./types.js";

export function pipSize(digits: number): number {
  if (digits === 5 || digits === 3) return Math.pow(10, -(digits - 1));
  return Math.pow(10, -digits);
}

export function pipsToPrice(pips: number, digits: number): number {
  return pips * pipSize(digits);
}

export function lossPerLotForStopPips(symbol: SymbolInfo, stop_loss_pips: number): number {
  if (stop_loss_pips <= 0) throw new Error("stop_loss_pips must be > 0");
  if (symbol.tick_size <= 0) throw new Error("symbol.tick_size must be > 0");
  const sl_price = pipsToPrice(stop_loss_pips, symbol.digits);
  const ticks = sl_price / symbol.tick_size;
  return ticks * symbol.tick_value;
}

export function lotsForRisk(
  balance: number,
  risk_percent: number,
  loss_per_lot: number,
): number {
  if (loss_per_lot <= 0) throw new Error("loss_per_lot must be > 0");
  const risk_amount = balance * (risk_percent / 100);
  return risk_amount / loss_per_lot;
}

export function roundVolume(
  raw: number,
  step: number,
  min: number,
  max: number,
): number {
  if (raw < min) return min;
  if (raw > max) return max;
  const steps = Math.floor(raw / step);
  const rounded = steps * step;
  const decimals = decimalsOf(step);
  return Number(rounded.toFixed(decimals));
}

function decimalsOf(step: number): number {
  if (step >= 1) return 0;
  const s = step.toString();
  if (s.includes("e-")) return Math.abs(parseInt(s.split("e-")[1] ?? "0", 10));
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

export interface PlanRiskOrderInput {
  account: AccountInfo;
  symbol: SymbolInfo;
  side: OrderSide;
  stop_loss_pips: number;
  risk_reward_ratio: number;
  risk_percent: number;
}

export interface PlannedOrder {
  symbol: string;
  side: OrderSide;
  volume: number;
  entry: number;
  sl: number;
  tp: number;
  risk_amount: number;
  expected_reward: number;
  loss_per_lot: number;
  pip_size: number;
  raw_volume: number;
}

export function planRiskOrder(input: PlanRiskOrderInput): PlannedOrder {
  const { account, symbol, side, stop_loss_pips, risk_reward_ratio, risk_percent } = input;
  if (stop_loss_pips <= 0) throw new Error("stop_loss_pips must be > 0");
  if (risk_reward_ratio <= 0) throw new Error("risk_reward_ratio must be > 0");
  if (risk_percent <= 0 || risk_percent > 100) {
    throw new Error("risk_percent must be in (0, 100]");
  }

  const loss_per_lot = lossPerLotForStopPips(symbol, stop_loss_pips);
  const raw_volume = lotsForRisk(account.balance, risk_percent, loss_per_lot);
  const volume = roundVolume(
    raw_volume,
    symbol.volume_step,
    symbol.volume_min,
    symbol.volume_max,
  );

  const sl_distance = pipsToPrice(stop_loss_pips, symbol.digits);
  const tp_distance = pipsToPrice(stop_loss_pips * risk_reward_ratio, symbol.digits);

  const entry = side === "buy" ? symbol.ask : symbol.bid;
  const sl = side === "buy" ? entry - sl_distance : entry + sl_distance;
  const tp = side === "buy" ? entry + tp_distance : entry - tp_distance;

  const risk_amount = volume * loss_per_lot;
  const expected_reward = risk_amount * risk_reward_ratio;

  return {
    symbol: symbol.symbol,
    side,
    volume,
    entry: round(entry, symbol.digits),
    sl: round(sl, symbol.digits),
    tp: round(tp, symbol.digits),
    risk_amount,
    expected_reward,
    loss_per_lot,
    pip_size: pipSize(symbol.digits),
    raw_volume,
  };
}

function round(value: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(value * f) / f;
}
