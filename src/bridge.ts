import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";
import type {
  AccountInfo,
  Mt5Api,
  ModifyPositionInput,
  PlaceOrderInput,
  PlaceOrderResult,
  Position,
  SymbolInfo,
} from "./types.js";

interface PendingCall {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

export interface BridgeOptions {
  pythonBin: string;
  scriptPath: string;
  mt5Path?: string;
  mt5Login?: string;
  mt5Password?: string;
  mt5Server?: string;
}

export class PythonBridge implements Mt5Api {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly reader: Interface;
  private readonly pending = new Map<string, PendingCall>();
  private seq = 0;
  private ready: Promise<void>;

  constructor(opts: BridgeOptions) {
    this.proc = spawn(opts.pythonBin, ["-u", opts.scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        MT5_PATH: opts.mt5Path ?? "",
        MT5_LOGIN: opts.mt5Login ?? "",
        MT5_PASSWORD: opts.mt5Password ?? "",
        MT5_SERVER: opts.mt5Server ?? "",
      },
    });

    this.proc.on("exit", (code) => {
      const err = new Error(`mt5 python bridge exited (code ${code ?? "?"})`);
      for (const p of this.pending.values()) p.reject(err);
      this.pending.clear();
    });

    this.proc.stderr.on("data", (chunk) => {
      process.stderr.write(`[mt5-bridge] ${chunk}`);
    });

    this.reader = createInterface({ input: this.proc.stdout });
    this.reader.on("line", (line) => this.handleLine(line));

    this.ready = this.call("initialize", {
      mt5_path: opts.mt5Path || undefined,
      login: opts.mt5Login ? Number(opts.mt5Login) : undefined,
      password: opts.mt5Password || undefined,
      server: opts.mt5Server || undefined,
    }).then(() => void 0);
  }

  private handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: { id?: string; result?: unknown; error?: string };
    try {
      msg = JSON.parse(trimmed);
    } catch {
      process.stderr.write(`[mt5-bridge] non-json line: ${trimmed}\n`);
      return;
    }
    if (!msg.id) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    this.pending.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error));
    else pending.resolve(msg.result);
  }

  private call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const id = String(++this.seq);
    const payload = JSON.stringify({ id, method, params });
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      this.proc.stdin.write(payload + "\n", (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async accountInfo(): Promise<AccountInfo> {
    await this.ready;
    return this.call<AccountInfo>("account_info", {});
  }

  async symbolInfo(symbol: string): Promise<SymbolInfo> {
    await this.ready;
    return this.call<SymbolInfo>("symbol_info", { symbol });
  }

  async positions(symbol?: string): Promise<Position[]> {
    await this.ready;
    return this.call<Position[]>("positions", { symbol });
  }

  async placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult> {
    await this.ready;
    return this.call<PlaceOrderResult>("place_order", { ...input });
  }

  async closePosition(ticket: number): Promise<{ ticket: number; closed: boolean }> {
    await this.ready;
    return this.call("close_position", { ticket });
  }

  async modifyPosition(input: ModifyPositionInput): Promise<{ ticket: number }> {
    await this.ready;
    return this.call("modify_position", { ...input });
  }

  async shutdown(): Promise<void> {
    try {
      await this.call("shutdown", {});
    } catch {
      // best effort
    }
    this.proc.stdin.end();
  }
}
