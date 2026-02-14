const fs = require('fs');
const path = require('path');
const { promisify } = require('util');

const appendFileAsync = promisify(fs.appendFile);
const LOG_DIR = path.join(__dirname, '../../logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Create log file paths
const AUTH_LOG_FILE = path.join(LOG_DIR, 'auth.log');
const ERROR_LOG_FILE = path.join(LOG_DIR, 'error.log');
const API_LOG_FILE = path.join(LOG_DIR, 'api.log');

// Format log message
const formatLogMessage = (message) => {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] ${message}\n`;
};

// Log to file
const logToFile = async (filePath, message) => {
  try {
    const formattedMessage = formatLogMessage(message);
    await appendFileAsync(filePath, formattedMessage);
  } catch (error) {
    console.error(`Failed to write to log file (${filePath}):`, error);
  }
};

// Public API
const logger = {
  auth: async (message) => {
    console.log(`[AUTH] ${message}`);
    await logToFile(AUTH_LOG_FILE, `[AUTH] ${message}`);
  },
  
  error: async (message, error) => {
    const errorMsg = error ? `${message}: ${error.message}\n${error.stack || ''}` : message;
    console.error(`[ERROR] ${errorMsg}`);
    await logToFile(ERROR_LOG_FILE, `[ERROR] ${errorMsg}`);
  },
  
  api: async (message) => {
    console.log(`[API] ${message}`);
    await logToFile(API_LOG_FILE, `[API] ${message}`);
  },
  
  warn: async (message) => {
    console.warn(`[WARN] ${message}`);
    await logToFile(API_LOG_FILE, `[WARN] ${message}`);
  },

  // Log for specific components/middlewares
  middleware: async (name, message) => {
    console.log(`[MIDDLEWARE:${name}] ${message}`);
    await logToFile(API_LOG_FILE, `[MIDDLEWARE:${name}] ${message}`);
  }
};

module.exports = logger;
