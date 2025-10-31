// server.js - Фаза 1: Авторизация пользователей, база данных, сессии.

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI, Type, Modality } = require('@google/genai');

// --- Новые зависимости для авторизации ---
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const Database = require('better-sqlite3');

// --- Диагностика .env ---
const requiredEnv = ['API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'SESSION_SECRET', 'BASE_URL'];
let missingEnv = false;
requiredEnv.forEach(key => {
    if (!process.env[key]) {
        console.error(`DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная ${key} не найдена в .env файле.`);
        missingEnv = true;
    } else {
         console.log(`DIAGNOSTICS: Переменная ${key} успешно загружена.`);
    }
});
if (missingEnv) {
    console.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! Отсутствуют необходимые переменные окружения. Пожалуйста, проверьте ваш .env файл.');
    process.exit(1);
}
// --- Конец диагностики ---


// --- Настройка Базы Данных (SQLite) ---
const db = new Database('fotoclick.db', { verbose: console.log });
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
console.log('DIAGNOSTICS: База данных SQLite успешно подключена и таблицы проверены.');

const app = express();
const port = process.env.PORT || 3001;

// --- Инициализация Gemini ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const imageModelName = 'gemini-2.5-flash-image';
const textModelName = 'gemini-2.5-flash';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 } // 7 дней
}));
app.use(passport.initialize());
app.use(passport.session());

// --- Настройка Passport.js ---
passport.serializeUser((user, done) => {
    done(null, user.id);
});

passport.deserializeUser((id, done) => {
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    done(null, user);
});

const passportVerifyHandler = (provider) => (accessToken, refreshToken, profile, done) => {
    const findUserStmt = db.prepare('SELECT * FROM users WHERE provider = ? AND provider_id = ?');
    let user = findUserStmt.get(provider, profile.id);

    if (user) {
        return done(null, user);
    } else {
        const email = profile.emails && profile.emails[0] ? profile.emails[0].value : null;
        if (email) {
            const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
            if(userByEmail) {
                 const updateUserStmt = db.prepare('UPDATE users SET provider = ?, provider_id = ? WHERE id = ?');
                 updateUserStmt.run(provider, profile.id, userByEmail.id);
                 user = db.prepare('SELECT * FROM users WHERE id = ?').get(userByEmail.id);
                 return done(null, user);
            }
        }
        
        const insertUserStmt = db.prepare('INSERT INTO users (provider, provider_id, email, displayName, credits) VALUES (?, ?, ?, ?, ?)');
        const result = insertUserStmt.run(provider, profile.id, email, profile.displayName, 5);
        user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
        return done(null, user);
    }
};

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: `${process.env.BASE_URL}/auth/google/callback`
}, passportVerifyHandler('google')));

// --- Middleware для проверки авторизации ---
const ensureAuthenticated = (req, res, next) => {
    if (req.isAuthenticated()) {
        return next();
    }
    res.status(401).json({ error: 'Пожалуйста, войдите в систему.' });
};

// --- Маршруты авторизации ---
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));
app.get('/auth/google/callback', passport.authenticate('google', { failureRedirect: '/' }), (req, res) => res.redirect('/'));
app.get('/auth/logout', (req, res, next) => {
    req.logout(err => {
        if (err) { return next(err); }
        res.redirect('/');
    });
});
app.get('/api/user/me', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ user: { id: req.user.id, email: req.user.email, displayName: req.user.displayName, credits: req.user.credits } });
    } else {
        res.json({ user: null });
    }
});

// Новый маршрут для промокодов
app.post('/api/redeem-promo', ensureAuthenticated, (req, res) => {
    const { promoCode } = req.body;
    // В будущем промокоды можно будет хранить в отдельной таблице
    if (promoCode === 'PROMO25') {
        const promoCheckStmt = db.prepare('SELECT id FROM used_promos WHERE user_id = ? AND promo_code = ?');
        const alreadyUsed = promoCheckStmt.get(req.user.id, promoCode);

        if (alreadyUsed) {
            return res.status(409).json({ error: 'Вы уже использовали этот промокод.' });
        }

        // Начисляем кредиты и записываем использование промокода
        db.prepare('UPDATE users SET credits = credits + 25 WHERE id = ?').run(req.user.id);
        db.prepare('INSERT INTO used_promos (user_id, promo_code) VALUES (?, ?)').run(req.user.id, promoCode);
        
        const updatedUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);
        return res.status(200).json({ success: true, message: 'Промокод успешно применен! Начислено 25 кредитов.', newCreditCount: updatedUser.credits });
    } else {
        return res.status(400).json({ error: 'Неверный или истекший промокод.' });
    }
});


// Хелпер для преобразования base64 в формат Gemini Part
const fileToPart = (base64, mimeType) => ({
    inlineData: {
        data: base64,
        mimeType,
    },
});

// Общий обработчик для всех API-запросов Gemini
const createApiHandler = (actionLogic, creditsCost) => async (req, res) => {
    try {
        if (req.user.credits < creditsCost) {
            return res.status(402).json({ error: 'Недостаточно кредитов.' });
        }
        const responsePayload = await actionLogic(req.body);
        
        if (creditsCost > 0) {
            db.prepare('UPDATE users SET credits = credits - ? WHERE id = ?').run(creditsCost, req.user.id);
        }
        
        const updatedUser = db.prepare('SELECT credits FROM users WHERE id = ?').get(req.user.id);

        return res.status(200).json({ ...responsePayload, newCreditCount: updatedUser.credits });

    } catch (error) {
        console.error(`API Error in action:`, error);
        if (error.type === 'entity.too.large') {
             return res.status(413).json({ error: 'Загруженное изображение слишком большое.' });
        }
        const errorMessage = error.message || 'Произошла неизвестная ошибка сервера.';
        return res.status(500).json({ error: errorMessage });
    }
};

// --- API маршруты ---
const generateImageApiCall = async ({ prompt, image }) => {
    const response = await ai.models.generateContent({
        model: imageModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: prompt }] },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (imagePart && imagePart.inlineData) {
        const { mimeType, data } = imagePart.inlineData;
        return { imageUrl: `data:${mimeType};base64,${data}` };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
};

const generatePhotoshootApiCall = async ({ parts }) => {
    const geminiParts = parts.map(part => (part.inlineData ? fileToPart(part.inlineData.data, part.inlineData.mimeType) : part));
    const response = await ai.models.generateContent({
        model: imageModelName,
        contents: { parts: geminiParts },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (imagePart && imagePart.inlineData) {
        const { mimeType, data } = imagePart.inlineData;
        const resultUrl = `data:${mimeType};base64,${data}`;
        return { resultUrl, generatedPhotoshootResult: { base64: data, mimeType: mimeType } };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
};

// --- Незащищенные API (не требуют кредитов) ---
app.post('/api/checkImageSubject', createApiHandler(async ({ image }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: 'Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки).' }] },
        config: { responseMimeType: "application/json", responseSchema: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, smile: { type: Type.STRING } } } }
    });
    try {
        const jsonText = response.text.trim();
        const subjectDetails = JSON.parse(jsonText);
        if (typeof subjectDetails !== 'object' || subjectDetails === null || !('category' in subjectDetails) || !('smile' in subjectDetails)) {
            throw new Error('Получен некорректный формат данных от AI.');
        }
        return { subjectDetails };
    } catch (e) {
        console.error("Ошибка парсинга JSON от Gemini:", response.text, e);
        throw new Error("Не удалось разобрать ответ от AI. Попробуйте еще раз.");
    }
}, 0));

app.post('/api/analyzeImageForText', createApiHandler(async ({ image, analysisPrompt }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: analysisPrompt }] },
    });
    return { text: response.text.trim() };
}, 0));


// --- Защищенные API (требуют кредиты) ---
app.post('/api/generateVariation', ensureAuthenticated, createApiHandler(generateImageApiCall, 1));
app.post('/api/generatePhotoshoot', ensureAuthenticated, createApiHandler(generatePhotoshootApiCall, 1));


// Раздача статических файлов
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));
app.get('*', (req, res) => res.sendFile(path.join(distPath, 'index.html')));

app.listen(port, () => {
  console.log(`Сервер слушает порт ${port}`);
});