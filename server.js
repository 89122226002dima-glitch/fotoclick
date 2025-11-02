// server.js - Финальная, стабильная версия. Возвращена на `@google/genai`.

const express = require('express');
const cors = require('cors');
const path = require('path');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const { OAuth2Client } = require('google-auth-library');
// ВАЖНО: Указываем правильный путь к .env файлу, когда скрипт запускается из папки 'dist'
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const { GoogleGenAI, Type, Modality } = require('@google/genai');

// --- Диагностика .env для Gemini ---
console.log('DIAGNOSTICS: Загрузка конфигурации из .env');
if (process.env.API_KEY) {
  console.log('DIAGNOSTICS: API_KEY успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная API_KEY не найдена.');
}
if (process.env.GOOGLE_CLIENT_ID) console.log('DIAGNOSTICS: GOOGLE_CLIENT_ID загружен.');
else console.warn('DIAGNOSTICS: ПРЕДУПРЕЖДЕНИЕ: GOOGLE_CLIENT_ID не найден. Авторизация не будет работать.');
// --- Конец диагностики ---

const app = express();
const port = process.env.PORT || 3001;

if (!process.env.API_KEY || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.SESSION_SECRET) {
    console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Одна или несколько переменных окружения (API_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, SESSION_SECRET) отсутствуют. Сервер не может запуститься.');
    process.exit(1); // Останавливаем сервер, если нет ключей
}

// --- Инициализация Gemini ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const imageModelName = 'gemini-2.5-flash-image';
const textModelName = 'gemini-2.5-flash';

// --- Инициализация Google OAuth Client ---
const oAuth2Client = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  '/auth/google/callback' // Redirect URI path. Host/port are determined by Google based on where request comes from.
);


// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
        maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    }
}));


// Хелпер для преобразования base64 в формат Gemini Part
const fileToPart = (base64, mimeType) => ({
    inlineData: {
        data: base64,
        mimeType,
    },
});

// Общий обработчик для всех API-запросов
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
        
        // Получаем информацию о пользователе из ID-токена
        const ticket = await oAuth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        
        const user = {
            name: payload.name,
            email: payload.email,
        };
        
        req.session.user = user; // Сохраняем пользователя в сессию
        res.redirect('/'); // Перенаправляем на главную страницу
    } catch (error) {
        console.error('Ошибка при аутентификации Google:', error);
        res.redirect('/?auth_error=true'); // В случае ошибки, возвращаем на главную с параметром
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
        res.clearCookie('connect.sid'); // connect.sid - имя куки по умолчанию для express-session
        res.status(200).json({ message: 'Выход выполнен успешно' });
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
    
    // Проверяем, есть ли изображение в ответе
    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (imagePart && imagePart.inlineData) {
        const { mimeType, data } = imagePart.inlineData;
        return { imageUrl: `data:${mimeType};base64,${data}` };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
};

app.post('/api/generateVariation', createApiHandler(generateImageApiCall));

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
}));

app.post('/api/analyzeImageForText', createApiHandler(async ({ image, analysisPrompt }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: analysisPrompt }] },
    });
    return { text: response.text.trim() };
}));

app.post('/api/generatePhotoshoot', createApiHandler(async ({ parts }) => {
    const geminiParts = parts.map(part => {
        if (part.inlineData) {
            return fileToPart(part.inlineData.data, part.inlineData.mimeType);
        }
        return part; // Для текстовых частей
    });

    const response = await ai.models.generateContent({
        model: imageModelName,
        contents: { parts: geminiParts },
        config: {
            responseModalities: [Modality.IMAGE],
        },
    });
    
    const imagePart = response.candidates?.[0]?.content?.parts?.find(part => part.inlineData);
    if (imagePart && imagePart.inlineData) {
        const { mimeType, data } = imagePart.inlineData;
        const resultUrl = `data:${mimeType};base64,${data}`;
        return { resultUrl, generatedPhotoshootResult: { base64: data, mimeType: mimeType } };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
}));


// Раздача статических файлов - ИСПРАВЛЕННЫЕ ПУТИ
// Когда скрипт запущен из /dist, __dirname указывает на /dist.
// Все собранные файлы фронтенда (index.html, assets) находятся прямо здесь.
const distPath = __dirname;
// Папка 'public' находится на один уровень выше, в корне проекта.
const publicPath = path.join(__dirname, '..', 'public');

app.use(express.static(distPath));
app.use(express.static(publicPath));

// "Catchall" обработчик для SPA
app.get('*', (req, res) => {
    // index.html теперь находится прямо в distPath (который = __dirname)
    const indexPath = path.join(distPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error(`Error sending file: ${indexPath}`, err);
            res.status(500).send('Error serving the application.');
        }
    });
});

app.listen(port, () => {
  console.log(`Сервер слушает порт ${port}`);
});
