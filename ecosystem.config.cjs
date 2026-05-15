module.exports = {
  apps: [
    {
      name: "yconhost",
      script: "dist/server/index.js",
      cwd: __dirname,
      env: {
        NODE_ENV: "production",
        YCONHOST_HOST: "127.0.0.1",
        YCONHOST_PORT: "4000"
      }
    }
  ]
};
