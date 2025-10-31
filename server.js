// server.js - Финальная, надежная версия с улучшенной диагностикой.

const express = require('express');
const cors = require('cors');
const path = require('path');
// Модуль punycode больше не нужен, так как мы используем BASE_URL напрямую
require('dotenv').config();
const { GoogleGenAI, Type, Modality } = require('@google/genai');

const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Database = require('better-sqlite3');
const winston = require('winston');

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
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// --- Диагностика .env ---
const requiredEnv = ['API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'BASE_URL'];
let missingEnv = false;
requiredEnv.forEach(key => {
    if (!process.env[key]) {
        const currentTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        logger.error(`[${currentTime}] DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная ${key} не найдена.`);
        missingEnv = true;
    } else {
        // ФИНАЛЬНАЯ ДИАГНОСТИКА: выводим значение ключа
        if (key === 'GOOGLE_CLIENT_ID' || key === 'BASE_URL') {
            logger.info(`DIAGNOSTICS: Переменная ${key} успешно загружена. Значение: [${process.env[key]}]`);
        } else {
            logger.info(`DIAGNOSTICS: Переменная ${key} успешно загружена.`);
        }
    }
});
if (missingEnv) {
    const currentTime = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    logger.error(`[${currentTime}] DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! Отсутствуют переменные окружения.`);
    process.exit(1);
}

// --- Настройка Базы Данных (SQLite) ---
const db = new Database('fotoclick.db');
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
logger.info('DIAGNOSTICS: База данных SQLite успешно подключена и таблицы проверены.');

// --- Настройка Passport.js ---
// ИЗМЕНЕНО: Полностью убрана логика конвертации. Используем BASE_URL из .env напрямую.
// Это решает проблему сбоя и двойного кодирования.
const baseURL = process.env.BASE_URL.replace(/\/$/, ''); // Убираем слэш в конце, если он есть
const constructedCallbackURL = `${baseURL}/auth/google/callback`;

logger.info(`DIAGNOSTICS: Используем BASE_URL из .env: [${baseURL}]`);
logger.info(`DIAGNOSTICS: Passport настроен с callbackURL: [${constructedCallbackURL}]`);

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: constructedCallbackURL
  },
  (accessToken, refreshToken, profile, done) => {
    const user = db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?').get('google', profile.id);
    if (user) {
      return done(null, user);
    } else {
      const newUser = db.prepare(`
        INSERT INTO users (provider, provider_id, email, displayName) VALUES (?, ?, ?, ?)
      `).run('google', profile.id, profile.emails[0].value, profile.displayName);
      const createdUser = db.prepare('SELECT * FROM users WHERE id = ?').get(newUser.lastInsertRowid);
      return done(null, createdUser);
    }
  }
));

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  done(null, user);
});

const app = express();
const port = 3001;

// --- Middlewares ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } 
}));
app.use(passport.initialize());
app.use(passport.session());

// --- Инициализация Gemini API ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// --- Middleware для проверки аутентификации ---
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Пользователь не авторизован' });
}

// --- Маршруты авторизации ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback', 
  passport.authenticate('google', { 
    // ВАЖНО: При ошибке редиректим на главную с параметром, который отловит фронтенд
    failureRedirect: '/?login_error=true', 
    failureMessage: true 
  }),
  (req, res) => {
    // При успехе редиректим на главную страницу
    res.redirect('/');
  }
);

app.get('/auth/logout', (req, res, next) => {
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// --- API маршруты ---
app.get('/api/user/me', (req, res) => {
  if (req.isAuthenticated()) {
    res.json({ user: { id: req.user.id, email: req.user.email, displayName: req.user.displayName, credits: req.user.credits } });
  } else {
    // Используем статус 200, чтобы не показывать ошибку в консоли, фронтенд обработает null
    res.json({ user: null });
  }
});

app.post('/api/redeem-promo', ensureAuthenticated, (req, res) => {
    const { promoCode } = req.body;
    const userId = req.user.id;
    if (promoCode !== "FOTOSTART50") {
        return res.status(400).json({ error: "Неверный промокод." });
    }
    const alreadyUsed = db.prepare('SELECT * FROM used_promos WHERE user_id = ? AND promo_code = ?').get(userId, promoCode);
    if (alreadyUsed) {
        return res.status(409).json({ error: "Вы уже использовали этот промокод." });
    }
    db.prepare('UPDATE users SET credits = credits + 50 WHERE id = ?').run(userId);
    db.prepare('INSERT INTO used_promos (user_id, promo_code) VALUES (?, ?)').run(userId, promoCode);
    const updatedUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
    res.json({ message: "Промокод успешно применен! +50 кредитов.", newCreditCount: updatedUser.credits });
});

async function makeApiCall(res, action) {
  try {
    const result = await action();
    res.json(result);
  } catch (error) {
    logger.error('Ошибка при вызове Gemini API:', error);
    res.status(500).json({ error: 'Произошла ошибка при генерации изображения. Попробуйте позже.' });
  }
}

function deductCredits(userId, amount) {
    const user = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
    if (user.credits < amount) {
        return { success: false, error: "Недостаточно кредитов." };
    }
    db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(amount, userId);
    const updatedUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
    return { success: true, newCreditCount: updatedUser.credits };
}

app.post('/api/generateVariation', ensureAuthenticated, async (req, res) => {
  const creditCheck = deductCredits(req.user.id, 1);
  if (!creditCheck.success) return res.status(402).json({ error: creditCheck.error });
  
  await makeApiCall(res, async () => {
    const { prompt, image } = req.body;
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: {
        parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }],
      },
      config: { responseModalities: [Modality.IMAGE] },
    });
    const resultPart = response.candidates[0].content.parts[0];
    const imageUrl = `data:${resultPart.inlineData.mimeType};base64,${resultPart.inlineData.data}`;
    return { imageUrl, newCreditCount: creditCheck.newCreditCount };
  });
});

app.post('/api/generatePhotoshoot', ensureAuthenticated, async (req, res) => {
    const creditCheck = deductCredits(req.user.id, 1);
    if (!creditCheck.success) return res.status(402).json({ error: creditCheck.error });
    
    await makeApiCall(res, async () => {
        const { parts } = req.body;
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: parts },
            config: { responseModalities: [Modality.IMAGE] }
        });

        const resultPart = response.candidates[0].content.parts[0];
        const generatedPhotoshootResult = {
            base64: resultPart.inlineData.data,
            mimeType: resultPart.inlineData.mimeType
        };
        return { generatedPhotoshootResult, newCreditCount: creditCheck.newCreditCount };
    });
});

app.post('/api/checkImageSubject', ensureAuthenticated, async (req, res) => {
    await makeApiCall(res, async () => {
        const { image } = req.body;
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              { inlineData: { data: image.base64, mimeType: image.mimeType } },
              { text: "Проанализируй фото. На нем изображен мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок или другое? Улыбается ли человек с показом зубов, с закрытым ртом или не улыбается? Ответ дай в формате JSON: {\"category\": \"значение\", \"smile\": \"значение\"} где значение для smile: 'зубы', 'закрытая', 'нет улыбки'. Не добавляй ```json." }
            ]
          },
          config: { responseMimeType: "application/json" }
        });
        const jsonString = response.text.trim();
        const subjectDetails = JSON.parse(jsonString);
        return { subjectDetails };
    });
});

app.post('/api/analyzeImageForText', ensureAuthenticated, async (req, res) => {
    await makeApiCall(res, async () => {
        const { image, analysisPrompt } = req.body;
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              { inlineData: { data: image.base64, mimeType: image.mimeType } },
              { text: analysisPrompt }
            ]
          }
        });
        return { text: response.text };
    });
});

// --- Обслуживание статических файлов и SPA (ФИНАЛЬНАЯ ВЕРСИЯ) ---
const distPath = path.join(process.cwd(), 'dist');
logger.info(`DIAGNOSTICS: Статические файлы будут отдаваться из папки: ${distPath}`);

// 1. Обслуживаем все статические файлы (JS, CSS, картинки) из папки 'dist'.
// Это должно обработать запросы типа /index.css, /assets/index-....js и т.д.
app.use(express.static(distPath));

// 2. Для ВСЕХ остальных GET-запросов, которые не являются API-вызовами
// и для которых не нашелся статический файл, мы отдаем главный 'index.html'.
// Это "catch-all" маршрут для одностраничного приложения (SPA).
app.get('*', (req, res) => {
  // Исключаем API и auth маршруты из этого правила, чтобы они не перехватывались.
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    // В Express 4, если маршрут не найден, он автоматически перейдет к следующему обработчику ошибок.
    // Если мы здесь, значит, ни один из API маршрутов не совпал.
    return res.status(404).send('API endpoint not found');
  }
  
  const indexPath = path.join(distPath, 'index.html');
  logger.info(`DIAGNOSTICS: Отдаем SPA fallback: ${indexPath} для запроса ${req.path}`);
  res.sendFile(indexPath, (err) => {
    if (err) {
      logger.error(`DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА: Не удалось найти index.html по пути ${indexPath}.`, err);
      res.status(500).send('Не удалось загрузить главный файл приложения.');
    }
  });
});

app.listen(port, () => {
  logger.info(`Сервер слушает порт ${port}`);
});