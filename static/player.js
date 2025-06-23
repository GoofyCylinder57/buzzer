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
    uuid: HTMLSpanElement,
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
  uuid: document.getElementById("uuid"),
};

/** @type{WebSocket | null} */
let ws = null;
let playerName = "";
let reconnectAttempts = 0;
const maxReconnectAttempts = 10;
let reconnectDelay = 1000; // Start with 1 second
let reconnectTimer = null;
let isConnected = false;

DOM.join.playerName.onkeydown = (/** @type{KeyboardEvent} */ event) => {
  if (event.key === "Enter") DOM.join.button.click();
};

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

DOM.buzzer.onclick = () => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;

  ws.send(`{"type":"buzz"}`);
  DOM.buzzer.disabled = true;
};

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
    ${status === 'connected' ? 'background: #4CAF50; color: white;' : 
      status === 'disconnected' ? 'background: #f44336; color: white;' : 
      'background: #ff9800; color: white;'}
  `;
  statusDiv.textContent = message;
  document.body.appendChild(statusDiv);

  // Auto-hide success messages
  if (status === 'connected') {
    setTimeout(() => {
      if (statusDiv.parentNode) {
        statusDiv.remove();
      }
    }, 3000);
  }
}

function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    console.info("WebSocket connected!");
    isConnected = true;
    reconnectAttempts = 0;
    reconnectDelay = 1000;
    
    showConnectionStatus('connected', 'Connected to game!');
    
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
      showConnectionStatus('disconnected', 'Connection lost. Attempting to reconnect...');
      attemptReconnect();
    }
  };

  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    console.log("Received:", message);

    switch (message.type) {
      case "playerListUpdate":
        DOM.connections.innerHTML = ``;
        message.players.forEach((player) => {
          const li = document.createElement("li");
          li.textContent = player.name;
          li.title = player.uuid;
          DOM.connections.appendChild(li);
        });
        break;
      case "unlock":
        DOM.buzzer.disabled = false;
        break;
      case "lock":
        DOM.buzzer.disabled = true;
        break;
      case "joinResponse":
        DOM.uuid.innerText = message.uuid;
        break;
    }
  };
}

function attemptReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
  }

  if (reconnectAttempts >= maxReconnectAttempts) {
    showConnectionStatus('disconnected', 'Failed to reconnect. Please refresh the page.');
    return;
  }

  reconnectAttempts++;
  
  showConnectionStatus('reconnecting', `Reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
  
  reconnectTimer = setTimeout(() => {
    if (!isConnected) {
      connectWebSocket();
    }
  }, reconnectDelay);
}

// Handle page visibility changes to reconnect when tab becomes active
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !isConnected && playerName) {
    attemptReconnect();
  }
});

// Handle online/offline events
window.addEventListener('online', () => {
  if (!isConnected && playerName) {
    setTimeout(() => attemptReconnect(), 1000);
  }
});

window.addEventListener('offline', () => {
  showConnectionStatus('disconnected', 'You are offline');
});