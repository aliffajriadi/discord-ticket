// PM2 Ecosystem Config
// Jalankan: pm2 start ecosystem.config.cjs

module.exports = {
  apps: [
    {
      name: "dc-ticket-bot",
      script: "dist/index.js",
      interpreter: "node",

      // Restart otomatis jika crash
      autorestart: true,
      watch: false,
      max_memory_restart: "300M",

      // Environment production
      env: {
        NODE_ENV: "production",
      },

      // Log files
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,

      // Restart delay jika error berulang (exponential backoff)
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
    },
  ],
};
