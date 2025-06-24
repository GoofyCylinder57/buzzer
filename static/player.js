/**
 * Player client logic:
 * - Handles joining, buzzing, and UI updates
 * - Manages WebSocket connection and reconnection
 * - Updates player list and buzzer state from server events
 */

/**
 * DOM references for player UI elements.
 * @type {{
 *   join: {
 *     section: HTMLElement,
 *     playerName: HTMLInputElement,
 *     button: HTMLButtonElement
 *   },
 *   gameSection: HTMLElement,
 *   buzzer: HTMLButtonElement,
 *   connections: HTMLUListElement,
 *   info: {
 *     uuid: HTMLElement,
 *     audio: {
 *       check: HTMLInputElement,
 *       el: HTMLAudioElement
 *     }
 *   }
 * }}
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
  info: {
    uuid: document.getElementById("uuid"),
    audio: {
      check: document.getElementById("audio-check"),
      el: document.getElementById("buzzer-sound"),
    },
  },
};

/** WebSocket connection and state variables */
let ws = null;
let playerName = "";
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
let reconnectDelay = 1000; // Start with 1 second
let reconnectTimer = null;
let isConnected = false;

/** Handle pressing Enter in the name field */
DOM.join.playerName.onkeydown = (event) => {
  if (event.key === "Enter") DOM.join.button.click();
};

/** Handle clicking the join button */
DOM.join.button.onclick = () => {
  const name = DOM.join.playerName.value.trim();
  if (!name) {
    alert("Please enter your name!");
    return;
  }

  playerName = name;
  DOM.join.section.style.display = "none";
  DOM.gameSection.style.display = "grid";
  connectWebSocket();
};

/** Handle clicking the buzzer */
DOM.buzzer.onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const checked = DOM.info.audio.check.checked;
  const enabled = !DOM.buzzer.disabled;

  // Play sound if enabled
  if (checked && enabled) {
    DOM.info.audio.el.currentTime = 0;
    DOM.info.audio.el.play();
  }

  ws.send(`{"type":"buzz"}`);
  DOM.buzzer.disabled = true;
};

/** Show connection status messages */
function showConnectionStatus(status, message) {
  // Remove any existing status indicator
  const existingStatus = document.getElementById("connection-status");
  if (existingStatus) {
    existingStatus.remove();
  }

  // Create new status indicator
  const statusDiv = document.createElement("div");
  statusDiv.id = "connection-status";
  statusDiv.style.cssText = `
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    padding: 10px 20px;
    border-radius: 5px;
    font-weight: bold;
    z-index: 1000;
    ${status === "connected"
      ? "background: #4CAF50; color: white;"
      : status === "disconnected"
        ? "background: #f44336; color: white;"
        : "background: #ff9800; color: white;"
    }
  `;
  statusDiv.textContent = message;
  document.body.appendChild(statusDiv);

  // Auto-hide success messages
  if (status === "connected") {
    setTimeout(() => {
      if (statusDiv.parentNode) {
        statusDiv.remove();
      }
    }, 3000);
  }
}

/** Connect to the server WebSocket */
function connectWebSocket() {
  if (
    ws &&
    (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
  ) {
    return;
  }

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    console.info("WebSocket connected!");
    isConnected = true;
    reconnectAttempts = 0;
    reconnectDelay = 1000;

    showConnectionStatus("connected", "Connected to game!");

    // Rejoin the game
    ws.send(JSON.stringify({ type: "join", name: playerName }));
  };

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    isConnected = false;
  };

  ws.onclose = (event) => {
    console.warn("WebSocket disconnected!", event.code, event.reason);
    isConnected = false;

    // Don't show disconnected message if this was intentional
    if (event.code !== 1000) {
      showConnectionStatus(
        "disconnected",
        "Connection lost. Attempting to reconnect...",
      );
      attemptReconnect();
    }
  };

  /** Handle messages from the server */
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log("Received:", message);

    switch (message.type) {
      case "playerListUpdate":
        // Update player list
        DOM.connections.innerHTML = ``;
        message.players.forEach((player) => {
          const li = document.createElement("li");
          li.textContent = player.name;
          li.title = player.uuid;
          DOM.connections.appendChild(li);
        });
        break;
      case "unlock":
        // Enable buzzer
        DOM.buzzer.disabled = false;
        break;
      case "lock":
        // Disable buzzer
        DOM.buzzer.disabled = true;
        break;
      case "joinResponse":
        // Show player UUID
        DOM.info.uuid.innerText = message.uuid;
        break;
    }
  };
}

/** Attempt to reconnect with exponential backoff */
function attemptReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  if (reconnectAttempts >= maxReconnectAttempts) {
    showConnectionStatus(
      "disconnected",
      "Failed to reconnect. Please refresh the page.",
    );
    return;
  }

  reconnectAttempts++;

  showConnectionStatus(
    "reconnecting",
    `Reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`,
  );

  reconnectTimer = setTimeout(() => {
    if (!isConnected) {
      connectWebSocket();
    }
  }, reconnectDelay);
}

// Handle page visibility changes to reconnect when tab becomes active
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && !isConnected && playerName) {
    attemptReconnect();
  }
});

// Handle online/offline events
addEventListener("online", () => {
  if (!isConnected && playerName) {
    setTimeout(() => attemptReconnect(), 1000);
  }
});

addEventListener("offline", () => {
  showConnectionStatus("disconnected", "You are offline");
});
