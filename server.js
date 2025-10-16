// server.js - Наш новый бэкенд для Replit
import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Modality, Type } from '@google/genai';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors()); // Включаем CORS для всех маршрутов
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит на размер тела запроса для изображений

// Функция-обработчик для каждого маршрута
const createApiHandler = (actionLogic) => async (req, res) => {
    try {
        if (!process.env.API_KEY) {
            throw new Error('API_KEY environment variable is not set. Please add it to Secrets.');
        }
        // Исправлена критическая ошибка: был `new new GoogleGenAI`
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        const responsePayload = await actionLogic(req.body, ai);
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error(`API Error in action:`, error);
        const errorMessage = error.message || 'An unknown server error occurred.';
        return res.status(500).json({ error: errorMessage });
    }
};

// Определяем маршруты API с префиксом /api
app.post('/api/generateVariation', createApiHandler(async (payload, ai) => {
    const { prompt, image } = payload;
    if (!prompt || !image || !image.base64 || !image.mimeType) {
        throw new Error('Missing prompt or image data.');
    }
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }] },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
        return { imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
    } else {
        const blockReason = response?.candidates?.[0]?.finishReason;
        const safetyRatings = response?.candidates?.[0]?.safetyRatings;
        throw new Error(`Image not generated. Reason: ${blockReason}. Safety: ${JSON.stringify(safetyRatings)}`);
    }
}));

app.post('/api/checkImageSubject', createApiHandler(async (payload, ai) => {
    const { image } = payload;
    if (!image || !image.base64 || !image.mimeType) {
        throw new Error('Missing image data.');
    }
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: 'Проанализируй это фото. Определи категорию главного человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип его улыбки (зубы, закрытая, нет улыбки).' }] },
        config: {
            responseMimeType: "application/json",
            responseSchema: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, smile: { type: Type.STRING } }, required: ['category', 'smile'] },
        }
    });
    return { subjectDetails: JSON.parse(response.text.trim()) };
}));

app.post('/api/analyzeImageForText', createApiHandler(async (payload, ai) => {
    const { image, analysisPrompt } = payload;
    if (!image || !analysisPrompt) {
        throw new Error('Missing image or prompt data.');
    }
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: analysisPrompt }] },
    });
    return { text: response.text.trim() };
}));

app.post('/api/generatePhotoshoot', createApiHandler(async (payload, ai) => {
    const { parts } = payload;
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
        throw new Error('Missing parts for generation.');
    }
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
        const resultUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
        return { resultUrl, generatedPhotoshootResult: { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType } };
    } else {
        const blockReason = response?.candidates?.[0]?.finishReason;
        const safetyRatings = response?.candidates?.[0]?.safetyRatings;
        throw new Error(`Image not generated. Reason: ${blockReason}. Safety: ${JSON.stringify(safetyRatings)}`);
    }
}));

// --- Обслуживание статичного фронтенда ---
// Этот код будет работать после того, как вы запустите `npm run build`
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Подаем статические файлы из папки 'dist'
app.use(express.static(path.join(__dirname, '..', 'dist')));

// Для всех остальных GET-запросов, не являющихся API, отдаем index.html
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
});


app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
