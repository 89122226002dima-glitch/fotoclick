// Этот файл теперь является основным бэкендом, работающим на Vercel.
// Он принимает запросы от фронтенда, вызывает Gemini API и возвращает результат.

import { GoogleGenAI, Modality, Type } from '@google/genai';

// Максимальное время выполнения функции на Vercel (Hobby plan) ~15 секунд.
export const maxDuration = 15; 

// Инициализация CORS - позволяет нашему сайту обращаться к этой функции
const allowCors = fn => (req, res) => {
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*'); // Разрешаем все источники
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }
    return fn(req, res);
};

// Основной обработчик запросов
async function handler(req, res) {
    // Разрешаем только POST запросы
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // API-ключ должен быть установлен как переменная окружения в Vercel
        if (!process.env.API_KEY) {
            throw new Error('API_KEY environment variable is not set.');
        }
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
        
        const { action, ...payload } = req.body;

        let responsePayload;

        switch (action) {
            case 'generateVariation': {
                const { prompt, image } = payload;
                if (!prompt || !image || !image.base64 || !image.mimeType) {
                    return res.status(400).json({ error: 'Missing prompt or image data for generateVariation.' });
                }
                const response = await ai.models.generateContent({
                  model: 'gemini-2.5-flash-image',
                  contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }] },
                  config: { responseModalities: [Modality.IMAGE] },
                });
                const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                if (imagePart?.inlineData) {
                  responsePayload = { imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
                } else {
                  throw new Error('Image not found in model response.');
                }
                break;
            }
              
            case 'checkImageSubject': {
                const { image } = payload;
                if (!image || !image.base64 || !image.mimeType) {
                    return res.status(400).json({ error: 'Missing image data for checkImageSubject.' });
                }
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: 'Проанализируй это фото. Определи категорию главного человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип его улыбки (зубы, закрытая, нет улыбки).' }] },
                    config: {
                        responseMimeType: "application/json",
                        responseSchema: { type: Type.OBJECT, properties: { category: { type: Type.STRING }, smile: { type: Type.STRING } }, required: ['category', 'smile'] },
                    }
                });
                responsePayload = { subjectDetails: JSON.parse(response.text.trim()) };
                break;
            }

            case 'analyzeImageForText': {
                const { image, analysisPrompt } = payload;
                 if (!image || !analysisPrompt) {
                    return res.status(400).json({ error: 'Missing image or prompt for analyzeImageForText.' });
                }
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash',
                    contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: analysisPrompt }] },
                });
                responsePayload = { text: response.text.trim() };
                break;
            }

            case 'generatePhotoshoot': {
                const { parts } = payload;
                 if (!parts || !Array.isArray(parts) || parts.length === 0) {
                    return res.status(400).json({ error: 'Missing parts for generation.' });
                }
                const response = await ai.models.generateContent({
                    model: 'gemini-2.5-flash-image',
                    contents: { parts },
                    config: { responseModalities: [Modality.IMAGE] },
                });
                const imagePart = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
                if (imagePart?.inlineData) {
                    const resultUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
                    responsePayload = { resultUrl, generatedPhotoshootResult: { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType } };
                } else {
                     throw new Error('Image not found in model response.');
                }
                break;
            }

            default:
                return res.status(400).json({ error: `Invalid action provided: ${action}` });
        }

        return res.status(200).json(responsePayload);

    } catch (error) {
        console.error('API Error:', error);
        // Отправляем более подробную информацию об ошибке на фронтенд
        const errorMessage = error.message || 'An unknown server error occurred.';
        // Если это ошибка от API Google, она может содержать полезные детали
        const errorDetails = error.cause || {};
        return res.status(500).json({ error: errorMessage, details: errorDetails });
    }
}

// Экспортируем обработчик с включенным CORS
export default allowCors(handler);