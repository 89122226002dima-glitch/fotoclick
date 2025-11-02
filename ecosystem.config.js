// ecosystem.config.js
module.exports = {
  apps: [{
    name: 'fotoclick',
    script: './dist/server.bundle.js',
    // Это самая важная строчка. Она принудительно задает правильную рабочую папку.
    cwd: '/home/dmitry/fotoclick',
    watch: false,
    env: {
      "NODE_ENV": "production",
    }
  }]
};