// server.js - Финальная, стабильная версия. Возвращена на `@google/genai`.

const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { GoogleGenAI, Type, Modality } = require('@google/genai');

// --- Диагностика .env для Gemini ---
console.log('DIAGNOSTICS: Загрузка конфигурации из .env');
if (process.env.API_KEY) {
  console.log('DIAGNOSTICS: API_KEY успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная API_KEY не найдена.');
}
// --- Конец диагностики ---

const app = express();
const port = process.env.PORT || 3001;

if (!process.env.API_KEY) {
    console.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! API_KEY не найден. Сервер не сможет работать.');
    process.exit(1); // Останавливаем сервер, если нет ключа
}

// --- Инициализация Gemini ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const imageModelName = 'gemini-2.5-flash-image';
const textModelName = 'gemini-2.5-flash';

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


// Раздача статических файлов
// ИСПРАВЛЕНИЕ: Используем process.cwd(), так как PM2 запускается из корня проекта.
const projectRoot = process.cwd();
const distPath = path.join(projectRoot, 'dist');
const publicPath = path.join(projectRoot, 'public');

app.use(express.static(distPath));
app.use(express.static(publicPath));

// "Catchall" обработчик для SPA
app.get('*', (req, res) => {
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