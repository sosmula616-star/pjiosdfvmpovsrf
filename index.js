require('dotenv').config();
const { createBotClient } = require('./bot/client');
const { createWebServer } = require('./web/server');

const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DOMAIN = process.env.DOMAIN || 'staffbotekssss.bothost.tech';
const TOKEN = process.env.DISCORD_TOKEN;

// 1. Initialize Discord Bot Client
const client = createBotClient();

// 2. Initialize Web Dashboard Server
const app = createWebServer(client);

const server = app.listen(PORT, HOST, () => {
  console.log(`\n======================================================`);
  console.log(`🚀 Musicium Staff Dashboard запущен:`);
  console.log(`🌐 Локальный адрес:  http://localhost:${PORT}`);
  console.log(`🌐 Домен хостинга:   http://${DOMAIN}:${PORT} (или https://${DOMAIN})`);
  console.log(`🔐 Пароль администратора: [Установлен в .env]`);
  console.log(`======================================================\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    const fallbackPort = Number(PORT) + 50;
    console.warn(`⚠️ Порт ${PORT} занят другим процессом. Запуск на резервном порту http://localhost:${fallbackPort}...`);
    app.listen(fallbackPort, () => {
      console.log(`\n======================================================`);
      console.log(`🚀 Musicium Staff Dashboard запущен: http://localhost:${fallbackPort}`);
      console.log(`🔐 Пароль администратора: [Установлен в .env]`);
      console.log(`======================================================\n`);
    });
  } else {
    console.error('Server error:', err);
  }
});

// 3. Connect Discord Bot if token is provided
if (TOKEN && TOKEN !== 'YOUR_DISCORD_BOT_TOKEN_HERE') {
  console.log('[Bot] Подключение к Discord Gateway...');
  client.login(TOKEN).catch(err => {
    console.error('❌ Ошибка авторизации Discord бота:', err.message);
    console.log('👉 Пожалуйста, проверьте DISCORD_TOKEN в файле .env');
  });
} else {
  console.warn('⚠️  Внимание: DISCORD_TOKEN не задан в .env! Веб-панель работает в автономном режиме.');
  console.warn('👉 Укажите токен бота в файле .env для подключения к Discord серверам.');
}

// Global safety error handling
process.on('unhandledRejection', (reason, promise) => {
  console.error('[Anti-Crash Safety] Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[Anti-Crash Safety] Uncaught Exception:', err);
});
