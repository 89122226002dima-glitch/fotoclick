// server.js - RADICALLY SIMPLIFIED VERSION - NO DATABASE - 31.10.2025

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI, Modality } = require('@google/genai');

const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const winston = require('winston');

// --- Настройка логгера Winston ---
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
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
  logger.add(new winston.transports.Console({ format: winston.format.simple() }));
}

// --- Проверка .env ---
const requiredEnv = ['API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'BASE_URL'];
requiredEnv.forEach(key => {
    if (!process.env[key]) {
        logger.error(`КРИТИЧЕСКАЯ ОШИБКА! Переменная окружения ${key} не найдена. Сервер не может запуститься.`);
        process.exit(1);
    } else {
        logger.info(`Переменная ${key} успешно загружена.`);
    }
});

// --- Настройка Passport.js (БЕЗ БАЗЫ ДАННЫХ) ---
const baseURL = process.env.BASE_URL.replace(/\/$/, '');
const constructedCallbackURL = `${baseURL}/auth/google/callback`;
logger.info(`Passport настроен с callbackURL: [${constructedCallbackURL}]`);

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: constructedCallbackURL
  },
  (accessToken, refreshToken, profile, done) => {
    // Просто возвращаем профиль Google без сохранения в базу
    return done(null, profile);
  }
));

// Сериализуем и десериализуем весь объект пользователя
passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
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
    failureRedirect: '/?login_error=true', 
    failureMessage: true 
  }),
  (req, res) => {
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
    // Создаем объект пользователя на лету, всегда с 999 кредитами
    const userProfile = {
        id: req.user.id,
        email: req.user.emails && req.user.emails[0] ? req.user.emails[0].value : 'no-email',
        displayName: req.user.displayName,
        credits: 999 // Временно даем много кредитов, чтобы фронтенд работал
    };
    res.json({ user: userProfile });
  } else {
    res.json({ user: null });
  }
});

// Промокоды временно отключены
app.post('/api/redeem-promo', ensureAuthenticated, (req, res) => {
    res.status(404).json({ error: "Промокоды временно отключены." });
});

async function makeApiCall(res, action) {
  try {
    const result = await action();
    res.json(result);
  } catch (error) {
    logger.error('Ошибка при вызове Gemini API:', { message: error.message, stack: error.stack });
    res.status(500).json({ error: 'Произошла ошибка при генерации изображения. Попробуйте позже.' });
  }
}

app.post('/api/generateVariation', ensureAuthenticated, async (req, res) => {
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
    return { imageUrl, newCreditCount: 999 }; // Возвращаем фейковый счетчик кредитов
  });
});

app.post('/api/generatePhotoshoot', ensureAuthenticated, async (req, res) => {
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
        return { generatedPhotoshootResult, newCreditCount: 999 }; // Возвращаем фейковый счетчик кредитов
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

// --- Обслуживание статических файлов и SPA ---
const distPath = path.join(process.cwd(), 'dist');
logger.info(`Статические файлы будут отдаваться из папки: ${distPath}`);

app.use(express.static(distPath));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    return res.status(404).send('API endpoint not found');
  }
  
  const indexPath = path.join(distPath, 'index.html');
  logger.info(`Отдаем SPA fallback: ${indexPath} для запроса ${req.path}`);
  res.sendFile(indexPath, (err) => {
    if (err) {
      logger.error(`КРИТИЧЕСКАЯ ОШИБКА: Не удалось найти index.html по пути ${indexPath}.`, err);
      res.status(500).send('Не удалось загрузить главный файл приложения.');
    }
  });
});


// --- Start Server ---
app.listen(port, () => {
    logger.info(`Сервер слушает порт ${port}`);
});