module.exports = {
  apps: [
    {
      name: "UTG_BOX",
      cwd: __dirname,
      script: "pnpm",
      args: "start",
      env_production: {
        NODE_ENV: "production",
      },
      autorestart: true,
      watch: false,
      max_restarts: 10,
      min_uptime: "5s",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      out_file: "logs/pm2.out.log",
      error_file: "logs/pm2.err.log",
    },
  ],
};
