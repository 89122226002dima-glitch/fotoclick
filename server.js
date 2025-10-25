// server.js - Обновленный бэкенд для работы с Vertex AI
import express from 'express';
import cors from 'cors';
// Исправленный импорт для совместимости с CommonJS модулем
import aiplatform from '@google-cloud/aiplatform';
const { VertexAI } = aiplatform;
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Диагностика загрузки .env файла ---
const envPath = path.resolve(__dirname, '.env');
dotenv.config({ path: envPath });

console.log(`DIAGNOSTICS: Загрузка конфигурации из ${envPath}`);
if (process.env.PROJECT_ID) {
  console.log('DIAGNOSTICS: PROJECT_ID успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная PROJECT_ID не найдена в .env файле.');
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.log('DIAGNOSTICS: GOOGLE_APPLICATION_CREDENTIALS успешно загружен.');
} else {
    // В облачных средах это может быть нормально, если аутентификация настроена иначе
    console.warn('DIAGNOSTICS: ВНИМАНИЕ! GOOGLE_APPLICATION_CREDENTIALS не найден. Аутентификация будет произведена через стандартные механизмы Google Cloud.');
}
// --- Конец диагностики ---


const app = express();
const port = process.env.PORT || 3001;

// --- Инициализация Vertex AI ---
// Убедитесь, что в вашем .env файле есть PROJECT_ID
// GOOGLE_APPLICATION_CREDENTIALS подхватывается автоматически из .env
if (!process.env.PROJECT_ID) {
    console.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! PROJECT_ID не найден.');
}
const vertex_ai = new VertexAI({ project: process.env.PROJECT_ID, location: 'us-central1' });
const textModel = vertex_ai.getGenerativeModel({ model: 'gemini-2.5-flash' });
const imageModel = vertex_ai.getGenerativeModel({ model: 'gemini-2.5-flash-image' });


// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Хелпер для преобразования base64 в формат Vertex AI Part
const fileToPart = (base64, mimeType) => {
    return {
        inlineData: {
            mimeType,
            data: base64,
        },
    };
};

// Общий обработчик для всех API-запросов
const createApiHandler = (actionLogic) => async (req, res) => {
    try {
        if (!process.env.PROJECT_ID) {
            throw new Error('PROJECT_ID не найден. Убедитесь, что переменная окружения установлена на сервере (в файле .env).');
        }
        const responsePayload = await actionLogic(req.body);
        return res.status(200).json(responsePayload);
    } catch (error) {
        console.error(`API Error in action:`, error);
        if (error.type === 'entity.too.large') {
             return res.status(413).json({ error: 'Загруженное изображение слишком большое. Пожалуйста, выберите файл меньшего размера.' });
        }
        const errorMessage = error.message || 'Произошла неизвестная ошибка сервера.';
        return res.status(500).json({ error: errorMessage });
    }
};

// --- Обновленные API маршруты для Vertex AI ---

app.post('/api/generateVariation', createApiHandler(async ({ prompt, image }) => {
    const request = {
        contents: [{ role: 'user', parts: [fileToPart(image.base64, image.mimeType), { text: prompt }] }],
    };
    const responseStream = await imageModel.generateContentStream(request);
    const aggregatedResponse = await responseStream.response;
    const imagePart = aggregatedResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
        return { imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${aggregatedResponse.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
}));

app.post('/api/generateWideImage', createApiHandler(async ({ prompt, image }) => {
    const request = {
        contents: [{ role: 'user', parts: [fileToPart(image.base64, image.mimeType), { text: prompt }] }],
    };
    const responseStream = await imageModel.generateContentStream(request);
    const aggregatedResponse = await responseStream.response;
    const imagePart = aggregatedResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
        return { imageUrl: `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}` };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${aggregatedResponse.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
}));

app.post('/api/checkImageSubject', createApiHandler(async ({ image }) => {
    const request = {
        contents: [{ role: 'user', parts: [fileToPart(image.base64, image.mimeType), { text: 'Определи категорию человека (мужчина, женщина, подросток, пожилой мужчина, пожилая женщина, ребенок, другое) и тип улыбки (зубы, закрытая, нет улыбки).' }] }],
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: { type: 'OBJECT', properties: { category: { type: 'STRING' }, smile: { type: 'STRING' } } }
        }
    };
    const responseStream = await textModel.generateContentStream(request);
    const aggregatedResponse = await responseStream.response;
    const subjectDetailsText = aggregatedResponse.candidates[0].content.parts[0].text;
    try {
        const subjectDetailsObject = JSON.parse(subjectDetailsText);
        if (typeof subjectDetailsObject !== 'object' || subjectDetailsObject === null || !('category' in subjectDetailsObject) || !('smile' in subjectDetailsObject)) {
            throw new Error('Получен некорректный формат данных от AI.');
        }
        return { subjectDetails: subjectDetailsObject };
    } catch (e) {
        console.error("Ошибка парсинга JSON от Vertex AI:", subjectDetailsText, e);
        throw new Error("Не удалось разобрать ответ от AI. Попробуйте еще раз.");
    }
}));

app.post('/api/analyzeImageForText', createApiHandler(async ({ image, analysisPrompt }) => {
    const request = {
        contents: [{ role: 'user', parts: [fileToPart(image.base64, image.mimeType), { text: analysisPrompt }] }],
    };
    const responseStream = await textModel.generateContentStream(request);
    const aggregatedResponse = await responseStream.response;
    const text = aggregatedResponse.candidates[0].content.parts[0].text;
    return { text: text.trim() };
}));

app.post('/api/generatePhotoshoot', createApiHandler(async ({ parts }) => {
    const requestParts = parts.map(part => {
        if (part.inlineData) {
            return fileToPart(part.inlineData.data, part.inlineData.mimeType);
        }
        return part; // Для текстовых частей
    });

    const request = {
        contents: [{ role: 'user', parts: requestParts }],
    };
    const responseStream = await imageModel.generateContentStream(request);
    const aggregatedResponse = await responseStream.response;
    const imagePart = aggregatedResponse.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
    if (imagePart?.inlineData) {
        const resultUrl = `data:${imagePart.inlineData.mimeType};base64,${imagePart.inlineData.data}`;
        return { resultUrl, generatedPhotoshootResult: { base64: imagePart.inlineData.data, mimeType: imagePart.inlineData.mimeType } };
    }
    throw new Error(`Изображение не сгенерировано. Причина: ${aggregatedResponse.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
}));

// Раздача статических файлов из папки 'dist'
app.use(express.static(path.join(__dirname, 'dist')));

// Раздача статических файлов из 'public' (для иконок и manifest.json)
app.use(express.static(path.join(__dirname, 'public')));

// "Catchall" обработчик: для любого запроса, который не совпал выше,
// отправляем index.html. Это важно для одностраничных приложений (SPA).
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(port, () => {
  console.log(`Сервер слушает порт ${port}`);
});