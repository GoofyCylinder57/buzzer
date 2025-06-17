import { join as joinPath } from "@std/path";

const players = new Map<WebSocket, string>();
const hosts = new Set<WebSocket>();

function broadcast(message: object) {
  const msg = JSON.stringify(message);
  for (const ws of players.keys()) {
    try {
      ws.send(msg);
    } catch (e) {
      console.error("Error sending to WebSocket:", e);

      players.delete(ws);
      updatePlayerList();
    }
  }
}

function broadcastHost(message: object) {
  const msg = JSON.stringify(message);
  for (const ws of hosts.values()) {
    try {
      ws.send(msg);
    } catch (e) {
      console.error("Error sending to Host WebSocket:", e);

      hosts.delete(ws);
    }
  }
}

function updatePlayerList() {
  const names = Array.from(players.values());
  const data = { type: "playerListUpdate", players: names };
  broadcast(data);
  broadcastHost(data);
}

function handleWS(socket: WebSocket) {
  socket.onopen = () => {
    console.info("WebSocket opened!");
    hosts.add(socket);
    updatePlayerList();
  };

  socket.onerror = (event) => {
    console.error("WebSocket error:", event);
  };

  socket.onclose = () => {
    console.info("WebSocket closed!");
    players.delete(socket);
    hosts.delete(socket);
    updatePlayerList();
  };

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log("Received WS message:", message);

    switch (message.type) {
      case "join":
        if (message.name && typeof message.name === "string") {
          players.set(socket, message.name);
          hosts.delete(socket);
          updatePlayerList();
        }
        break;
      case "buzz": {
        const playerName = players.get(socket);
        if (playerName) broadcastHost({ type: "buzzedIn", name: playerName });
        break;
      }
      case "reset":
        broadcast({ type: "buzzerUnlock" });
        break;
    }
  };
}

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    const filePath = joinPath(Deno.cwd(), "static", "player.html");
    const fileContent = await Deno.readTextFile(filePath);
    return new Response(fileContent, {
      headers: { "Content-Type": "text/html" },
    });
  } else if (url.pathname === "/host") {
    const filePath = joinPath(Deno.cwd(), "static", "host.html");
    const fileContent = await Deno.readTextFile(filePath);
    return new Response(fileContent, {
      headers: { "Content-Type": "text/html" },
    });
  } else if (url.pathname.startsWith("/static/")) {
    const filePath = joinPath(Deno.cwd(), url.pathname);
    try {
      const fileContent = await Deno.readFile(filePath);
      const contentType = url.pathname.endsWith(".js")
        ? "application/javascript"
        : url.pathname.endsWith(".css")
        ? "text/css"
        : "text/plain";
      return new Response(fileContent, {
        headers: { "Content-Type": contentType },
      });
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        return new Response("Not Found", { status: 404 });
      }
      return new Response("Internal Server Error", { status: 500 });
    }
  } else if (url.pathname === "/ws") {
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 400 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWS(socket);
    return response;
  }

  return new Response("Not Found", { status: 404 });
}

Deno.serve(handler);
