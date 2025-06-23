import { join as joinPath } from "@std/path";

const players = new Map<WebSocket, Player>();
const hosts = new Set<WebSocket>();

class Player {
  name: string;
  uuid: ReturnType<Crypto["randomUUID"]>;
  locked: boolean = false; // Add locked state

  constructor(name: string) {
    this.name = name;
    this.uuid = crypto.randomUUID();
  }

  static withUUID(name: string, uuid: string): Player {
    const self = new Player(name);
    self.uuid = uuid as ReturnType<Crypto["randomUUID"]>;

    return self;
  }
}

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
  const plrs = Array.from(players.values()).map((p) => ({
    name: p.name,
    uuid: p.uuid,
    locked: p.locked, // Include locked state
  }));
  const data = { type: "playerListUpdate", players: plrs };
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
      case "join": {
        if (!message.name || typeof message.name !== "string") break;

        const plr = new Player(message.name);
        players.set(socket, plr);
        hosts.delete(socket);

        socket.send(`{"type":"joinResponse", "uuid":"${plr.uuid}"}`);
        updatePlayerList();
        break;
      }
      case "buzz": {
        const player = players.get(socket);
        if (player) {
          player.locked = true; // Lock on buzz
          broadcastHost({ type: "buzz", user: { name: player.name, uuid: player.uuid } });
          updatePlayerList();
        }
        break;
      }
      case "unlock":
        if (!message.who || !Array.isArray(message.who)) break;
        message.who.forEach((uuid: string) => {
          const plr = Array.from(players.values()).find((p) => p.uuid === uuid);
          if (plr) plr.locked = false;
          const plr_sock = players.entries().find((plr) => plr[1].uuid === uuid)
            ?.[0];
          if (plr_sock) plr_sock.send(`{"type":"unlock"}`);
        });
        updatePlayerList();
        break;
      case "lock":
        if (!message.who || !Array.isArray(message.who)) break;
        message.who.forEach((uuid: string) => {
          const plr = Array.from(players.values()).find((p) => p.uuid === uuid);
          if (plr) plr.locked = true;
          const plr_sock = players.entries().find((plr) => plr[1].uuid === uuid)
            ?.[0];
          if (plr_sock) plr_sock.send(`{"type":"lock"}`);
        });
        updatePlayerList();
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
  } else if (url.pathname === "/favicon.ico") {
    const filePath = joinPath(Deno.cwd(), "static", "favicon.ico");
    const fileContent = await Deno.readFile(filePath);
    return new Response(fileContent, {
      headers: { "Content-Type": "image/x-icon" },
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
