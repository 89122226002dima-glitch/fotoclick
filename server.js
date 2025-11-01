// server.js - Финальная, стабильная версия. Возвращена на `@google/genai`.

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI, Type, Modality } = require('@google/genai');
const { OAuth2Client } = require('google-auth-library');

// --- Диагностика .env для Gemini ---
console.log('DIAGNOSTICS: Загрузка конфигурации из .env');
if (process.env.API_KEY) {
  console.log('DIAGNOSTICS: API_KEY успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная API_KEY не найдена.');
}
if (process.env.GOOGLE_CLIENT_ID) {
  console.log('DIAGNOSTICS: GOOGLE_CLIENT_ID успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная GOOGLE_CLIENT_ID не найдена. Авторизация не будет работать.');
}
// --- Конец диагностики ---

const app = express();
const port = process.env.PORT || 3001;

if (!process.env.API_KEY || !process.env.GOOGLE_CLIENT_ID) {
    console.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! Одна из критических переменных окружения не найдена.');
    process.exit(1); // Останавливаем сервер, если нет ключа
}

// --- Инициализация клиентов ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const imageModelName = 'gemini-2.5-flash-image';
const textModelName = 'gemini-2.5-flash';
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

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
        const responsePayload = await actionLogic(req.body, req);
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

// --- API маршруты ---

// Маршрут для передачи конфигурации на фронтенд
app.get('/api/config', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(500).json({ error: 'Google Client ID не настроен на сервере.' });
  }
  res.status(200).json({ clientId: process.env.GOOGLE_CLIENT_ID });
});


// Новый маршрут для Google Auth
app.post('/api/auth/google', createApiHandler(async ({ token }) => {
    if (!token) {
        throw new Error('Токен аутентификации не предоставлен.');
    }
    const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) {
        throw new Error('Не удалось верифицировать токен.');
    }
    // Возвращаем фронтенду только нужные данные
    return {
        name: payload.name,
        email: payload.email,
        picture: payload.picture,
    };
}));


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
            throw new Error('Получен некорр...