// server.js - Версия с исправленной логикой путей.

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config(); // Load .env file at the very top
const { GoogleGenAI, Type, Modality } = require('@google/genai');
const { OAuth2Client } = require('google-auth-library');

// --- START: Улучшенная диагностика и проверка переменных ---
const requiredEnvVars = ['API_KEY', 'GOOGLE_CLIENT_ID'];
const missingEnvVars = requiredEnvVars.filter(key => !process.env[key]);

if (missingEnvVars.length > 0) {
    console.error(`---`.repeat(10));
    console.error(`КРИТИЧЕСКАЯ ОШИБКА ЗАПУСКА СЕРВЕРА!`);
    console.error(`Следующие переменные окружения отсутствуют в .env файле: ${missingEnvVars.join(', ')}`);
    console.error(`Пожалуйста, проверьте ваш .env файл и убедитесь, что он содержит все необходимые переменные.`);
    console.error(`Пример .env файла:`);
    console.error(`API_KEY=AIzaSy... (ваш ключ Gemini)`);
    console.error(`GOOGLE_CLIENT_ID=...apps.googleusercontent.com (ваш Google Client ID)`);
    console.error(`---`.repeat(10));
    process.exit(1); // Останавливаем сервер
}

console.log(`DIAGNOSTICS [v2]: Все переменные окружения (API_KEY, GOOGLE_CLIENT_ID) успешно загружены.`);
// --- END: Диагностика ---

const app = express();
const port = process.env.PORT || 3001;

// --- Инициализация клиентов ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const imageModelName = `gemini-2.5-flash-image`;
const textModelName = `gemini-2.5-flash`;
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
             return res.status(413).json({ error: `Загруженное изображение слишком большое.` });
        }
        const errorMessage = error.message || `Произошла неизвестная ошибка сервера.`;
        return res.status(500).json({ error: errorMessage });
    }
};

// --- API маршруты ---

// Маршрут для передачи конфигурации на фронтенд
app.get(`/api/config`, (req, res) => {
  res.status(200).json({ clientId: process.env.GOOGLE_CLIENT_ID });
});


// Новый маршрут для Google Auth
app.post(`/api/auth/google`, createApiHandler(async ({ token }) => {
    if (!token) {
        throw new Error(`Токен аутентификации не предоставлен.`);
    }
    const ticket = await googleClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload) {
        throw new Error(`Не удалось верифицировать токен.`);
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

app.post(`/api/generateVariation`, createApiHandler(generateImageApiCall));

app.post(`/api/checkImageSubject`, createApiHandler(async ({ image }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: `Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки).` }] },
        config: {
            responseMimeType: `application/json`,
            responseSchema: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, smile: { type: Type.STRING } } }
        }
    });

    try {
        const jsonText = response.text.trim();
        const subjectDetails = JSON.parse(jsonText);
        if (typeof subjectDetails !== `object` || subjectDetails === null || !(`category` in subjectDetails) || !(`smile` in subjectDetails)) {
            throw new Error(`Получен некорректный JSON от модели.`);
        }
        return { subjectDetails };
    } catch (e) {
        console.error(`Ошибка парсинга JSON от Gemini:`, response.text);
        throw new Error(`Не удалось разобрать ответ от AI. Попробуйте еще раз.`);
    }
}));

app.post(`/api/analyzeImageForText`, createApiHandler(async ({ image, analysisPrompt }) => {
    const response = await ai.models.generateContent({
        model: textModelName,
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: analysisPrompt }] }
    });
    return { text: response.text.trim() };
}));

app.post(`/api/generatePhotoshoot`, createApiHandler(async ({ parts }) => {
    // Преобразуем массив parts с фронтенда в формат, понятный Gemini SDK
    const geminiParts = parts.map(part => {
        if (part.text) {
            return { text: part.text };
        }
        if (part.inlineData) {
            return fileToPart(part.inlineData.data, part.inlineData.mimeType);
        }
        return null;
    }).filter(Boolean); // Убираем null значения, если они есть

    if (geminiParts.length === 0) {
        throw new Error(`Не предоставлено данных для генерации фотосессии.`);
    }

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
        return {
            resultUrl: `data:${mimeType};base64,${data}`,
            generatedPhotoshootResult: { base64: data, mimeType: mimeType }
        };
    }
    throw new Error(`Изображение для фотосессии не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
}));

// --- Обслуживание статических файлов и SPA (ИСПРАВЛЕННАЯ ЛОГИКА) ---
// Прямой и надежный способ указать путь к статическим файлам.
// Так как server.bundle.js находится внутри папки 'dist',
// __dirname указывает прямо на эту папку.
const distPath = path.resolve(__dirname);
console.log(`[Server Info] Обслуживание статических файлов из папки: ${distPath}`);
app.use(express.static(distPath));

// Для всех GET-запросов, не относящихся к API, отдаем index.html
app.get(`*`, (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error(`[Server Error] Не удалось отправить index.html. Путь: ${indexPath}`, err);
            res.status(500).send(`
                <h1>Ошибка сервера 500</h1>
                <p>Не удалось найти главный файл приложения (index.html).</p>
                <p>Проверьте, что сборка проекта (npm run build) прошла успешно.</p>
                <hr>
                <pre>Ожидаемый путь: ${indexPath}</pre>
                <pre>Ошибка: ${err.message}</pre>
            `);
        }
    });
});


// --- Запуск сервера ---
app.listen(port, () => {
    console.log(`Сервер 'Фото-Клик' запущен на порту ${port}`);
});
