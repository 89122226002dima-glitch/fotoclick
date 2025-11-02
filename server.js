// server.js - Финальная исправленная версия

const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { OAuth2Client } = require('google-auth-library');
const { GoogleGenAI, Type, Modality } = require('@google/genai');

// --- ШАГ 1: ОПРЕДЕЛЕНИЕ ПУТИ И ЗАГРУЗКА .ENV ---
// Определяем абсолютный путь к файлу .env, который лежит на один уровень выше, чем папка dist, где будет этот скрипт.
const envPath = path.resolve(__dirname, '..', '.env');
require('dotenv').config({ path: envPath });

// --- ШАГ 2: КРИТИЧЕСКАЯ ПРОВЕРКА ПЕРЕМЕННЫХ ---
// Если хотя бы одна из ключевых переменных отсутствует, сервер не сможет работать.
// Мы немедленно останавливаем процесс с информативным сообщением.
if (!process.env.API_KEY || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.SESSION_SECRET) {
    console.error('DIAGNOSTICS [v3]: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! Отсутствуют необходимые переменные окружения. Проверьте ваш .env файл и его содержимое.');
    console.error(`DIAGNOSTICS [v3]: Ожидаемый путь к .env: ${envPath}`);
    process.exit(1); // Останавливаем сервер
}
console.log('DIAGNOSTICS [v3]: Все переменные окружения (API_KEY, GOOGLE_CLIENT_ID) успешно загружены.');

// --- ШАГ 3: ИНИЦИАЛИЗАЦИЯ КЛИЕНТОВ ПОСЛЕ УСПЕШНОЙ ЗАГРУЗКИ КЛЮЧЕЙ ---
// Теперь, когда мы уверены, что process.env содержит все ключи, мы можем безопасно инициализировать клиенты.
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const imageModelName = 'gemini-2.5-flash-image';
const textModelName = 'gemini-2.5-flash';

const oAuth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  '/auth/google/callback' // Redirect URI
);

// --- НАСТРОЙКА ПРИЛОЖЕНИЯ EXPRESS ---
const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 1000 * 60 * 60 * 24 * 7 // 7 дней
    }
}));


const fileToPart = (base64, mimeType) => ({
    inlineData: {
        data: base64,
        mimeType,
    },
});

const createApiHandler = (actionLogic) => async (req, res) => {
    try {
        const responsePayload = await actionLogic(req.body);
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error(`API Error in action:`, error);
        if (error.type === 'entity.too.large') {
             return res.status(413).json({ error: 'Загруженное изображение слишком большое.' });
        }
        const errorMessage = error.message || 'Произошла неизвестная ошибка сервера.';
        return res.status(500).json({ error: errorMessage });
    }
};

// --- Маршруты аутентификации ---

app.get('/auth/google', (req, res) => {
    const authorizeUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: [
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email',
        ],
    });
    res.redirect(authorizeUrl);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oAuth2Client.getToken(code);
        oAuth2Client.setCredentials(tokens);
        
        const ticket = await oAuth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        const user = { name: payload.name, email: payload.email };
        
        req.session.user = user;
        res.redirect('/');
    } catch (error) {
        console.error('Ошибка при аутентификации Google:', error);
        res.redirect('/?auth_error=true');
    }
});

app.get('/api/me', (req, res) => {
    if (req.session.user) {
        res.json(req.session.user);
    } else {
        res.status(401).json({ error: 'Не авторизован' });
    }
});

app.post('/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            return res.status(500).json({ error: 'Не удалось выйти из системы' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Выход выполнен успешно' });
    });
});

// --- API маршруты приложения ---

app.post('/api/generateVariation', createApiHandler(async ({ prompt, image }) => {
    const response = await ai.models.generateContent({
        model: imageModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: prompt }] },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (imagePart?.inlineData) {
        const { mimeType, data } = imagePart.inlineData;
        return { imageUrl: `data:${mimeType};base64,${data}` };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
}));

app.post('/api/checkImageSubject', createApiHandler(async ({ image }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: 'Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки).' }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, smile: { type: Type.STRING } } }
        }
    });
    try {
        const subjectDetails = JSON.parse(response.text.trim());
        if (typeof subjectDetails !== 'object' || !subjectDetails || !('category' in subjectDetails) || !('smile' in subjectDetails)) {
            throw new Error('Получен некорректный формат данных от AI.');
        }
        return { subjectDetails };
    } catch (e) {
        console.error("Ошибка парсинга JSON от Gemini:", response.text, e);
        throw new Error("Не удалось разобрать ответ от AI. Попробуйте еще раз.");
    }
}));

app.post('/api/analyzeImageForText', createApiHandler(async ({ image, analysisPrompt }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: analysisPrompt }] },
    });
    return { text: response.text.trim() };
}));

app.post('/api/generatePhotoshoot', createApiHandler(async ({ parts }) => {
    const geminiParts = parts.map(part => part.inlineData ? fileToPart(part.inlineData.data, part.inlineData.mimeType) : part);
    const response = await ai.models.generateContent({
        model: imageModelName,
        contents: { parts: geminiParts },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (imagePart?.inlineData) {
        const { mimeType, data } = imagePart.inlineData;
        return { resultUrl: `data:${mimeType};base64,${data}`, generatedPhotoshootResult: { base64: data, mimeType: mimeType } };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
}));


// --- Раздача статических файлов ---
const distPath = path.resolve(__dirname); // Папка dist
const publicPath = path.resolve(__dirname, '..', 'public'); // Папка public

app.use(express.static(distPath));
console.log(`[Server Info] Обслуживание статических файлов из папки: ${distPath}`);
app.use(express.static(publicPath));
console.log(`[Server Info] Обслуживание статических файлов из папки: ${publicPath}`);


// "Catchall" обработчик для SPA (Single Page Application)
app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error(`[CRITICAL] Ошибка отправки файла index.html из ${indexPath}`, err);
            res.status(500).send('Ошибка сервера: не удалось обслужить приложение.');
        }
    });
});

app.listen(port, () => {
  console.log(`[Server Info] Сервер 'Фото-Клик' запущен на порту ${port}`);
});
