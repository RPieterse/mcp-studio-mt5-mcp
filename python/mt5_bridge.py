#!/usr/bin/env python3
"""Long-lived stdio bridge between the Node MCP and the MetaTrader5 terminal.

Protocol: newline-delimited JSON.
  request:  {"id": "1", "method": "place_order", "params": {...}}
  response: {"id": "1", "result": {...}}  or  {"id": "1", "error": "..."}

The MT5 Python library is Windows-only (it loads the terminal's DLLs). On
macOS/Linux, install it inside the same Wine prefix used by your MT5 terminal
and point MT5_PYTHON at that interpreter.
"""

from __future__ import annotations

import json
import os
import sys
import traceback
from typing import Any

try:
    import MetaTrader5 as mt5  # type: ignore
except Exception as e:  # pragma: no cover
    sys.stderr.write(
        f"[mt5_bridge] failed to import MetaTrader5: {e}\n"
        "Install it with: pip install MetaTrader5 (requires a Windows or Wine MT5 terminal)\n"
    )
    raise


def reply(id_: str, result: Any | None = None, error: str | None = None) -> None:
    msg = {"id": id_}
    if error is not None:
        msg["error"] = error
    else:
        msg["result"] = result
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def _initialize(params: dict) -> dict:
    kwargs: dict = {}
    if params.get("mt5_path"):
        kwargs["path"] = params["mt5_path"]
    if params.get("login"):
        kwargs["login"] = int(params["login"])
    if params.get("password"):
        kwargs["password"] = params["password"]
    if params.get("server"):
        kwargs["server"] = params["server"]
    ok = mt5.initialize(**kwargs) if kwargs else mt5.initialize()
    if not ok:
        err = mt5.last_error()
        raise RuntimeError(f"mt5.initialize failed: {err}")
    info = mt5.terminal_info()
    return {
        "connected": True,
        "build": getattr(info, "build", None),
        "company": getattr(info, "company", None),
    }


def _account_info(_: dict) -> dict:
    a = mt5.account_info()
    if a is None:
        raise RuntimeError(f"account_info unavailable: {mt5.last_error()}")
    return {
        "login": int(a.login),
        "currency": a.currency,
        "balance": float(a.balance),
        "equity": float(a.equity),
        "margin": float(a.margin),
        "free_margin": float(a.margin_free),
        "leverage": int(a.leverage),
    }


def _symbol_info(params: dict) -> dict:
    symbol = params["symbol"]
    if not mt5.symbol_select(symbol, True):
        raise RuntimeError(f"symbol_select failed for {symbol}: {mt5.last_error()}")
    info = mt5.symbol_info(symbol)
    if info is None:
        raise RuntimeError(f"symbol_info returned None for {symbol}")
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise RuntimeError(f"symbol_info_tick returned None for {symbol}")
    return {
        "symbol": symbol,
        "digits": int(info.digits),
        "point": float(info.point),
        "tick_size": float(info.trade_tick_size or info.point),
        "tick_value": float(info.trade_tick_value),
        "contract_size": float(info.trade_contract_size),
        "volume_min": float(info.volume_min),
        "volume_max": float(info.volume_max),
        "volume_step": float(info.volume_step),
        "bid": float(tick.bid),
        "ask": float(tick.ask),
    }


def _positions(params: dict) -> list[dict]:
    symbol = params.get("symbol")
    raw = mt5.positions_get(symbol=symbol) if symbol else mt5.positions_get()
    if raw is None:
        return []
    out = []
    for p in raw:
        out.append({
            "ticket": int(p.ticket),
            "symbol": p.symbol,
            "side": "buy" if p.type == mt5.POSITION_TYPE_BUY else "sell",
            "volume": float(p.volume),
            "price_open": float(p.price_open),
            "sl": float(p.sl),
            "tp": float(p.tp),
            "profit": float(p.profit),
            "comment": p.comment,
        })
    return out


def _filling_mode(symbol: str) -> int:
    info = mt5.symbol_info(symbol)
    flags = int(getattr(info, "filling_mode", 0) or 0)
    if flags & 1:  # SYMBOL_FILLING_FOK
        return mt5.ORDER_FILLING_FOK
    if flags & 2:  # SYMBOL_FILLING_IOC
        return mt5.ORDER_FILLING_IOC
    return mt5.ORDER_FILLING_RETURN


def _place_order(params: dict) -> dict:
    symbol = params["symbol"]
    side = params["side"]
    volume = float(params["volume"])
    sl = params.get("sl")
    tp = params.get("tp")
    comment = params.get("comment") or ""

    if not mt5.symbol_select(symbol, True):
        raise RuntimeError(f"symbol_select failed for {symbol}: {mt5.last_error()}")
    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise RuntimeError(f"no tick for {symbol}")

    if side == "buy":
        price = float(tick.ask)
        order_type = mt5.ORDER_TYPE_BUY
    elif side == "sell":
        price = float(tick.bid)
        order_type = mt5.ORDER_TYPE_SELL
    else:
        raise ValueError(f"unknown side: {side}")

    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": symbol,
        "volume": volume,
        "type": order_type,
        "price": price,
        "deviation": 20,
        "magic": 0,
        "comment": comment[:31],
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _filling_mode(symbol),
    }
    if sl is not None:
        request["sl"] = float(sl)
    if tp is not None:
        request["tp"] = float(tp)

    result = mt5.order_send(request)
    if result is None:
        raise RuntimeError(f"order_send returned None: {mt5.last_error()}")
    if result.retcode != mt5.TRADE_RETCODE_DONE:
        raise RuntimeError(f"order_send retcode {result.retcode}: {result.comment}")

    return {
        "ticket": int(result.order or result.deal),
        "symbol": symbol,
        "side": side,
        "volume": float(result.volume),
        "price": float(result.price),
        "sl": float(sl) if sl is not None else 0.0,
        "tp": float(tp) if tp is not None else 0.0,
    }


def _close_position(params: dict) -> dict:
    ticket = int(params["ticket"])
    positions = mt5.positions_get(ticket=ticket)
    if not positions:
        return {"ticket": ticket, "closed": False}
    pos = positions[0]
    tick = mt5.symbol_info_tick(pos.symbol)
    is_buy = pos.type == mt5.POSITION_TYPE_BUY
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": pos.symbol,
        "volume": float(pos.volume),
        "type": mt5.ORDER_TYPE_SELL if is_buy else mt5.ORDER_TYPE_BUY,
        "position": ticket,
        "price": float(tick.bid if is_buy else tick.ask),
        "deviation": 20,
        "magic": 0,
        "comment": "close",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": _filling_mode(pos.symbol),
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        comment = result.comment if result else mt5.last_error()
        raise RuntimeError(f"close failed: {comment}")
    return {"ticket": ticket, "closed": True}


def _modify_position(params: dict) -> dict:
    ticket = int(params["ticket"])
    positions = mt5.positions_get(ticket=ticket)
    if not positions:
        raise RuntimeError(f"position {ticket} not found")
    pos = positions[0]
    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "position": ticket,
        "symbol": pos.symbol,
        "sl": float(params["sl"]) if "sl" in params and params["sl"] is not None else float(pos.sl),
        "tp": float(params["tp"]) if "tp" in params and params["tp"] is not None else float(pos.tp),
    }
    result = mt5.order_send(request)
    if result is None or result.retcode != mt5.TRADE_RETCODE_DONE:
        comment = result.comment if result else mt5.last_error()
        raise RuntimeError(f"modify failed: {comment}")
    return {"ticket": ticket}


def _shutdown(_: dict) -> dict:
    mt5.shutdown()
    return {"shutdown": True}


HANDLERS = {
    "initialize": _initialize,
    "account_info": _account_info,
    "symbol_info": _symbol_info,
    "positions": _positions,
    "place_order": _place_order,
    "close_position": _close_position,
    "modify_position": _modify_position,
    "shutdown": _shutdown,
}


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
            id_ = msg["id"]
            method = msg["method"]
            params = msg.get("params") or {}
        except Exception as e:
            sys.stderr.write(f"[mt5_bridge] bad line: {e}\n")
            continue

        handler = HANDLERS.get(method)
        if handler is None:
            reply(id_, error=f"unknown method: {method}")
            continue

        try:
            result = handler(params)
            reply(id_, result=result)
        except Exception as e:
            sys.stderr.write(traceback.format_exc())
            reply(id_, error=str(e))

        if method == "shutdown":
            break


if __name__ == "__main__":
    main()
