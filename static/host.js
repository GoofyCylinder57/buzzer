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
 *   selectedCount2: HTMLSpanElement,
 *   questionTypeSelect: HTMLSelectElement
 * }}
 */
const DOM = {
  players: document.getElementById("players"),
  selectAll: document.getElementById("selectAll"),
  lockSelected: document.getElementById("lockSelected"),
  unlockSelected: document.getElementById("unlockSelected"),
  selectedCount: document.getElementById("selectedCount"),
  selectedCount2: document.getElementById("selectedCount2"),
  questionTypeSelect: document.getElementById("questionType"),
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
const buzzedAnswers = {}; // { [playerId]: answer }

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

  // Add table header (no "check" header, combine with Rank & Name)
  const header = document.createElement("div");
  header.className = "player player-header";
  header.style.fontWeight = "bold";

  // Combined cell for check + Rank & Name
  const rankNameHeader = document.createElement("div");
  rankNameHeader.className = "player-cell player-rank-name-header";
  rankNameHeader.textContent = "Rank & Name";

  // Add clear ranking button
  const clearBtn = document.createElement("button");
  clearBtn.textContent = "✕";
  clearBtn.title = "Clear all rankings";
  clearBtn.style.marginLeft = "0.5em";
  clearBtn.style.fontSize = "0.9em";
  clearBtn.style.padding = "0.1em 0.5em";
  clearBtn.style.cursor = "pointer";
  clearBtn.onclick = () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send("CLEAR_RANKINGS");
    }
  };
  rankNameHeader.appendChild(clearBtn);

  header.appendChild(rankNameHeader);

  // Answer header
  const answerHeader = document.createElement("div");
  answerHeader.className = "player-cell";
  answerHeader.textContent = "Answer";
  header.appendChild(answerHeader);

  // Lock header
  const lockHeader = document.createElement("div");
  lockHeader.className = "player-cell";
  lockHeader.textContent = "Lock";
  header.appendChild(lockHeader);

  DOM.players.appendChild(header);

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
  const row = document.createElement("div");
  row.className = `player${buzzOrder ? ' buzzed' : ''}`;

  // Combined Checkbox + Rank & Name cell
  const rankNameCell = document.createElement("div");
  rankNameCell.className = "player-cell player-rank-name";
  rankNameCell.style.display = "flex";
  rankNameCell.style.alignItems = "center";
  rankNameCell.style.gap = "0.75em";

  // Checkbox
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

  rankNameCell.appendChild(checkboxContainer);

  // Buzz indicator and name
  if (player.rank) {
    const buzzIndicator = document.createElement("span");
    buzzIndicator.className = "buzz-indicator";
    buzzIndicator.textContent = `#${player.rank}`;
    rankNameCell.appendChild(buzzIndicator);
  }
  const nameSpan = document.createElement("span");
  nameSpan.className = "player-name";
  nameSpan.textContent = `${player.name} (${player.id})`;
  rankNameCell.appendChild(nameSpan);

  // Answer cell
  const answerCell = document.createElement("div");
  answerCell.className = "player-cell";
  const answerSpan = document.createElement("span");
  answerSpan.className = "player-answer";
  answerSpan.textContent = player.rank ? (player.answer || "BUZZ") : "";
  answerCell.appendChild(answerSpan);

  // Lock status cell
  const lockCell = document.createElement("div");
  lockCell.className = "player-cell";
  const isLocked = player.locked;
  const lockToggle = document.createElement("button");
  lockToggle.className = `lock-toggle ${isLocked ? 'locked' : 'unlocked'}`;
  lockToggle.textContent = isLocked ? 'Locked' : 'Unlocked';
  lockToggle.addEventListener('click', () => {
    togglePlayerLock([parseInt(player.id)], !isLocked);
  });
  lockCell.appendChild(lockToggle);

  // Assemble row
  row.appendChild(rankNameCell);
  row.appendChild(answerCell);
  row.appendChild(lockCell);

  DOM.players.appendChild(row);
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
        // message.data: "<playerId> <answer>"
        const [id, ...answerParts] = message.data.split(" ");
        const answer = answerParts.join(" ") || "BUZZ";
        buzzedPlayers.add(parseInt(id));
        buzzedAnswers[id] = answer;
        updatePlayerDisplay();
        break;
      }
      case "PLU": {
        // message.data is now a JSON object
        const parsed = JSON.parse(message.data);
        playerList = parsed.players;

        // Use server-provided buzzOrder for display order
        buzzedPlayers.clear();
        parsed.buzzOrder.forEach(id => buzzedPlayers.add(id));

        // Clean up selectedPlayers for disconnected players
        const currentUuids = new Set(playerList.map(p => p.id));
        for (const uuid of selectedPlayers) {
          if (!currentUuids.has(uuid)) {
            selectedPlayers.delete(uuid);
          }
        }

        updatePlayerDisplay();
        break;
      }
      case "QUESTION_TYPE":
        if (DOM.questionTypeSelect && DOM.questionTypeSelect.value !== (message.data || "pure-buzz")) {
          DOM.questionTypeSelect.value = message.data || "pure-buzz";
        }
        break;
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

let prevQuestionType = DOM.questionTypeSelect.value;
DOM.questionTypeSelect.addEventListener("change", () => {
  // Check if all players are locked before allowing question type change
  const unlockedPlayers = playerList.filter(player => !player.locked);
  if (unlockedPlayers.length > 0) {
    alert("All buzzers must be locked before changing the question type.");
    DOM.questionTypeSelect.value = prevQuestionType; // Revert to previous selection
    return;
  }

  let numChoices = 0;
  if (DOM.questionTypeSelect.value === "multiple-choice") {
    numChoices = parseInt(prompt("Enter the number of choices (2-6):", "4"));
    if (isNaN(numChoices) || numChoices < 2 || numChoices > 6) {
      alert("Invalid number of choices. Please enter a number between 2 and 6.");
      return;
    }
  }

  prevQuestionType = DOM.questionTypeSelect.value;
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(`QUESTION_TYPE ${DOM.questionTypeSelect.value}${DOM.questionTypeSelect.value === "multiple-choice" ? ` ${numChoices}` : ''}`);
  }
});
