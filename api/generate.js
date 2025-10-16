// api/generate.js
import { GoogleGenAI, Modality, Type } from '@google/genai';

// CORS middleware для разрешения запросов с нашего фронтенда
const allowCors = (fn) => (req, res) => {
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

// Основная логика обработчика для всех API-запросов
const handler = async (req, res) => {
    // Принимаем только POST-запросы
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    try {
        // API-ключ ДОЛЖЕН быть установлен как переменная окружения в настройках проекта Vercel.
        if (!process.env.API_KEY) {
            throw new Error('API_KEY environment variable is not set.');
        }
        
        // Безопасно извлекаем данные из тела запроса внутри блока try
        const { action, ...payload } = req.body;
        if (!action) {
            return res.status(400).json({ error: 'Missing "action" in request body.' });
        }
        
        const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

        let responsePayload;

        switch (action) {
            case 'generateVariation': {
                const { prompt, image } = payload;
                if (!prompt || !image || !image.base64 || !image.mimeType) {
                    return res.status(400).json({ error: 'Missing prompt or image data.' });
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
                  // Предоставляем более детальную ошибку, если изображение было заблокировано
                  const blockReason = response?.candidates?.[0]?.finishReason;
                  const safetyRatings = response?.candidates?.[0]?.safetyRatings;
                  throw new Error(`Image not generated. Reason: ${blockReason}. Safety: ${JSON.stringify(safetyRatings)}`);
                }
                break;
            }
              
            case 'checkImageSubject': {
                const { image } = payload;
                if (!image || !image.base64 || !image.mimeType) {
                    return res.status(400).json({ error: 'Missing image data.' });
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
                    return res.status(400).json({ error: 'Missing image or prompt data.' });
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
                     const blockReason = response?.candidates?.[0]?.finishReason;
                     const safetyRatings = response?.candidates?.[0]?.safetyRatings;
                     throw new Error(`Image not generated. Reason: ${blockReason}. Safety: ${JSON.stringify(safetyRatings)}`);
                }
                break;
            }

            default:
                return res.status(400).json({ error: `Invalid action provided: ${action}` });
        }

        return res.status(200).json(responsePayload);

    } catch (error) {
        console.error('API Error:', error);
        // Возвращаем детальную ошибку в формате JSON
        const errorMessage = error.message || 'An unknown server error occurred.';
        return res.status(500).json({ error: errorMessage });
    }
};

// Экспортируем наш обработчик, обернутый в CORS middleware
export default allowCors(handler);