import { join as joinPath } from "@std/path";

// Map to store connected players (WebSocket -> Player)
const players = new Map<WebSocket, Player>();
// Set to store connected host WebSockets
const hosts = new Set<WebSocket>();

// Player class to represent each player
let prevId = 0;
type Player = {
  name: string,
  id: number,
  locked: boolean,
};

function Player(name: string): Player {
  return {
    name,
    id: prevId++,
    locked: false,
  };
}

// Broadcast a message to all player clients
function broadcast(message: string) {
  for (const ws of players.keys()) {
    try {
      ws.send(message);
    } catch (e) {
      console.error("Error sending to WebSocket:", e);
      players.delete(ws);
      updatePlayerList();
    }
  }
}

// Broadcast a message to all host clients
function broadcastHost(message: string) {
  for (const ws of hosts.values()) {
    try {
      ws.send(message);
    } catch (e) {
      console.error("Error sending to Host WebSocket:", e);
      hosts.delete(ws);
    }
  }
}

// Send the current player list to all clients and hosts
function updatePlayerList() {
  const plrs = Array.from(players.values()).map(plr => `${plr.id} ${plr.locked ? "T" : "F"} ${plr.name}`);
  const data = `PLU ${JSON.stringify(plrs)}`;
  broadcastHost(data);
  broadcast(data);
}

// Handle a new WebSocket connection (either player or host)
function handleWS(socket: WebSocket) {
  socket.onopen = () => {
    console.info("WebSocket opened!");
    hosts.add(socket); // We add users to the hosts list until they ask for a ID, then we make them a player
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

    if (players.size === 0) prevId = 0;
  };

  socket.onmessage = (event: MessageEvent<string>) => {
    const message = {
      type: event.data.split(" ")[0],
      data: event.data.split(" ").slice(1).join(" "),
    };
    console.log("Received WS message:", event.data);

    switch (message.type) {
      case "JOIN": {
        const plr = Player(message.data);
        players.set(socket, plr);
        hosts.delete(socket); // This socket is now a player, not a host

        socket.send(`ACK ${plr.id}`);
        updatePlayerList();
        break;
      }
      case "BUZZ": {
        const player = players.get(socket);
        if (player) {
          player.locked = true;
          broadcastHost(`BUZZ ${player.id}`);
          updatePlayerList();
        }
        break;
      }
      case "UNLOCK": {
        const who = JSON.parse(message.data);
        if (!who || !Array.isArray(who)) break;
        who.forEach((uid: string) => {
          const uuid = parseInt(uid, 10);
          const plr = Array.from(players.values()).find((p) => p.id === uuid);
          if (plr) plr.locked = false;
          // Find the WebSocket for this player and notify them
          const plr_sock = players.entries().find((plr) => plr[1].id === uuid)
            ?.[0];
          if (plr_sock) plr_sock.send('UNLOCK');
        });
        updatePlayerList();
        break;
      }
      case "LOCK": {
        const who = JSON.parse(message.data);
        if (!who || !Array.isArray(who)) break;
        who.forEach((uid: string) => {
          const uuid = parseInt(uid, 10);
          const plr = Array.from(players.values()).find((p) => p.id === uuid);
          if (plr) plr.locked = true;
          // Find the WebSocket for this player and notify them
          const plr_sock = players.entries().find((plr) => plr[1].id === uuid)
            ?.[0];
          if (plr_sock) plr_sock.send(`LOCK`);
        });
        updatePlayerList();
        break;
      }
    }
  };
}

// HTTP request handler for static files, HTML pages, and WebSocket upgrade
async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  switch (url.pathname) {
    case "/": {
      const filePath = joinPath(Deno.cwd(), "static", "player.html");
      const fileContent = await Deno.readTextFile(filePath);
      return new Response(fileContent, {
        headers: { "Content-Type": "text/html" },
      });
    }
    case "/host": {
      const filePath = joinPath(Deno.cwd(), "static", "host.html");
      const fileContent = await Deno.readTextFile(filePath);
      return new Response(fileContent, {
        headers: { "Content-Type": "text/html" },
      });
    }
    case "/favicon.ico": {
      const filePath = joinPath(Deno.cwd(), "static", "favicon.ico");
      const fileContent = await Deno.readFile(filePath);
      return new Response(fileContent, {
        headers: {
          "Content-Type": "image/x-icon",
          "Cache-Control": "max-age=604800",
        },
      });
    }
    case "/ws": {
      if (req.headers.get("upgrade") !== "websocket")
        return new Response("Expected a WebSocket upgrade", { status: 400 });

      const { socket, response } = Deno.upgradeWebSocket(req);
      handleWS(socket);
      return response;
    }
    case "/static/buzz.wav": {
      const filePath = joinPath(Deno.cwd(), "static", "buzz.wav");
      const fileContent = await Deno.readFile(filePath);
      return new Response(fileContent, {
        headers: {
          "Content-Type": "audio/wav",
          "Cache-Control": "max-age=604800",
        }
      });
    }
    default:
      if (url.pathname.startsWith("/static/")) {
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
          if (e instanceof Deno.errors.NotFound)
            return new Response("Not Found", { status: 404 });
          return new Response("Internal Server Error", { status: 500 });
        }
      }
  }

  // Fallback for unknown routes
  return new Response("Not Found", { status: 404 });
}

Deno.serve(handler);
