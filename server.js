// server.js - Финальная, стабильная версия с корректной архитектурой.

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { OAuth2Client } from 'google-auth-library';

dotenv.config();

// --- Диагностика .env для Gemini ---
console.log('DIAGNOSTICS: Загрузка конфигурации из .env');
if (process.env.API_KEY) {
  console.log('DIAGNOSTICS: API_KEY успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная API_KEY не найдена.');
}
if (process.env.GOOGLE_CLIENT_ID) {
  console.log('DIAGNOSTICS: GOOGLE_CLIENT_ID успешно загружен.');
} else {
  console.error('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная GOOGLE_CLIENT_ID не найдена.');
}
// --- Конец диагностики ---

const app = express();
const port = process.env.PORT || 3001;

if (!process.env.API_KEY || !process.env.GOOGLE_CLIENT_ID) {
    console.error('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! API_KEY или GOOGLE_CLIENT_ID не найден. Сервер не сможет работать.');
    process.exit(1); // Останавливаем сервер, если нет ключа
}

// --- Инициализация Gemini и Google Auth ---
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const authClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const imageModelName = 'gemini-2.5-flash-image';
const textModelName = 'gemini-2.5-flash';

// --- In-memory "база данных" для кредитов ---
const userCredits = {};
const INITIAL_CREDITS = 12;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// --- Определение путей для ES-модулей ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, 'dist');

// --- Раздача статических файлов (ВАЖНО: ПЕРЕД API МАРШРУТАМИ) ---
console.log(`[DIAG] Serving static files from: ${distPath}`);
app.use(express.static(distPath));


// --- Middleware "Охранник" для проверки токена и списания кредитов ---
const authenticateAndCharge = (creditsToCharge) => async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Требуется авторизация.' });
        }
        const token = authHeader.split(' ')[1];
        const ticket = await authClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            return res.status(401).json({ error: 'Недействительный токен.' });
        }
        const userEmail = payload.email;
        if (!(userEmail in userCredits)) {
             return res.status(403).json({ error: 'Пользователь не найден. Пожалуйста, войдите снова.' });
        }
        if (userCredits[userEmail] < creditsToCharge) {
            return res.status(402).json({ error: 'Недостаточно кредитов.' });
        }
        
        userCredits[userEmail] -= creditsToCharge;
        console.log(`[CHARGE] Списано ${creditsToCharge} кредитов у ${userEmail}. Осталось: ${userCredits[userEmail]}`);
        
        req.userEmail = userEmail; // Передаем email дальше в обработчик
        next();
    } catch (error) {
        console.error('[AUTH ERROR]', error);
        return res.status(401).json({ error: 'Ошибка авторизации.' });
    }
};


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
        const responsePayload = await actionLogic(req.body, req.userEmail);
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

// Маршрут для авторизации и получения данных пользователя
app.post('/api/login', createApiHandler(async ({ token }) => {
    const ticket = await authClient.verifyIdToken({
        idToken: token,
        audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
        throw new Error('Не удалось верифицировать пользователя.');
    }
    const { email, name, picture } = payload;

    // Проверяем, есть ли пользователь в нашей "базе"
    if (!(email in userCredits)) {
        console.log(`[AUTH] Новый пользователь: ${email}. Начислено ${INITIAL_CREDITS} кредитов.`);
        userCredits[email] = INITIAL_CREDITS;
    } else {
        console.log(`[AUTH] Существующий пользователь: ${email}. Кредитов: ${userCredits[email]}`);
    }

    return {
        userProfile: { name, email, picture },
        credits: userCredits[email],
    };
}));

app.post('/api/addCredits', authenticateAndCharge(0), createApiHandler(async (body, userEmail) => {
    const creditsToAdd = 12;
    userCredits[userEmail] += creditsToAdd;
    console.log(`[CREDITS] Начислено ${creditsToAdd} кредитов для ${userEmail}. Новый баланс: ${userCredits[userEmail]}`);
    return { newCredits: userCredits[userEmail] };
}));


const generateImageApiCall = async ({ prompt, image }, userEmail) => {
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
        return { 
            imageUrl: `data:${mimeType};base64,${data}`,
            newCredits: userCredits[userEmail] 
        };
    }
    // Если генерация не удалась, возвращаем кредиты
    userCredits[userEmail] += 4; // Стоимость одной генерации вариаций
    console.log(`[REFUND] Возвращено 4 кредита для ${userEmail} из-за ошибки генерации. Баланс: ${userCredits[userEmail]}`);
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
};

app.post('/api/generateVariation', authenticateAndCharge(4), createApiHandler(generateImageApiCall));

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

const generatePhotoshootApiCall = async ({ parts }, userEmail) => {
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
        return { 
            resultUrl, 
            generatedPhotoshootResult: { base64: data, mimeType: mimeType },
            newCredits: userCredits[userEmail] 
        };
    }
    // Если генерация не удалась, возвращаем кредит
    userCredits[userEmail] += 1;
    console.log(`[REFUND] Возвращен 1 кредит для ${userEmail} из-за ошибки фотосессии. Баланс: ${userCredits[userEmail]}`);
    throw new Error(`Изображение не сгенерировано. Причина: ${response.candidates?.[0]?.finishReason || 'Неизвестная ошибка модели'}`);
};

app.post('/api/generatePhotoshoot', authenticateAndCharge(1), createApiHandler(generatePhotoshootApiCall));


// --- Обработчик для SPA (Single Page Application) ---
// Этот обработчик должен быть ПОСЛЕДНИМ, чтобы не перехватывать запросы к API или статическим файлам
app.get('*', (req, res) => {
    const indexPath = path.join(distPath, 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            console.error(`[CRITICAL] Error sending file: ${indexPath}`, err);
            res.status(500).send('Server error: Could not serve the application file.');
        }
    });
});


app.listen(port, () => {
  console.log(`[INFO] Сервер слушает порт ${port}`);
});