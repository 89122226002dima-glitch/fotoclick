// server.js - Добавлена авторизация через VK с использованием Passport.js

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const session = require('express-session');
const passport = require('passport');
const VKontakteStrategy = require('passport-vkontakte').Strategy;
const { GoogleGenAI, Type, Modality } = require('@google/genai');

// --- Диагностика .env ---
if (process.env.API_KEY) {
  console.log('DIAGNOSTICS: Gemini API_KEY успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная API_KEY не найдена.');
}
if (process.env.VK_CLIENT_ID && process.env.VK_CLIENT_SECRET) {
    console.log('DIAGNOSTICS: VK credentials успешно загружены.');
} else {
    console.warn('DIAGNOSTICS: ПРЕДУПРЕЖДЕНИЕ! VK_CLIENT_ID или VK_CLIENT_SECRET не найдены. Авторизация VK не будет работать.');
}
// --- Конец диагностики ---

const app = express();
const port = process.env.PORT || 3001;

if (!process.env.API_KEY) {
    console.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! API_KEY не найден.');
    process.exit(1);
}

// --- Временное хранилище пользователей в памяти ---
const users = {};
const INITIAL_CREDITS = 1;

// --- Настройка Passport.js и сессий ---
app.use(session({
  secret: process.env.SESSION_SECRET || 'a_very_secret_key_for_fotoclick',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto' } // 'auto' работает и для http, и для https
}));

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser((id, done) => {
  const user = users[id];
  done(null, user);
});

if (process.env.VK_CLIENT_ID && process.env.VK_CLIENT_SECRET) {
    passport.use(new VKontakteStrategy({
        clientID: process.env.VK_CLIENT_ID,
        clientSecret: process.env.VK_CLIENT_SECRET,
        callbackURL: "https://фото-клик.рф/api/auth/vk/callback"
      },
      (accessToken, refreshToken, params, profile, done) => {
        let user = users[profile.id];
        if (!user) {
          user = {
            id: profile.id,
            displayName: profile.displayName,
            credits: INITIAL_CREDITS
          };
          users[profile.id] = user;
          console.log(`[AUTH] New user created: ${user.displayName} (${user.id}) with ${user.credits} credits.`);
        } else {
          console.log(`[AUTH] User logged in: ${user.displayName} (${user.id}).`);
        }
        return done(null, user);
      }
    ));
}

// Middleware для проверки авторизации
const isAuthenticated = (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }
  res.status(401).json({ error: 'Пожалуйста, войдите в систему для выполнения этого действия.' });
};


// --- Инициализация Gemini ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const imageModelName = 'gemini-2.5-flash-image';
const textModelName = 'gemini-2.5-flash';

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const fileToPart = (base64, mimeType) => ({
    inlineData: {
        data: base64,
        mimeType,
    },
});

// Общий обработчик API-запросов
const createApiHandler = (actionLogic, creditsNeeded = 0) => async (req, res) => {
    try {
        if (creditsNeeded > 0) {
            const user = req.user;
            if (user.credits < creditsNeeded) {
                return res.status(402).json({ error: 'Недостаточно кредитов.' });
            }
            user.credits -= creditsNeeded; // Списываем кредиты
        }
        const responsePayload = await actionLogic(req.body);
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error(`API Error in action:`, error);
        if (creditsNeeded > 0 && req.user) req.user.credits += creditsNeeded; // Возвращаем кредиты при ошибке
        if (error.type === 'entity.too.large') {
             return res.status(413).json({ error: 'Загруженное изображение слишком большое.' });
        }
        const errorMessage = error.message || 'Произошла неизвестная ошибка сервера.';
        return res.status(500).json({ error: errorMessage });
    }
};

// --- Маршруты авторизации ---
app.get('/api/auth/vk', passport.authenticate('vkontakte'));
app.get('/api/auth/vk/callback',
  passport.authenticate('vkontakte', { failureRedirect: '/' }),
  (req, res) => {
    res.redirect('/'); // Успешный вход, перенаправляем на главную
  }
);

app.get('/api/me', (req, res) => {
    if (req.isAuthenticated()) {
        res.json(req.user);
    } else {
        res.status(401).json(null);
    }
});

app.post('/api/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) { return next(err); }
        req.session.destroy(() => {
            res.clearCookie('connect.sid'); // Убедимся, что кука сессии удалена
            res.status(200).json({ message: 'Вы успешно вышли.' });
        });
    });
});


// --- API маршруты приложения ---
const generateImageApiCall = async ({ prompt, image }) => {
    const response = await ai.models.generateContent({
        model: imageModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: prompt }] },
        config: {
            responseModalities: [Modality.IMAGE],
        },
    });
    
    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (imagePart && imagePart.inlineData) {
        const { mimeType, data } = imagePart.inlineData;
        return { imageUrl: `data:${mimeType};base64,${data}` };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
};

app.post('/api/generateVariation', isAuthenticated, createApiHandler(generateImageApiCall));

app.post('/api/checkImageSubject', isAuthenticated, createApiHandler(async ({ image }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: 'Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки).' }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, smile: { type: Type.STRING } } }
        }
    });
    const jsonText = response.text.trim();
    const subjectDetails = JSON.parse(jsonText);
    return { subjectDetails };
}));

app.post('/api/analyzeImageForText', isAuthenticated, createApiHandler(async ({ image, analysisPrompt }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: analysisPrompt }] },
    });
    return { text: response.text.trim() };
}));

app.post('/api/generatePhotoshoot', isAuthenticated, createApiHandler(async ({ parts }) => {
    const geminiParts = parts.map(part => part.inlineData ? fileToPart(part.inlineData.data, part.inlineData.mimeType) : part);

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
}, 1)); // Стоимость фотосессии - 1 кредит


// --- Раздача статических файлов ---
const distPath = __dirname;
console.log(`[DIAG] Serving static files from: ${distPath}`);
app.use(express.static(distPath));

app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    res.sendFile(indexPath);
});

app.listen(port, () => {
  console.log(`[INFO] Сервер слушает порт ${port}`);
});