/**
 * @type{{
    join: {
      section: HTMLDivElement,
      playerName: HTMLInputElement,
      button: HTMLButtonElement,
    },
    gameSection: HTMLDivElement,
    buzzer: HTMLButtonElement,
    connections: HTMLOListElement,
 }}
 */
const DOM = {
  join: {
    section: document.getElementById("join"),
    playerName: document.getElementById("playerName"),
    button: document.getElementById("joinButton"),
  },
  gameSection: document.getElementById("game"),
  buzzer: document.getElementById("buzzer"),
  connections: document.getElementById("connections"),
};

/** @type{WebSocket | null} */
let ws = null;

DOM.join.button.onclick = () => {
  const playerName = DOM.join.playerName.value.trim();
  if (!playerName) {
    alert("Please enter your name!");
    return;
  }

  DOM.join.section.style.display = "none";
  DOM.gameSection.style.display = "grid";
  connectWebSocket(playerName);
};

DOM.buzzer.onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(`{"type":"buzz"}`);
  DOM.buzzer.disabled = true;
};

function connectWebSocket(playerName) {
  ws = new WebSocket(`wss://${location.host}/ws`);

  ws.onopen = () => {
    console.info("WebSocket connected!");
    ws.send(JSON.stringify({ type: "join", name: playerName }));
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
  };

  ws.onclose = () => {
    console.warn("WebSocket disconnected!");
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log("Received:", message);

    switch (message.type) {
      case "playerListUpdate":
        DOM.connections.innerHTML = ``;
        message.players.forEach((player) => {
          const li = document.createElement("li");
          li.textContent = player;
          DOM.connections.appendChild(li);
        });
        break;
      case "buzzerUnlock":
        DOM.buzzer.disabled = false;
        break;
    }
  };
}
