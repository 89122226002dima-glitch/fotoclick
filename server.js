// server.js - Наш новый бэкенд для Render.com
import express from 'express';
import cors from 'cors';
import { GoogleGenAI, Modality, Type } from '@google/genai';

const app = express();
const port = process.env.PORT || 3001; // Render предоставит свою переменную PORT

// Middleware
app.use(cors()); // Включаем CORS для всех маршрутов
app.use(express.json({ limit: '10mb' })); // Увеличиваем лимит на размер тела запроса для изображений

// Функция-обработчик для каждого маршрута
const createApiHandler = (actionLogic) => async (req, res) => {
    try {
        if (!process.env.API_KEY) {
            throw new Error('API_KEY environment variable is not set.');
        }
        const ai = new new GoogleGenAI({ apiKey: process.env.API_KEY });
        const responsePayload = await actionLogic(req.body, ai);
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error(`API Error in action:`, error);
        const errorMessage = error.message || 'An unknown server error occurred.';
        return res.status(500).json({ error: errorMessage });
    }
};

// Определяем маршруты API, соответствующие нашим "action"
app.post('/generateVariation', createApiHandler(async (payload, ai) => {
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

app.post('/checkImageSubject', createApiHandler(async (payload, ai) => {
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

app.post('/analyzeImageForText', createApiHandler(async (payload, ai) => {
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

app.post('/generatePhotoshoot', createApiHandler(async (payload, ai) => {
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


// Главная страница для проверки, что сервер работает
app.get('/', (req, res) => {
  res.send('Fotoclick Backend is running!');
});

app.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});