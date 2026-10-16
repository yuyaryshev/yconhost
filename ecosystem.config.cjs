module.exports = {
  apps: [
    {
      name: "yconhost",
      script: "dist/src/server/index.js",
      cwd: __dirname,
      shutdown_with_message: true,
      kill_timeout: 10000,
      env: {
        NODE_ENV: "production",
        YCONHOST_HOST: "127.0.0.1",
        YCONHOST_PORT: "4011"
      }
    }
  ]
};
