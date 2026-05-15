import { describe, it, expect, vi } from "vitest";
import { handleTool } from "../src/tools.js";
import type {
  AccountInfo,
  Mt5Api,
  PlaceOrderInput,
  Position,
  SymbolInfo,
} from "../src/types.js";

const baseAccount: AccountInfo = {
  login: 12345,
  currency: "USD",
  balance: 10000,
  equity: 10000,
  margin: 0,
  free_margin: 10000,
  leverage: 100,
};

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

function makeApi(overrides: Partial<Mt5Api> = {}): Mt5Api {
  return {
    accountInfo: vi.fn(async () => baseAccount),
    symbolInfo: vi.fn(async () => eurusd),
    positions: vi.fn(async () => [] as Position[]),
    placeOrder: vi.fn(async (i: PlaceOrderInput) => ({
      ticket: 9001,
      symbol: i.symbol,
      side: i.side,
      volume: i.volume,
      price: i.side === "buy" ? eurusd.ask : eurusd.bid,
      sl: i.sl ?? 0,
      tp: i.tp ?? 0,
    })),
    closePosition: vi.fn(async (ticket: number) => ({ ticket, closed: true })),
    modifyPosition: vi.fn(async ({ ticket }) => ({ ticket })),
    ...overrides,
  };
}

describe("account_info", () => {
  it("returns formatted balance and currency", async () => {
    const api = makeApi();
    const r = await handleTool("account_info", {}, { api });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain("USD");
    expect(r.text).toContain("10000");
  });
});

describe("place_risk_order", () => {
  it("matches the example prompt: 1:4 buy EURUSD, 10 pip SL, risk 1%", async () => {
    const api = makeApi();
    const r = await handleTool(
      "place_risk_order",
      {
        symbol: "EURUSD",
        side: "buy",
        stop_loss_pips: 10,
        risk_reward_ratio: 4,
        risk_percent: 1,
      },
      { api },
    );
    expect(r.isError).toBeFalsy();
    expect(api.placeOrder).toHaveBeenCalledTimes(1);
    const call = (api.placeOrder as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.symbol).toBe("EURUSD");
    expect(call.side).toBe("buy");
    expect(call.volume).toBeCloseTo(1.0, 6);
    expect(call.sl).toBeCloseTo(1.0842, 6);
    expect(call.tp).toBeCloseTo(1.0892, 6);
    expect(r.text).toContain("Executed");
    expect(r.text).toContain("#9001");
  });

  it("dry_run skips order placement and returns the plan", async () => {
    const api = makeApi();
    const r = await handleTool(
      "place_risk_order",
      {
        symbol: "EURUSD",
        side: "sell",
        stop_loss_pips: 20,
        risk_reward_ratio: 2,
        risk_percent: 0.5,
        dry_run: true,
      },
      { api },
    );
    expect(r.isError).toBeFalsy();
    expect(api.placeOrder).not.toHaveBeenCalled();
    expect(r.text).toContain("[dry-run]");
    expect(r.text).toContain("SELL");
  });

  it("rejects when required fields are missing", async () => {
    const api = makeApi();
    const r = await handleTool(
      "place_risk_order",
      { side: "buy", stop_loss_pips: 10, risk_reward_ratio: 2, risk_percent: 1 },
      { api },
    );
    expect(r.isError).toBe(true);
    expect(api.placeOrder).not.toHaveBeenCalled();
  });

  it("surfaces api errors with a clear message", async () => {
    const api = makeApi({
      placeOrder: vi.fn(async () => {
        throw new Error("trade context busy");
      }),
    });
    const r = await handleTool(
      "place_risk_order",
      {
        symbol: "EURUSD",
        side: "buy",
        stop_loss_pips: 10,
        risk_reward_ratio: 4,
        risk_percent: 1,
      },
      { api },
    );
    expect(r.isError).toBe(true);
    expect(r.text).toContain("trade context busy");
  });
});

describe("place_market_order", () => {
  it("requires positive volume", async () => {
    const api = makeApi();
    const r = await handleTool(
      "place_market_order",
      { symbol: "EURUSD", side: "buy", volume: 0 },
      { api },
    );
    expect(r.isError).toBe(true);
    expect(api.placeOrder).not.toHaveBeenCalled();
  });

  it("places a market order through the api", async () => {
    const api = makeApi();
    const r = await handleTool(
      "place_market_order",
      { symbol: "EURUSD", side: "buy", volume: 0.5, sl: 1.08, tp: 1.09 },
      { api },
    );
    expect(r.isError).toBeFalsy();
    expect(api.placeOrder).toHaveBeenCalledWith({
      symbol: "EURUSD",
      side: "buy",
      volume: 0.5,
      sl: 1.08,
      tp: 1.09,
      comment: undefined,
    });
  });
});

describe("get_positions", () => {
  it("reports no open positions cleanly", async () => {
    const api = makeApi();
    const r = await handleTool("get_positions", {}, { api });
    expect(r.isError).toBeFalsy();
    expect(r.text.toLowerCase()).toContain("no open positions");
  });

  it("lists open positions one per line", async () => {
    const api = makeApi({
      positions: vi.fn(async () => [
        {
          ticket: 1,
          symbol: "EURUSD",
          side: "buy",
          volume: 0.1,
          price_open: 1.08,
          sl: 1.07,
          tp: 1.09,
          profit: 12.34,
          comment: "",
        },
      ]),
    });
    const r = await handleTool("get_positions", {}, { api });
    expect(r.text).toContain("#1");
    expect(r.text).toContain("BUY");
    expect(r.text).toContain("12.34");
  });
});

describe("close_position / modify_position", () => {
  it("closes a position by ticket", async () => {
    const api = makeApi();
    const r = await handleTool("close_position", { ticket: 42 }, { api });
    expect(r.isError).toBeFalsy();
    expect(api.closePosition).toHaveBeenCalledWith(42);
  });

  it("requires at least one of sl/tp to modify", async () => {
    const api = makeApi();
    const r = await handleTool("modify_position", { ticket: 42 }, { api });
    expect(r.isError).toBe(true);
    expect(api.modifyPosition).not.toHaveBeenCalled();
  });

  it("forwards sl/tp to the api", async () => {
    const api = makeApi();
    const r = await handleTool(
      "modify_position",
      { ticket: 42, sl: 1.08, tp: 1.1 },
      { api },
    );
    expect(r.isError).toBeFalsy();
    expect(api.modifyPosition).toHaveBeenCalledWith({ ticket: 42, sl: 1.08, tp: 1.1 });
  });
});

describe("unknown tool", () => {
  it("returns an error", async () => {
    const api = makeApi();
    const r = await handleTool("nope", {}, { api });
    expect(r.isError).toBe(true);
  });
});
