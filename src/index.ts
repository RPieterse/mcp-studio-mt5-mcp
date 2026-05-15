#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PythonBridge } from "./bridge.js";
import { createServer } from "./server.js";

const here = dirname(fileURLToPath(import.meta.url));
const scriptPath = resolve(here, "..", "python", "mt5_bridge.py");

const pythonBin = process.env.MT5_PYTHON || "python3";

const bridge = new PythonBridge({
  pythonBin,
  scriptPath,
  mt5Path: process.env.MT5_PATH,
  mt5Login: process.env.MT5_LOGIN,
  mt5Password: process.env.MT5_PASSWORD,
  mt5Server: process.env.MT5_SERVER,
});

const server = createServer({ api: bridge });

const onExit = () => {
  bridge.shutdown().finally(() => process.exit(0));
};
process.on("SIGINT", onExit);
process.on("SIGTERM", onExit);

const transport = new StdioServerTransport();
await server.connect(transport);
