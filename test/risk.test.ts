import { describe, it, expect } from "vitest";
import {
  pipSize,
  pipsToPrice,
  lossPerLotForStopPips,
  lotsForRisk,
  roundVolume,
  planRiskOrder,
} from "../src/risk.js";
import type { AccountInfo, SymbolInfo } from "../src/types.js";

describe("pipSize", () => {
  it("treats 5-digit forex pairs as pip = 10 * point", () => {
    expect(pipSize(5)).toBeCloseTo(0.0001, 10);
  });
  it("treats 3-digit JPY pairs as pip = 0.01", () => {
    expect(pipSize(3)).toBeCloseTo(0.01, 10);
  });
  it("treats 4-digit legacy forex as pip = point", () => {
    expect(pipSize(4)).toBeCloseTo(0.0001, 10);
  });
  it("treats 2-digit legacy JPY as pip = point", () => {
    expect(pipSize(2)).toBeCloseTo(0.01, 10);
  });
});

describe("pipsToPrice", () => {
  it("converts 10 pips on EURUSD (5 digits) to 0.0010 of price", () => {
    expect(pipsToPrice(10, 5)).toBeCloseTo(0.001, 10);
  });
  it("converts 20 pips on USDJPY (3 digits) to 0.20 of price", () => {
    expect(pipsToPrice(20, 3)).toBeCloseTo(0.2, 10);
  });
});

describe("lossPerLotForStopPips", () => {
  it("returns account-currency loss per 1.0 lot at the given stop distance", () => {
    // EURUSD: tick_size=0.00001, tick_value=$1 per lot, 10 pips = 0.001 price = 100 ticks.
    // Loss per lot = 100 ticks * $1 = $100.
    const sym: SymbolInfo = {
      symbol: "EURUSD",
      digits: 5,
      point: 0.00001,
      tick_size: 0.00001,
      tick_value: 1.0,
      contract_size: 100000,
      volume_min: 0.01,
      volume_max: 500,
      volume_step: 0.01,
      bid: 1.085,
      ask: 1.0852,
    };
    expect(lossPerLotForStopPips(sym, 10)).toBeCloseTo(100, 6);
  });
  it("handles USDJPY-style symbols (3 digits, larger tick value)", () => {
    // Make-believe USDJPY: tick_size=0.001, tick_value=~$0.67 per lot.
    // 20 pips = 0.2 price = 200 ticks. Loss per lot ≈ $134.
    const sym: SymbolInfo = {
      symbol: "USDJPY",
      digits: 3,
      point: 0.001,
      tick_size: 0.001,
      tick_value: 0.67,
      contract_size: 100000,
      volume_min: 0.01,
      volume_max: 500,
      volume_step: 0.01,
      bid: 149.5,
      ask: 149.51,
    };
    expect(lossPerLotForStopPips(sym, 20)).toBeCloseTo(134, 2);
  });
});

describe("lotsForRisk", () => {
  it("computes lots so that loss at stop = risk amount", () => {
    // $10k balance, 1% risk = $100. Loss per lot at 10 pips = $100. → 1.0 lots.
    expect(lotsForRisk(10000, 1, 100)).toBeCloseTo(1.0, 6);
  });
  it("scales down for smaller risk %", () => {
    // 0.5% of $10k = $50. $50 / $100 per lot = 0.5 lots.
    expect(lotsForRisk(10000, 0.5, 100)).toBeCloseTo(0.5, 6);
  });
  it("throws on a non-positive loss per lot", () => {
    expect(() => lotsForRisk(10000, 1, 0)).toThrow();
  });
});

describe("roundVolume", () => {
  it("rounds down to the nearest volume_step", () => {
    expect(roundVolume(0.137, 0.01, 0.01, 500)).toBeCloseTo(0.13, 6);
  });
  it("clamps to volume_min when below", () => {
    expect(roundVolume(0.003, 0.01, 0.01, 500)).toBe(0.01);
  });
  it("clamps to volume_max when above", () => {
    expect(roundVolume(750, 0.01, 0.01, 500)).toBe(500);
  });
  it("uses 1.0 step for index-style instruments", () => {
    expect(roundVolume(2.7, 1, 1, 100)).toBe(2);
  });
});

const eurusd: SymbolInfo = {
  symbol: "EURUSD",
  digits: 5,
  point: 0.00001,
  tick_size: 0.00001,
  tick_value: 1.0,
  contract_size: 100000,
  volume_min: 0.01,
  volume_max: 500,
  volume_step: 0.01,
  bid: 1.085,
  ask: 1.0852,
};

const acct10k: AccountInfo = {
  login: 1,
  currency: "USD",
  balance: 10000,
  equity: 10000,
  margin: 0,
  free_margin: 10000,
  leverage: 100,
  // @ts-expect-error allow extra
};

describe("planRiskOrder", () => {
  it("matches the prompt: 1:4 buy EURUSD, 10 pip SL, risk 1% of $10k", () => {
    const plan = planRiskOrder({
      account: acct10k,
      symbol: eurusd,
      side: "buy",
      stop_loss_pips: 10,
      risk_reward_ratio: 4,
      risk_percent: 1,
    });
    expect(plan.side).toBe("buy");
    expect(plan.volume).toBeCloseTo(1.0, 6);
    expect(plan.entry).toBeCloseTo(1.0852, 6); // ask for a buy
    expect(plan.sl).toBeCloseTo(1.0842, 6); // ask - 10 pips
    expect(plan.tp).toBeCloseTo(1.0892, 6); // ask + 40 pips
    expect(plan.risk_amount).toBeCloseTo(100, 6);
    expect(plan.expected_reward).toBeCloseTo(400, 6);
  });

  it("places a sell off the bid with mirrored SL/TP", () => {
    const plan = planRiskOrder({
      account: acct10k,
      symbol: eurusd,
      side: "sell",
      stop_loss_pips: 10,
      risk_reward_ratio: 2,
      risk_percent: 1,
    });
    expect(plan.side).toBe("sell");
    expect(plan.entry).toBeCloseTo(1.085, 6); // bid for a sell
    expect(plan.sl).toBeCloseTo(1.086, 6); // bid + 10 pips
    expect(plan.tp).toBeCloseTo(1.083, 6); // bid - 20 pips
    expect(plan.expected_reward).toBeCloseTo(200, 6);
  });

  it("rejects zero or negative stop_loss_pips", () => {
    expect(() =>
      planRiskOrder({
        account: acct10k,
        symbol: eurusd,
        side: "buy",
        stop_loss_pips: 0,
        risk_reward_ratio: 2,
        risk_percent: 1,
      }),
    ).toThrow();
  });

  it("rejects risk_percent <= 0 or > 100", () => {
    expect(() =>
      planRiskOrder({
        account: acct10k,
        symbol: eurusd,
        side: "buy",
        stop_loss_pips: 10,
        risk_reward_ratio: 2,
        risk_percent: 0,
      }),
    ).toThrow();
    expect(() =>
      planRiskOrder({
        account: acct10k,
        symbol: eurusd,
        side: "buy",
        stop_loss_pips: 10,
        risk_reward_ratio: 2,
        risk_percent: 200,
      }),
    ).toThrow();
  });

  it("rejects risk_reward_ratio <= 0", () => {
    expect(() =>
      planRiskOrder({
        account: acct10k,
        symbol: eurusd,
        side: "buy",
        stop_loss_pips: 10,
        risk_reward_ratio: 0,
        risk_percent: 1,
      }),
    ).toThrow();
  });
});
