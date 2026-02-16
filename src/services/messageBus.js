// src/services/messageBus.js
const pg = require('pg');

const listeners = new Map();
let client = null;

async function init(connectionString) {
  client = new pg.Client(connectionString);
  await client.connect();
  client.on('notification', ({ channel, payload }) => {
    const cbs = listeners.get(channel);
    if (cbs) {
      const data = JSON.parse(payload);
      cbs.forEach(cb => cb(data));
    }
  });
}

async function subscribe(channel, callback) {
  if (!listeners.has(channel)) {
    listeners.set(channel, new Set());
    await client.query(`LISTEN "${channel}"`);
  }
  listeners.get(channel).add(callback);
  return () => unsubscribe(channel, callback);
}

async function publish(channel, data) {
  // Use the pool from db if messageBus client isn't initialized (e.g. during tests)
  if (!client) return;
  await client.query(`SELECT pg_notify($1, $2)`, [channel, JSON.stringify(data)]);
}

async function unsubscribe(channel, callback) {
  const cbs = listeners.get(channel);
  if (cbs) {
    cbs.delete(callback);
    if (cbs.size === 0) {
      listeners.delete(channel);
      await client.query(`UNLISTEN "${channel}"`);
    }
  }
}

module.exports = { init, subscribe, publish, unsubscribe };
