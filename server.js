// server.js - Новая, стабильная версия на @google/genai

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

// --- Кардинальное решение проблемы 'MODULE_NOT_FOUND' ---
// Используем require.resolve, чтобы получить абсолютный путь к модулю.
// Это обходит возможные проблемы с разрешением путей в среде PM2.
const genAiPath = require.resolve('@google/genai');
const { GoogleGenAI, Modality, Type } = require(genAiPath);


// --- Диагностика .env ---
console.log('DIAGNOSTICS: Загрузка конфигурации из .env');
if (process.env.API_KEY) {
  console.log('DIAGNOSTICS: Переменная API_KEY найдена в файле .env.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная API_KEY не найдена. Сервер не сможет работать.');
}
// --- Конец диагностики ---

const app = express();
const port = process.env.PORT || 3001;

// --- Инициализация Gemini AI ---
if (!process.env.API_KEY) {
    console.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! API_KEY не найден.');
    process.exit(1); // Останавливаем сервер, если нет ключа
}
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Хелпер для преобразования base64 в формат Gemini Part
const fileToPart = (base64, mimeType) => ({
    inlineData: {
        mimeType,
        data: base64,
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
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: { parts: [fileToPart(image.base64, image.mimeType), { text: prompt }] },
      config: { responseModalities: [Modality.IMAGE] }
    });
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            return { imageUrl: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` };
        }
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
};

app.post('/api/generateVariation', createApiHandler(generateImageApiCall));
app.post('/api/generateWideImage', createApiHandler(generateImageApiCall));

app.post('/api/checkImageSubject', createApiHandler(async ({ image }) => {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [fileToPart(image.base64, image.mimeType), { text: 'Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки).' }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: { type: Type.OBJECT, properties: { category: { type: 'STRING' }, smile: { type: 'STRING' } } }
        }
    });
    const jsonText = response.text;
    try {
        const subjectDetails = JSON.parse(jsonText);
        if (typeof subjectDetails !== 'object' || subjectDetails === null || !('category' in subjectDetails) || !('smile' in subjectDetails)) {
            throw new Error('Получен некорректный формат данных от AI.');
        }
        return { subjectDetails };
    } catch (e) {
        console.error("Ошибка парсинга JSON от Gemini AI:", jsonText, e);
        throw new Error("Не удалось разобрать ответ от AI. Попробуйте еще раз.");
    }
}));

app.post('/api/analyzeImageForText', createApiHandler(async ({ image, analysisPrompt }) => {
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
      model: 'gemini-2.5-flash-image',
      contents: { parts: geminiParts },
      config: { responseModalities: [Modality.IMAGE] }
    });
    
    for (const part of response.candidates[0].content.parts) {
        if (part.inlineData) {
            const resultUrl = `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
            return { resultUrl, generatedPhotoshootResult: { base64: part.inlineData.data, mimeType: part.inlineData.mimeType } };
        }
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