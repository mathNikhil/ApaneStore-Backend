module.exports = {
  apps: [{
    name: 'apnaestore-backend',
    script: './src/server.js',
    cwd: '/home/ubuntu/apps/ApaneStore-Backend',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '500M',
    restart_delay: 3000,
    env: {
      NODE_ENV: 'production'
    }
  }]
};
