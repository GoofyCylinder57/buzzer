/**
 @type{{
  resetButton: HTMLButtonElement,
  buzzedInQueue: HTMLUListElement,
  connections: HTMLOListElement,
 }}
 */
const DOM = {
  resetButton: document.getElementById("reset"),
  buzzedInQueue: document.getElementById("buzzedInQueue"),
  connections: document.getElementById("connections"),
};

const ws = new WebSocket(`ws://${location.host}/ws`);

ws.onopen = () => {
  console.info("WebSocket connected!");
};

ws.onclose = () => {
  console.warn("WebSocket disconnected!");
};

ws.onerror = (error) => {
  console.error("WebSocket error:", error);
};

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  console.log("Host received:", message);

  switch (message.type) {
    case "buzzedIn": {
      const li = document.createElement("li");
      li.textContent = message.name;
      DOM.buzzedInQueue.appendChild(li);
      break;
    }
    case "playerListUpdate": {
      DOM.connections.innerHTML = ``;
      message.players.forEach((player) => {
        const li = document.createElement("li");
        li.textContent = player;
        DOM.connections.appendChild(li);
      });
      break;
    }
  }
};

DOM.resetButton.onclick = () => {
  if (ws && ws.readyState == WebSocket.OPEN) {
    ws.send(`{"type":"reset"}`);
    DOM.buzzedInQueue.innerHTML = ``;
  }
};
