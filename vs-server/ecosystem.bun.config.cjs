// pm2 config for the Bun runtime: pm2 start ecosystem.bun.config.cjs
module.exports = {
  apps: [
    {
      name: 'sev7en-vs',
      interpreter: 'bun',
      script: 'server.bun.js',
      cwd: __dirname,
      env: {
        PORT: 3001,
        ADMIN_PASSWORD: 'sev7en-admin',
        NODE_ENV: 'production',
      },
    },
  ],
};
