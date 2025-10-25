// server.js - Бэкенд, переработанный для Vertex AI
import express from 'express';
import cors from 'cors';
import { VertexAI } from '@google-cloud/aiplatform';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Загрузка переменных окружения ---
const envPath = path.resolve(__dirname, '.env');
dotenv.config({ path: envPath });

console.log('DIAGNOSTICS: Загрузка конфигурации Vertex AI...');
if (!process.env.PROJECT_ID || !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменные PROJECT_ID или GOOGLE_APPLICATION_CREDENTIALS не установлены в .env. Сервер не может работать с Vertex AI.');
} else {
    console.log('DIAGNOSTICS: PROJECT_ID и GOOGLE_APPLICATION_CREDENTIALS найдены.');
}
// --- Конец диагностики ---

const app = express();
const port = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- Настройки Vertex AI ---
const PROJECT = process.env.PROJECT_ID;
const LOCATION = 'us-central1'; // Стандартный регион для многих моделей
const vertex_ai = new VertexAI({ project: PROJECT, location: LOCATION });

// --- Модели Vertex AI ---
// Модель для генерации/редактирования изображений (Imagen)
const imageGenerationModel = vertex_ai.preview.getGenerativeModel({
    model: 'imagegeneration@006',
});

// Модель для анализа текста и изображений (Gemini)
const textAndImageModel = vertex_ai.preview.getGenerativeModel({
    model: 'gemini-1.5-flash-001',
});


// Функция-обработчик для каждого маршрута API
const createApiHandler = (actionLogic) => async (req, res) => {
    try {
        if (!PROJECT || !LOCATION) {
            throw new Error('Конфигурация Vertex AI неполная. Проверьте переменные окружения.');
        }
        const responsePayload = await actionLogic(req.body);
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error('API Error in action:', error);
        if (error.type === 'entity.too.large') {
            return res.status(413).json({ error: 'Загруженное изображение слишком большое.' });
        }
        const errorMessage = error.message || 'Произошла неизвестная ошибка сервера.';
        return res.status(500).json({ error: errorMessage });
    }
};

// --- Маршруты API, адаптированные под Vertex AI ---

// Генерация/редактирование изображения
const generateImageVertex = async (payload) => {
    const { prompt, image } = payload;
    const request = {
        prompt: prompt,
        // Для редактирования передаем исходное изображение
        ...(image && { image: { bytesBase64Encoded: image.base64 } }),
        sampleCount: 1,
        // Добавляем параметр `mode: 'image-variation'` для редактирования
        ...(image && { mode: 'image-variation' }),
    };

    const response = await imageGenerationModel.generateImages(request);
    
    if (response?.images?.[0]?.bytesBase64Encoded) {
        const generatedImage = response.images[0];
        return { imageUrl: `data:image/png;base64,${generatedImage.bytesBase64Encoded}` };
    }
    throw new Error('Изображение не сгенерировано. Vertex AI не вернул результат.');
};


// Анализ фото для определения категории и улыбки
app.post('/api/checkImageSubject', createApiHandler(async (payload) => {
    const { image } = payload;
    const request = {
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { mimeType: image.mimeType, data: image.base64 } },
                { text: 'Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки). Ответ дай в формате JSON: {"category": "...", "smile": "..."}' }
            ]
        }],
    };
    
    const response = await textAndImageModel.generateContent(request);
    const text = response.response.candidates[0].content.parts[0].text;
    const cleanedText = text.replace(/```json|```/g, '').trim();

    try {
        const subjectDetailsObject = JSON.parse(cleanedText);
        return { subjectDetails: subjectDetailsObject };
    } catch (e) {
        console.error("Ошибка парсинга JSON от Vertex AI:", cleanedText, e);
        throw new Error("Не удалось разобрать ответ от AI.");
    }
}));


// Анализ изображения для получения текста (одежда, локация)
app.post('/api/analyzeImageForText', createApiHandler(async (payload) => {
    const { image, analysisPrompt } = payload;
    const request = {
        contents: [{
            role: 'user',
            parts: [
                { inlineData: { mimeType: image.mimeType, data: image.base64 } },
                { text: analysisPrompt }
            ]
        }]
    };
    const response = await textAndImageModel.generateContent(request);
    const text = response.response.candidates[0].content.parts[0].text;
    return { text: text.trim() };
}));


// Генерация 4 вариаций (теперь это 4 вызова image-variation)
app.post('/api/generateVariation', createApiHandler(generateImageVertex));

// Генерация фотосессии (сложный промпт с несколькими частями)
app.post('/api/generatePhotoshoot', createApiHandler(async (payload) => {
    const { parts } = payload; // parts - это массив объектов {text: ...} или {inlineData: ...}
    
    // Формируем запрос для Gemini в Vertex AI
    const request = { contents: [{ role: 'user', parts: parts }] };
    
    // Используем модель Gemini для генерации, т.к. Imagen не поддерживает мультимодальные промпты такого типа
    const response = await textAndImageModel.generateContent(request);
    
    const imagePart = response.response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
        const resultUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
        return { resultUrl, generatedPhotoshootResult: { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType } };
    }
    // Если изображение не найдено, проверяем причину блокировки
    const finishReason = response.response.candidates?.[0]?.finishReason;
    const safetyRatings = response.response.candidates?.[0]?.safetyRatings;
    let errorMessage = `Изображение не сгенерировано. Причина: ${finishReason || 'неизвестно'}.`;
    if (finishReason === 'SAFETY') {
        errorMessage += ` Проверьте safetyRatings: ${JSON.stringify(safetyRatings)}`;
    }
    throw new Error(errorMessage);
}));


// --- Обслуживание статических файлов ---
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Сервер слушает порт ${port}`);
});