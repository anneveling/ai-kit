// HTTP + SSE, same shape as pr-watch. Local only (127.0.0.1).
//
//   GET  /                 bridge page
//   GET  /t/<topic id>     topic page
//   GET  /static/<file>    web/ files
//   GET  /api/bridge       bridge view (JSON)
//   GET  /api/topic/<id>   topic view (JSON)
//   GET  /events           SSE: {"version": n} on connect and on every change
//   POST /decide           a decision without "at"; the server stamps the time

import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { App } from "./app.ts";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..", "web");
const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
};

async function sendFile(res: ServerResponse, name: string) {
  const ext = name.split(".").pop() ?? "";
  if (!/^[\w-]+\.\w+$/.test(name) || !TYPES[ext]) return notFound(res);
  try {
    const body = await readFile(join(WEB, name));
    res.writeHead(200, { "content-type": TYPES[ext], "cache-control": "no-store" }).end(body);
  } catch {
    notFound(res);
  }
}

const notFound = (res: ServerResponse) => res.writeHead(404, { "content-type": "text/plain" }).end("not found");
const json = (res: ServerResponse, body: unknown) =>
  res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));

async function readBody(req: IncomingMessage): Promise<string> {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 100_000) throw new Error("body too large");
  }
  return body;
}

function events(app: App, req: IncomingMessage, res: ServerResponse) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
  const send = (version: number) => res.write(`data: ${JSON.stringify({ version })}\n\n`);
  send(app.version);
  const off = app.subscribe(send);
  const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
  req.on("close", () => { off(); clearInterval(ping); });
}

export function handler(app: App) {
  return async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = decodeURIComponent(url.pathname);
    try {
      if (req.method === "POST" && path === "/decide") {
        let input: Record<string, unknown>;
        try {
          input = JSON.parse(await readBody(req));
          json(res, app.decide(input));
        } catch (e) {
          res.writeHead(400, { "content-type": "text/plain" }).end((e as Error).message);
        }
        return;
      }
      if (req.method !== "GET") return notFound(res);
      if (path === "/") return sendFile(res, "bridge.html");
      if (path.startsWith("/t/")) return sendFile(res, "topic.html");
      if (path.startsWith("/static/")) return sendFile(res, path.slice("/static/".length));
      if (path === "/api/bridge") return json(res, app.bridge());
      if (path.startsWith("/api/topic/")) {
        const view = app.topic(path.slice("/api/topic/".length));
        return view ? json(res, view) : notFound(res);
      }
      if (path === "/events") return events(app, req, res);
      notFound(res);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" }).end((e as Error).message);
    }
  };
}

export function startServer(app: App, port: number): Promise<Server> {
  const server = createServer(handler(app));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
