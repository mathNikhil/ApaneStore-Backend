module.exports = {
  apps: [{
    name: 'apnaestore-backend',
    script: './src/server.js',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '500M',
    restart_delay: 3000,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
