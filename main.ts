import { join as joinPath } from "@std/path";

// Map to store connected players (WebSocket -> Player)
const players = new Map<WebSocket, Player>();
// Set to store connected host WebSockets
const hosts = new Set<WebSocket>();

// Player class to represent each player
class Player {
  name: string;
  uuid: ReturnType<Crypto["randomUUID"]>;
  locked: boolean = false; // Indicates if the player is locked

  constructor(name: string) {
    this.name = name;
    this.uuid = crypto.randomUUID();
  }
}

// Broadcast a message to all player clients
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

// Broadcast a message to all host clients
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

// Send the current player list to all clients and hosts
function updatePlayerList() {
  const plrs = Array.from(players.values()).map((p) => ({
    name: p.name,
    uuid: p.uuid,
    locked: p.locked, // Include locked state
  }));
  const data = { type: "playerListUpdate", players: plrs };
  broadcast(data);
  broadcastHost(data);
}

// Handle a new WebSocket connection (either player or host)
function handleWS(socket: WebSocket) {
  socket.onopen = () => {
    console.info("WebSocket opened!");
    hosts.add(socket); // By default, treat as host until join
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
      case "join": {
        // Player joins the game
        if (!message.name || typeof message.name !== "string") break;

        const plr = new Player(message.name);
        players.set(socket, plr);
        hosts.delete(socket); // This socket is now a player, not a host

        socket.send(`{"type":"joinResponse", "uuid":"${plr.uuid}"}`);
        updatePlayerList();
        break;
      }
      case "buzz": {
        // Player buzzes in
        const player = players.get(socket);
        if (player) {
          player.locked = true; // Lock the player on buzz
          broadcastHost({ type: "buzz", user: { name: player.name, uuid: player.uuid } });
          updatePlayerList();
        }
        break;
      }
      case "unlock":
        // Unlock specific players
        if (!message.who || !Array.isArray(message.who)) break;
        message.who.forEach((uuid: string) => {
          const plr = Array.from(players.values()).find((p) => p.uuid === uuid);
          if (plr) plr.locked = false;
          // Find the WebSocket for this player and notify them
          const plr_sock = players.entries().find((plr) => plr[1].uuid === uuid)
            ?.[0];
          if (plr_sock) plr_sock.send(`{"type":"unlock"}`);
        });
        updatePlayerList();
        break;
      case "lock":
        // Lock specific players
        if (!message.who || !Array.isArray(message.who)) break;
        message.who.forEach((uuid: string) => {
          const plr = Array.from(players.values()).find((p) => p.uuid === uuid);
          if (plr) plr.locked = true;
          // Find the WebSocket for this player and notify them
          const plr_sock = players.entries().find((plr) => plr[1].uuid === uuid)
            ?.[0];
          if (plr_sock) plr_sock.send(`{"type":"lock"}`);
        });
        updatePlayerList();
        break;
    }
  };
}

// HTTP request handler for static files, HTML pages, and WebSocket upgrade
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === "/") {
    // Serve the player page
    const filePath = joinPath(Deno.cwd(), "static", "player.html");
    const fileContent = await Deno.readTextFile(filePath);
    return new Response(fileContent, {
      headers: { "Content-Type": "text/html" },
    });
  } else if (url.pathname === "/host") {
    // Serve the host page
    const filePath = joinPath(Deno.cwd(), "static", "host.html");
    const fileContent = await Deno.readTextFile(filePath);
    return new Response(fileContent, {
      headers: { "Content-Type": "text/html" },
    });
  } else if (url.pathname === "/favicon.ico") {
    // Serve favicon
    const filePath = joinPath(Deno.cwd(), "static", "favicon.ico");
    const fileContent = await Deno.readFile(filePath);
    return new Response(fileContent, {
      headers: { "Content-Type": "image/x-icon" },
    });
  } else if (url.pathname.startsWith("/static/")) {
    // Serve static files (JS, CSS, etc.)
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
    // Handle WebSocket upgrade
    if (req.headers.get("upgrade") !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 400 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    handleWS(socket);
    return response;
  }

  // Fallback for unknown routes
  return new Response("Not Found", { status: 404 });
}

// Start the Deno HTTP server
Deno.serve(handler);
