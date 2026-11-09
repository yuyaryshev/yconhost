module.exports = {
  apps: [
    {
      name: "yconhost-terminal-host",
      script: "dist/src/server/terminalHostMain.js",
      cwd: __dirname,
      shutdown_with_message: true,
      wait_ready: true,
      listen_timeout: 15000,
      kill_timeout: 15000,
      env: {
        NODE_ENV: "production",
        YCONHOST_SETTINGS_PATH: require("node:path").join(__dirname, "settings.json5")
      }
    },
    {
      name: "yconhost",
      script: "dist/src/server/index.js",
      cwd: __dirname,
      shutdown_with_message: true,
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        YCONHOST_HOST: "127.0.0.1",
        YCONHOST_PORT: "4011",
        YCONHOST_TERMINAL_MODE: "broker",
        YCONHOST_SETTINGS_PATH: require("node:path").join(__dirname, "settings.json5")
      }
    }
  ]
};
