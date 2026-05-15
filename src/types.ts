export type OrderSide = "buy" | "sell";

export interface AccountInfo {
  login: number;
  currency: string;
  balance: number;
  equity: number;
  margin: number;
  free_margin: number;
  leverage: number;
}

export interface SymbolInfo {
  symbol: string;
  digits: number;
  point: number;
  tick_size: number;
  tick_value: number;
  contract_size: number;
  volume_min: number;
  volume_max: number;
  volume_step: number;
  bid: number;
  ask: number;
}

export interface Position {
  ticket: number;
  symbol: string;
  side: OrderSide;
  volume: number;
  price_open: number;
  sl: number;
  tp: number;
  profit: number;
  comment: string;
}

export interface PlaceOrderInput {
  symbol: string;
  side: OrderSide;
  volume: number;
  sl?: number;
  tp?: number;
  comment?: string;
}

export interface PlaceOrderResult {
  ticket: number;
  symbol: string;
  side: OrderSide;
  volume: number;
  price: number;
  sl: number;
  tp: number;
}

export interface ModifyPositionInput {
  ticket: number;
  sl?: number;
  tp?: number;
}

export interface Mt5Api {
  accountInfo(): Promise<AccountInfo>;
  symbolInfo(symbol: string): Promise<SymbolInfo>;
  positions(symbol?: string): Promise<Position[]>;
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>;
  closePosition(ticket: number): Promise<{ ticket: number; closed: boolean }>;
  modifyPosition(input: ModifyPositionInput): Promise<{ ticket: number }>;
}

export interface ToolResult {
  text: string;
  isError?: boolean;
}
