// server.js - Наш новый бэкенд для Replit
import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Указываем точный путь к .env файлу, чтобы он всегда находился
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
const port = process.env.PORT || 3001;
const host = '127.0.0.1'; // Слушаем только локальные соединения

// Middleware
app.use(cors()); // Включаем CORS для всех маршрутов
app.use(express.json({ limit: '50mb' })); // Увеличиваем лимит на размер тела запроса для изображений

// Функция-обработчик для каждого маршрута
const createApiHandler = (actionLogic) => async (req, res) => {
    try {
        if (!process.env.API_KEY) {
            throw new Error('Ключ API не найден. Убедитесь, что переменная окружения API_KEY установлена на сервере (например, в файле .env).');
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const responsePayload = await actionLogic(req.body, ai);
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error(`API Error in action:`, error);
        const errorMessage = error.message || 'Произошла неизвестная ошибка сервера.';
        return res.status(500).json({ error: errorMessage });
    }
};

// Определяем маршруты API с префиксом /api
app.post('/api/generateVariation', createApiHandler(async (payload, ai) => {
    const { prompt, image } = payload;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }] },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
        return { imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response?.candidates?.[0]?.finishReason}`);
}));

app.post('/api/checkImageSubject', createApiHandler(async (payload, ai) => {
    const { image } = payload;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: 'Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки).' }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, smile: { type: Type.STRING } } }
        }
    });

    const subjectDetailsText = response.text.trim();
    try {
        const subjectDetailsObject = JSON.parse(subjectDetailsText);

        if (typeof subjectDetailsObject !== 'object' || subjectDetailsObject === null || !('category' in subjectDetailsObject) || !('smile' in subjectDetailsObject)) {
            console.error('Некорректный объект получен от Gemini:', subjectDetailsObject);
            throw new Error('Получен некорректный формат данных от AI.');
        }
        
        return { subjectDetails: subjectDetailsObject };

    } catch (e) {
        console.error("Ошибка парсинга JSON от Gemini:", subjectDetailsText, e);
        throw new Error("Не удалось разобрать ответ от AI. Попробуйте еще раз.");
    }
}));


app.post('/api/analyzeImageForText', createApiHandler(async (payload, ai) => {
    const { image, analysisPrompt } = payload;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: analysisPrompt }] },
    });
    return { text: response.text.trim() };
}));

app.post('/api/generatePhotoshoot', createApiHandler(async (payload, ai) => {
    const { parts } = payload;
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
        const resultUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
        return { resultUrl, generatedPhotoshootResult: { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType } };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${response?.candidates?.[0]?.finishReason}`);
}));

// Serve static files from the 'dist' directory
app.use(express.static(path.join(__dirname, 'dist')));

// The "catchall" handler: for any request that doesn't match one above, send back
// the app's index.html file.
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, host, () => {
  console.log(`Сервер слушает на http://${host}:${port}`);
});