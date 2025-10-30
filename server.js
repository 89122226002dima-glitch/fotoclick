// server.js - Фаза 1: Авторизация пользователей, база данных, сессии.

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI, Type, Modality } = require('@google/genai');

// --- Новые зависимости для авторизации и логирования ---
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Database = require('better-sqlite3');
const winston = require('winston'); // <-- НОВАЯ БИБЛИОТЕКА ЛОГИРОВАНИЯ

// --- Настройка логгера Winston ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'fotoclick-app' },
  transports: [
    // Записываем все ошибки в `error.log`
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    // Записываем все логи уровня info и ниже в `combined.log`
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Если мы не в 'production', также выводим логи в консоль
if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}
// --- Конец настройки логгера ---

// --- Диагностика .env ---
const requiredEnv = ['API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'BASE_URL'];
let missingEnv = false;
requiredEnv.forEach(key => {
    if (!process.env[key]) {
        logger.error(`DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная ${key} не найдена в .env файле.`);
        missingEnv = true;
    } else {
         logger.info(`DIAGNOSTICS: Переменная ${key} успешно загружена.`);
    }
});
if (missingEnv) {
    logger.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! Отсутствуют необходимые переменные окружения. Пожалуйста, проверьте ваш .env файл.');
    process.exit(1);
}
// --- Конец диагностики ---


// --- Настройка Базы Данных (SQLite) ---
const db = new Database('fotoclick.db'); // Убрал verbose, чтобы не засорять логи
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    provider_id TEXT NOT NULL UNIQUE,
    email TEXT UNIQUE,
    displayName TEXT,
    credits INTEGER DEFAULT 5
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS used_promos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    promo_code TEXT NOT NULL,
    used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, promo_code)
  )
`);
logger.info('DIAGNOSTICS: База данных SQLite