/**
 * WebSocket Client for Agent Planner
 *
 * Handles real-time communication with the Agent Planner WebSocket server.
 * Provides automatic reconnection and event handling.
 */

import WebSocket from 'ws';

export class WebSocketClient {
  constructor(options) {
    this.url = options.url;
    this.token = options.token;
    this.onEvent = options.onEvent;
    this.onError = options.onError || (() => {});
    this.onReconnect = options.onReconnect || (() => {});

    this.ws = null;
    this.connected = false;
    this.reconnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.maxReconnectDelay = 30000;
    this.pingInterval = null;
    this.pendingMessages = [];
  }

  /**
   * Connect to the WebSocket server
   */
  async connect() {
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = new URL(this.url);
        wsUrl.searchParams.set('token', this.token);

        this.ws = new WebSocket(wsUrl.toString());

        this.ws.on('open', () => {
          console.log('[WS] Connected to Agent Planner');
          this.connected = true;
          this.reconnecting = false;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;

          // Send any pending messages
          while (this.pendingMessages.length > 0) {
            const msg = this.pendingMessages.shift();
            this.send(msg);
          }

          // Start ping interval
          this.startPing();

          resolve();
        });

        this.ws.on('message', (data) => {
          try {
            const event = JSON.parse(data.toString());
            this.handleEvent(event);
          } catch (error) {
            console.error('[WS] Failed to parse message:', error);
          }
        });

        this.ws.on('close', (code, reason) => {
          console.log(`[WS] Connection closed: ${code} - ${reason || 'No reason'}`);
          this.connected = false;
          this.stopPing();

          // Attempt to reconnect unless it was intentional
          if (code !== 1000 && !this.reconnecting) {
            this.scheduleReconnect();
          }
        });

        this.ws.on('error', (error) => {
          console.error('[WS] Connection error:', error.message);
          this.onError(error);

          if (!this.connected) {
            reject(error);
          }
        });

        // Timeout connection attempt
        setTimeout(() => {
          if (!this.connected) {
            this.ws.terminate();
            reject(new Error('Connection timeout'));
          }
        }, 10000);

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Disconnect from the WebSocket server
   */
  async disconnect() {
    this.stopPing();

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.connected = false;
    this.reconnecting = false;
  }

  /**
   * Send a message to the server
   */
  send(message) {
    if (!this.connected) {
      // Queue message for when we reconnect
      this.pendingMessages.push(message);
      return false;
    }

    try {
      this.ws.send(JSON.stringify(message));
      return true;
    } catch (error) {
      console.error('[WS] Failed to send message:', error);
      this.pendingMessages.push(message);
      return false;
    }
  }

  /**
   * Handle incoming event
   */
  handleEvent(event) {
    const { type, data, timestamp } = event;

    // Handle system events
    switch (type) {
      case 'pong':
        // Server responded to ping
        return;

      case 'error':
        console.error('[WS] Server error:', data.message);
        this.onError(new Error(data.message));
        return;

      case 'authenticated':
        console.log('[WS] Authentication confirmed');
        return;

      default:
        // Pass to event handler
        this.onEvent({ type, data, timestamp });
    }
  }

  /**
   * Start ping interval to keep connection alive
   */
  startPing() {
    this.pingInterval = setInterval(() => {
      if (this.connected) {
        this.send({ type: 'ping' });
      }
    }, 30000);
  }

  /**
   * Stop ping interval
   */
  stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Schedule a reconnection attempt
   */
  scheduleReconnect() {
    if (this.reconnecting) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[WS] Max reconnection attempts reached');
      return;
    }

    this.reconnecting = true;
    this.reconnectAttempts++;

    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      this.maxReconnectDelay
    );

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(async () => {
      try {
        await this.connect();
        this.onReconnect();
      } catch (error) {
        console.error('[WS] Reconnection failed:', error.message);
        this.reconnecting = false;
        this.scheduleReconnect();
      }
    }, delay);
  }

  /**
   * Subscribe to plan updates
   */
  subscribePlan(planId) {
    return this.send({
      type: 'subscribe:plan',
      data: { planId }
    });
  }

  /**
   * Unsubscribe from plan updates
   */
  unsubscribePlan(planId) {
    return this.send({
      type: 'unsubscribe:plan',
      data: { planId }
    });
  }

  /**
   * Update user presence
   */
  updatePresence(planId, nodeId, status) {
    return this.send({
      type: 'presence:update',
      data: { planId, nodeId, status }
    });
  }

  /**
   * Send typing indicator
   */
  sendTyping(planId, nodeId) {
    return this.send({
      type: 'typing:start',
      data: { planId, nodeId }
    });
  }
}
