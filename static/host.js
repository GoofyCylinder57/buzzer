/**
 * Host client logic:
 * - Displays player list and buzz order
 * - Allows locking/unlocking players (individually or in bulk)
 * - Handles WebSocket connection and reconnection
 * - Updates UI based on server events
 */

/**
 * DOM references for host UI elements.
 * @type {{
 *   players: HTMLUListElement,
 *   selectAll: HTMLInputElement,
 *   lockSelected: HTMLButtonElement,
 *   unlockSelected: HTMLButtonElement,
 *   selectedCount: HTMLSpanElement,
 *   selectedCount2: HTMLSpanElement
 * }}
 */
const DOM = {
  players: document.getElementById("players"),
  selectAll: document.getElementById("selectAll"),
  lockSelected: document.getElementById("lockSelected"),
  unlockSelected: document.getElementById("unlockSelected"),
  selectedCount: document.getElementById("selectedCount"),
  selectedCount2: document.getElementById("selectedCount2"),
};

let ws = null;

let reconnectAttempts = 0;
const maxReconnectAttempts = 10;

const reconnectDelay = 1000;
let reconnectTimer = null;
let isConnected = false;

let playerList = [];
const buzzedPlayers = new Set();
const selectedPlayers = new Set();

/** Show connection status messages */
function showConnectionStatus(status, message) {
  // Remove any existing status indicator
  const existingStatus = document.getElementById("connection-status");
  if (existingStatus) existingStatus.remove();

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
      if (statusDiv.parentNode) statusDiv.remove();
    }, 3000);
  }
}

/** Update the count of selected players and button states */
function updateSelectedCount() {
  const count = selectedPlayers.size;
  DOM.selectedCount.textContent = count;
  DOM.selectedCount2.textContent = count;
  
  // Enable/disable bulk action buttons
  DOM.lockSelected.disabled = count === 0;
  DOM.unlockSelected.disabled = count === 0;
  
  // Update select all checkbox state
  if (count === 0) {
    DOM.selectAll.checked = false;
    DOM.selectAll.indeterminate = false;
  } else if (count === playerList.length) {
    DOM.selectAll.checked = true;
    DOM.selectAll.indeterminate = false;
  } else {
    DOM.selectAll.checked = false;
    DOM.selectAll.indeterminate = true;
  }
}

/** Toggle selection of a player */
function togglePlayerSelection(uuid, checked) {
  if (checked) {
    selectedPlayers.add(uuid);
  } else {
    selectedPlayers.delete(uuid);
  }
  updateSelectedCount();
}

/** Send lock/unlock command for a player */
function togglePlayerLock(ids, shouldLock) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    const action = shouldLock ? "LOCK" : "UNLOCK";
    const data = `${action} ${JSON.stringify(ids)}`;
    ws.send(data);
  }
}

/** Update the player list display */
function updatePlayerDisplay() {
  DOM.players.innerHTML = '';

  // Sort players: buzzed players first (in order they buzzed), then unbuzzed players
  const buzzedPlayersList = Array.from(buzzedPlayers);
  const unbuzzedPlayers = playerList.filter(player => !buzzedPlayers.has(player.id));

  // Add buzzed players first
  buzzedPlayersList.forEach((uuid, index) => {
    const player = playerList.find(p => p.id === uuid);
    if (player) {
      createPlayerElement(player, index + 1);
    }
  });

  // Add unbuzzed players
  unbuzzedPlayers.forEach(player => {
    createPlayerElement(player, null);
  });

  updateSelectedCount();
}

/** Create a player list item element */
function createPlayerElement(player, buzzOrder) {
  const li = document.createElement("li");
  li.className = `player ${buzzOrder ? 'buzzed' : ''}`;

  // Checkbox for selection
  const checkboxContainer = document.createElement("label");
  checkboxContainer.className = "checkbox-container";

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = selectedPlayers.has(player.id);
  checkbox.addEventListener('change', (e) => {
    togglePlayerSelection(player.id, e.target.checked);
  });

  const checkmark = document.createElement("span");
  checkmark.className = "checkmark";

  checkboxContainer.appendChild(checkbox);
  checkboxContainer.appendChild(checkmark);

  // Player info section
  const playerInfo = document.createElement("div");
  playerInfo.className = "player-info";

  const nameSpan = document.createElement("span");
  nameSpan.className = "player-name";
  nameSpan.textContent = `${player.name} (${player.id})`;

  playerInfo.appendChild(nameSpan);

  if (buzzOrder) {
    const buzzIndicator = document.createElement("span");
    buzzIndicator.className = "buzz-indicator";
    buzzIndicator.textContent = `#${buzzOrder}`;
    playerInfo.appendChild(buzzIndicator);
  }

  // Control buttons section
  const controls = document.createElement("div");
  controls.className = "player-controls";

  const isLocked = player.locked;

  const lockToggle = document.createElement("button");
  lockToggle.className = `lock-toggle ${isLocked ? 'locked' : 'unlocked'}`;
  lockToggle.textContent = isLocked ? 'Locked' : 'Unlocked';
  lockToggle.addEventListener('click', () => {
    togglePlayerLock([parseInt(player.id)], !isLocked);
  });

  controls.appendChild(lockToggle);

  // Assemble the player element
  li.appendChild(checkboxContainer);
  li.appendChild(playerInfo);
  li.appendChild(controls);

  DOM.players.appendChild(li);
}

/** Connect to the server WebSocket */
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.onopen = () => {
    console.info("WebSocket connected!");
    isConnected = true;
    reconnectAttempts = 0;
    
    showConnectionStatus('connected', 'Host connected!');
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

  ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    isConnected = false;
  };

  ws.onmessage = (/**@type{MessageEvent<string>}*/event) => {
    const message = {
      type: event.data.split(" ")[0],
      data: event.data.split(" ").slice(1).join(" "),
    };
    console.log("!Host!", message);

    switch (message.type) {
      case "BUZZ": {
        buzzedPlayers.add(message.data);
        updatePlayerDisplay();
        break;
      }
      case "PLU": {
        playerList = JSON.parse(message.data).map((plr) => {
          return {
            id: parseInt(plr.split(" ")[0]),
            locked: plr.split(" ")[1] === "T",
            name: plr.split(" ").slice(2).join(" "),
          };
        });

        // Clean up buzzedPlayers and selectedPlayers for disconnected players
        const currentUuids = new Set(playerList.map(p => p.id));
        for (const uuid of buzzedPlayers) {
          if (!currentUuids.has(uuid)) {
            buzzedPlayers.delete(uuid);
          }
        }
        for (const uuid of selectedPlayers) {
          if (!currentUuids.has(uuid)) {
            selectedPlayers.delete(uuid);
          }
        }

        // If all players are unlocked, reset the buzz order
        if (playerList.every(player => !player.locked))
          buzzedPlayers.clear();

        updatePlayerDisplay();
        break;
      }
    }
  };
}

/** Attempt to reconnect with exponential backoff */
function attemptReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  if (reconnectAttempts >= maxReconnectAttempts) {
    showConnectionStatus('disconnected', 'Failed to reconnect. Please refresh the page.');
    return;
  }

  reconnectAttempts++;
  
  showConnectionStatus('reconnecting', `Reconnecting... (attempt ${reconnectAttempts}/${maxReconnectAttempts})`);
  
  reconnectTimer = setTimeout(() => {
    if (!isConnected) {
      connectWebSocket(); // TODO: #8 Change to a reconnect that keeps id
    }
  }, reconnectDelay);
}

// Event listeners for bulk actions
DOM.selectAll.addEventListener('change', (e) => {
  const shouldSelectAll = e.target.checked;
  
  if (shouldSelectAll) {
    playerList.forEach(player => {
      selectedPlayers.add(player.id);
    });
  } else {
    selectedPlayers.clear();
  }
  
  updatePlayerDisplay();
});

DOM.lockSelected.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN && selectedPlayers.size > 0) {
    const uuids = Array.from(selectedPlayers);
    togglePlayerLock(uuids, true);
  }
});

DOM.unlockSelected.addEventListener('click', () => {
  if (ws && ws.readyState === WebSocket.OPEN && selectedPlayers.size > 0) {
    const uuids = Array.from(selectedPlayers);
    togglePlayerLock(uuids, false);
  }
});

// Initialize connection when page loads
connectWebSocket();

// Handle page visibility changes to reconnect when tab becomes active
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !isConnected) attemptReconnect();
});

// Handle online/offline events
addEventListener('online', () => {
  if (!isConnected) setTimeout(() => attemptReconnect(), 1000);
});

addEventListener('offline', () => {
  showConnectionStatus('disconnected', 'You are offline');
});
