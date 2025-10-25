// server.js - Финальная версия, возвращенная на архитектуру Vertex AI.

// --- ЗАГРУЗКА .ENV ---
// Это самая важная строка. Она загружает переменные из файла .env.
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const { VertexAI } = require('@google-cloud/aiplatform');

// --- Диагностика .env для Vertex AI ---
console.log('DIAGNOSTICS: Загрузка конфигурации из .env');
if (process.env.PROJECT_ID) {
  console.log('DIAGNOSTICS: PROJECT_ID успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная PROJECT_ID не найдена.');
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.log('DIAGNOSTICS: GOOGLE_APPLICATION_CREDENTIALS успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная GOOGLE_APPLICATION_CREDENTIALS не найдена.');
}
// --- Конец диагностики ---

const app = express();
const port = process.env.PORT || 3001;

if (!process.env.PROJECT_ID || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! Не хватает конфигурации для Vertex AI.');
    process.exit(1); // Останавливаем сервер, если нет ключа
}

// --- Инициализация Vertex AI ---
const vertex_ai = new VertexAI({ project: process.env.PROJECT_ID, location: 'us-central1' });
const model = 'gemini-1.5-flash-001';

const generativeModel = vertex_ai.getGenerativeModel({
    model: model,
});


// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Хелпер для преобразования base64 в формат Vertex AI Part
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

// --- API маршруты ---

const generateImageApiCall = async ({ prompt, image }) => {
    const req = {
        contents: [{ role: 'user', parts: [fileToPart(image.base64, image.mimeType), { text: prompt }] }],
    };
    const result = await generativeModel.generateContent(req);
    const response = result.response;
    
    if (response.candidates && response.candidates.length > 0 && response.candidates[0].content.parts[0].inlineData) {
        const inlineData = response.candidates[0].content.parts[0].inlineData;
        return { imageUrl: `data:${inlineData.mimeType};base64,${inlineData.data}` };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
};

app.post('/api/generateVariation', createApiHandler(generateImageApiCall));
app.post('/api/generateWideImage', createApiHandler(generateImageApiCall));

app.post('/api/checkImageSubject', createApiHandler(async ({ image }) => {
    const req = {
        contents: [{ role: 'user', parts: [fileToPart(image.base64, image.mimeType), { text: 'Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки).' }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: 'OBJECT', properties: { category: { type: 'STRING' }, smile: { type: 'STRING' } } }
        }
    };
    const result = await generativeModel.generateContent(req);
    const response = result.response;
    const jsonText = response.candidates[0].content.parts[0].text;
    
    try {
        const subjectDetails = JSON.parse(jsonText);
        if (typeof subjectDetails !== 'object' || subjectDetails === null || !('category' in subjectDetails) || !('smile' in subjectDetails)) {
            throw new Error('Получен некорректный формат данных от AI.');
        }
        return { subjectDetails };
    } catch (e) {
        console.error("Ошибка парсинга JSON от Vertex AI:", jsonText, e);
        throw new Error("Не удалось разобрать ответ от AI. Попробуйте еще раз.");
    }
}));

app.post('/api/analyzeImageForText', createApiHandler(async ({ image, analysisPrompt }) => {
    const req = {
        contents: [{ role: 'user', parts: [fileToPart(image.base64, image.mimeType), { text: analysisPrompt }] }],
    };
    const result = await generativeModel.generateContent(req);
    const response = result.response;
    const text = response.candidates[0].content.parts[0].text;
    return { text: text.trim() };
}));

app.post('/api/generatePhotoshoot', createApiHandler(async ({ parts }) => {
    const vertexParts = parts.map(part => {
        if (part.inlineData) {
            return fileToPart(part.inlineData.data, part.inlineData.mimeType);
        }
        return part; // Для текстовых частей
    });
    
    const req = {
        contents: [{ role: 'user', parts: vertexParts }],
    };
    const result = await generativeModel.generateContent(req);
    const response = result.response;

    if (response.candidates && response.candidates.length > 0 && response.candidates[0].content.parts[0].inlineData) {
        const inlineData = response.candidates[0].content.parts[0].inlineData;
        const resultUrl = `data:${inlineData.mimeType};base64,${inlineData.data}`;
        return { resultUrl, generatedPhotoshootResult: { base64: inlineData.data, mimeType: inlineData.mimeType } };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
}));

// Раздача статических файлов
const distPath = path.join(__dirname, 'dist');
const publicPath = path.join(__dirname, 'public');

app.use(express.static(distPath));
app.use(express.static(publicPath));

// "Catchall" обработчик для SPA
app.get('*', (req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(port, () => {
  console.log(`Сервер слушает порт ${port}`);
});