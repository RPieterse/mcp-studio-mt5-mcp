import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { handleTool, type ToolContext } from "./tools.js";

const TOOLS = [
  {
    name: "account_info",
    description:
      "Get the connected MT5 account: login, currency, balance, equity, margin, free margin, leverage.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "symbol_info",
    description:
      "Get pricing and contract details for a symbol (digits, point, tick_size, tick_value, contract_size, volume bounds, bid, ask).",
    inputSchema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", minLength: 1, description: "e.g. EURUSD, USDJPY, XAUUSD." },
      },
      required: ["symbol"],
      additionalProperties: false,
    },
  },
  {
    name: "get_positions",
    description: "List open positions. Pass symbol to filter to one instrument.",
    inputSchema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", description: "Optional symbol filter." },
      },
      additionalProperties: false,
    },
  },
  {
    name: "place_market_order",
    description:
      "Place a market order with an explicit volume (lots). Use this only when you already know the lot size; for risk-based sizing use place_risk_order.",
    inputSchema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", minLength: 1 },
        side: { type: "string", enum: ["buy", "sell"] },
        volume: { type: "number", exclusiveMinimum: 0 },
        sl: { type: "number", description: "Stop loss price (absolute)." },
        tp: { type: "number", description: "Take profit price (absolute)." },
        comment: { type: "string" },
      },
      required: ["symbol", "side", "volume"],
      additionalProperties: false,
    },
  },
  {
    name: "place_risk_order",
    description:
      "Place a market order sized by account risk. Reads balance + symbol pricing, computes lots so that hitting the stop loses exactly risk_percent of balance, sets a take profit at risk_reward_ratio * stop distance. Pass dry_run:true to preview without trading.",
    inputSchema: {
      type: "object" as const,
      properties: {
        symbol: { type: "string", minLength: 1 },
        side: { type: "string", enum: ["buy", "sell"] },
        stop_loss_pips: { type: "number", exclusiveMinimum: 0 },
        risk_reward_ratio: {
          type: "number",
          exclusiveMinimum: 0,
          description: "The R in 1:R — TP distance = R * SL distance.",
        },
        risk_percent: {
          type: "number",
          exclusiveMinimum: 0,
          maximum: 100,
          description: "Percent of account balance to risk if the stop is hit.",
        },
        comment: { type: "string" },
        dry_run: {
          type: "boolean",
          description: "If true, return the planned order without placing it.",
        },
      },
      required: ["symbol", "side", "stop_loss_pips", "risk_reward_ratio", "risk_percent"],
      additionalProperties: false,
    },
  },
  {
    name: "close_position",
    description: "Close an open position by ticket.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ticket: { type: "number" },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
  },
  {
    name: "modify_position",
    description: "Update the stop loss and/or take profit on an open position.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ticket: { type: "number" },
        sl: { type: "number" },
        tp: { type: "number" },
      },
      required: ["ticket"],
      additionalProperties: false,
    },
  },
];

export function createServer(ctx: ToolContext): Server {
  const server = new Server(
    { name: "mt5", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const result = await handleTool(req.params.name, args, ctx);
    return {
      content: [{ type: "text" as const, text: result.text }],
      isError: result.isError ?? false,
    };
  });

  return server;
}
