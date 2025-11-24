// server.js - Версия с интеграцией LowDB для надежного хранения кредитов.

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'crypto';

// --- LowDB Imports ---
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

// --- ИСПРАВЛЕНИЕ: Используем createRequire для надежного импорта CommonJS модуля ---
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const Yookassa = require('yookassa');
// --- КОНЕЦ ИСПРАВЛЕНИЯ ---

dotenv.config();

// --- Диагностика .env ---
console.log('DIAGNOSTICS: Загрузка конфигурации из .env');
if (!process.env.API_KEY) console.log('DIAGNOSTICS: ВНИМАНИЕ! Переменная API_KEY не найдена.');
if (!process.env.GOOGLE_CLIENT_ID) console.log('DIAGNOSTICS: ВНИМАНИЕ! Переменная GOOGLE_CLIENT_ID не найдена.');
if (!process.env.YOOKASSA_SHOP_ID) console.log('DIAGNOSTICS: ВНИМАНИЕ! YOOKASSA_SHOP_ID не найден.');
if (!process.env.YOOKASSA_SECRET_KEY) console.log('DIAGNOSTICS: ВНИМАНИЕ! YOOKASSA_SECRET_KEY не найден.');
if (!process.env.API_KEY || !process.env.GOOGLE_CLIENT_ID || !process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY) {
  console.log('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Одна или несколько переменных окружения отсутствуют. Сервер не может запуститься.');
  process.exit(1);
} else {
  console.log('DIAGNOSTICS: Все переменные окружения успешно загружены.');
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const yookassa = new Yookassa({
    shopId: process.env.YOOKASSA_SHOP_ID,
    secretKey: process.env.YOOKASSA_SECRET_KEY
});

const app = express();
const port = 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Настройка базы данных LowDB ---
const dbFile = path.join(__dirname, 'fotoclick_db.json');
const adapter = new JSONFile(dbFile);
// Структура данных по умолчанию:
// users: { "email@example.com": { credits: 10 } }
// used_promo_codes: { "email@example.com": ["CODE1", "CODE2"] }
const defaultData = { users: {}, used_promo_codes: {} };
const db = new Low(adapter, defaultData);
// Прочитать данные из файла, инициализировав его, если он не существует.
// Это асинхронная операция, которую мы выполняем один раз при старте.
db.read().then(() => {
    console.log('Успешное подключение и чтение базы данных LowDB (fotoclick_db.json).');
}).catch(error => {
    console.error("Критическая ошибка: не удалось прочитать файл базы данных LowDB.", error);
    process.exit(1);
});

const INITIAL_CREDITS = 1;
const PROMO_CODES = {
    "GEMINI_10": { type: 'credits', value: 10, message: "Вам начислено 10 кредитов!" },
    "FREE_SHOOT": { type: 'credits', value: 999, message: "Вы получили бесплатный доступ на эту сессию!" },
    "BONUS_5": { type: 'credits', value: 5, message: "Бонус! 5 кредитов добавлено." },
    "521378": { type: 'credits', value: 500, message: "Владелец активировал 500 тестовых кредитов." }
};


// --- Middleware ---
app.use((req, res, next) => {
    if (req.path === '/api/payment-webhook') {
        express.raw({ type: 'application/json' })(req, res, next);
    } else {
        express.json({ limit: '50mb' })(req, res, next);
    }
});
app.use(cors());

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Токен аутентификации отсутствует.' });
    }
    const token = authHeader.split(' ')[1];
    try {
        const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
             return res.status(401).json({ error: 'Неверный токен.' });
        }
        req.userEmail = payload.email;
        next();
    } catch (error) {
        console.error('Ошибка проверки токена:', error);
        return res.status(401).json({ error: 'Недействительный токен.' });
    }
};

const authenticateAndCharge = (cost) => async (req, res, next) => {
    try {
        const userEmail = req.userEmail;
        
        await db.read(); // Всегда читаем свежие данные перед операцией
        
        const user = db.data.users[userEmail];
        
        if (!user) {
            return res.status(403).json({ error: 'Пользователь не найден в системе кредитов.' });
        }
        
        if (user.credits < cost) {
            return res.status(402).json({ error: 'Недостаточно кредитов.' });
        }
        
        user.credits -= cost;
        await db.write(); // Сохраняем изменения на диск
        next();
    } catch (dbError) {
        console.error('Ошибка LowDB при списании кредитов:', dbError);
        return res.status(500).json({ error: 'Ошибка сервера при списании кредитов.' });
    }
};

const handleGeminiError = (error, defaultMessage) => {
    console.error(`Ошибка Gemini: ${error.message}`);
    const errorMessage = error.message || '';

    // Пропускаем наши заранее подготовленные, понятные пользователю сообщения.
    if (errorMessage.startsWith('Изображение было заблокировано') || 
        errorMessage.startsWith('Получен пустой ответ от AI') || 
        errorMessage.startsWith('AI вернул ответ в некорректном формате')) {
        return errorMessage;
    }

    if (errorMessage.includes('API key not valid') || errorMessage.includes('API_KEY_INVALID')) {
        return 'Ошибка: API-ключ Google недействителен. Пожалуйста, проверьте ключ в Google AI Studio и в файле .env на сервере.';
    }
    if (errorMessage.toLowerCase().includes('permission denied')) {
        return 'Ошибка: У API-ключа Google нет необходимых разрешений. Проверьте настройки в Google Cloud.';
    }
    if (errorMessage.toLowerCase().includes('safety')) {
        return 'Не удалось обработать фото. Изображение заблокировано автоматической системой безопасности. Пожалуйста, используйте другое фото.';
    }
    return defaultMessage;
};


// --- API Routes ---

app.post('/api/login', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Токен не предоставлен.' });
    
    try {
        const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email || !payload.name || !payload.picture) {
            return res.status(401).json({ error: 'Неверные данные токена.' });
        }
        const { email, name, picture } = payload;
        
        await db.read();
        
        if (!db.data.users[email]) {
            db.data.users[email] = { credits: INITIAL_CREDITS };
            await db.write();
        }

        res.json({
            userProfile: { name, email, picture },
            credits: db.data.users[email].credits,
        });
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера при входе.' });
    }
});


app.post('/api/apply-promo', verifyToken, async (req, res) => {
    const { code } = req.body;
    const userEmail = req.userEmail;

    if (!code) return res.status(400).json({ error: 'Промокод не предоставлен.' });

    const promo = PROMO_CODES[code.toUpperCase()];
    if (!promo) return res.status(404).json({ error: 'Неверный промокод.' });

    try {
        await db.read();
        
        const userPromoCodes = db.data.used_promo_codes[userEmail] || [];
        if (userPromoCodes.includes(code.toUpperCase())) {
            return res.status(409).json({ error: 'Этот промокод уже был использован.' });
        }
        
        if (promo.type === 'credits') {
            if (!db.data.users[userEmail]) {
                 return res.status(404).json({ error: 'Пользователь не найден для начисления промокода.' });
            }
            db.data.users[userEmail].credits += promo.value;
            userPromoCodes.push(code.toUpperCase());
            db.data.used_promo_codes[userEmail] = userPromoCodes;

            await db.write();
            
            console.log(`Промокод "${code}" применен для ${userEmail}. Начислено ${promo.value} кредитов. Баланс: ${db.data.users[userEmail].credits}`);
            
            res.json({
                newCredits: db.data.users[userEmail].credits,
                message: promo.message
            });
        } else {
            res.status(400).json({ error: 'Неподдерживаемый тип промокода.' });
        }
    } catch (dbError) {
        console.error('Ошибка LowDB при применении промокода:', dbError);
        res.status(500).json({ error: 'Ошибка сервера при применении промокода.' });
    }
});

// --- YooKassa Integration ---
app.post('/api/create-payment', verifyToken, async (req, res) => {
    try {
        const userEmail = req.userEmail;
        const idempotenceKey = randomUUID();
        const paymentPayload = {
            amount: { value: '129.00', currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: 'https://photo-click-ai.ru?payment_status=success' },
            description: 'Пакет "12 фотографий" для photo-click-ai.ru',
            metadata: { userEmail: userEmail },
            capture: true
        };
        const payment = await yookassa.createPayment(paymentPayload, idempotenceKey);
        res.json({ confirmationUrl: payment.confirmation.confirmation_url });
    } catch (error) {
        console.error('Ошибка создания платежа YooKassa:', error.response?.data || error.message);
        res.status(500).json({ error: 'Не удалось создать платеж. Проверьте ключи YooKassa.' });
    }
});


app.post('/api/payment-webhook', async (req, res) => {
    try {
        const notification = JSON.parse(req.body);
        console.log('Получено уведомление от YooKassa:', notification);

        if (notification.event === 'payment.succeeded') {
            const payment = notification.object;
            const userEmail = payment.metadata.userEmail;
            if (userEmail) {
                await db.read();
                
                if (!db.data.users[userEmail]) {
                     db.data.users[userEmail] = { credits: 0 };
                }
                db.data.users[userEmail].credits += 12;
                
                await db.write();
                
                console.log(`Успешно начислено 12 фотографий пользователю ${userEmail}. Текущий баланс: ${db.data.users[userEmail].credits}`);
            } else {
                console.error('Webhook: userEmail не найден в метаданных платежа.');
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('Ошибка обработки webhook от YooKassa:', error);
        res.status(500).send('Webhook processing error');
    }
});


// Check image subject endpoint
app.post('/api/checkImageSubject', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image || !image.base64 || !image.mimeType) {
        return res.status(400).json({ error: 'Изображение для анализа не предоставлено.' });
    }
    
    try {
        const prompt = `Проанализируй это изображение и определи, кто на нем изображен, а также его/ее улыбку. 
        Ответь в формате JSON {"category": "...", "smile": "..."}.
        Возможные значения для "category": "мужчина", "женщина", "подросток", "пожилой мужчина", "пожилая женщина", "ребенок", "другое" (если не человек или неясно).
        Возможные значения для "smile": "зубы" (если видна улыбка с зубами), "закрытая" (если улыбка без зубов), "нет улыбки".
        Если на фото несколько людей, анализируй главного, кто в фокусе.`;
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [imagePart, textPart] } });

        // --- NEW: More robust response handling ---
        if (response.promptFeedback?.blockReason) {
            console.warn(`[checkImageSubject] Gemini blocked prompt. Reason: ${response.promptFeedback.blockReason}`);
            throw new Error('Изображение было заблокировано нашей системой безопасности. Пожалуйста, попробуйте другое фото.');
        }
    
        const text = response.text;
        if (!text) {
             console.error('[checkImageSubject] Gemini response was empty. Full response:', JSON.stringify(response, null, 2));
             throw new Error("Получен пустой ответ от AI. Попробуйте другое фото.");
        }
        // --- END NEW ---

        const jsonStringMatch = text.match(/\{.*\}/s);
        if (!jsonStringMatch) {
            console.error('[checkImageSubject] Gemini did not return valid JSON. Response text:', text);
            throw new Error("AI вернул ответ в некорректном формате. Попробуйте другое фото.");
        }
        res.json({ subjectDetails: JSON.parse(jsonStringMatch[0]) });
    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось проанализировать изображение.');
        res.status(500).json({ error: userMessage });
    }
});

const callGeminiForVariation = async (prompt, image) => {
    const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
    const textPart = { text: prompt };
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: { parts: [imagePart, textPart] },
        config: { responseModalities: [Modality.IMAGE] },
    });
    const generatedImagePart = response.candidates[0].content.parts.find(part => part.inlineData);
    if (!generatedImagePart || !generatedImagePart.inlineData) {
        throw new Error('Gemini не вернул изображение.');
    }
    return `data:${generatedImagePart.inlineData.mimeType};base64,${generatedImagePart.inlineData.data}`;
};

// New atomic endpoint for generating 4 variations
app.post('/api/generateFourVariations', verifyToken, authenticateAndCharge(4), async (req, res) => {
    const { prompts, image } = req.body;
    const userEmail = req.userEmail;

    if (!prompts || !Array.isArray(prompts) || prompts.length !== 4 || !image) {
        await db.read();
        if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 4;
            await db.write();
        }
        return res.status(400).json({ error: 'Некорректные данные для генерации.' });
    }

    try {
        const generationPromises = prompts.map(prompt => callGeminiForVariation(prompt, image));
        const imageUrls = await Promise.all(generationPromises);
        await db.read();
        res.json({ imageUrls, newCredits: db.data.users[userEmail].credits });
    } catch (error) {
        await db.read();
        if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 4;
            await db.write();
        }
        const userMessage = handleGeminiError(error, 'Не удалось сгенерировать вариации.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint to get the bounding box of a person
app.post('/api/detectPersonBoundingBox', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image || !image.base64 || !image.mimeType) {
        return res.status(400).json({ error: 'Изображение для анализа не предоставлено.' });
    }
    try {
        const prompt = `Найди главного человека на этом изображении и верни координаты его ограничивающей рамки (bounding box). Ответ должен быть СТРОГО в формате JSON: {"x_min": float, "y_min": float, "x_max": float, "y_max": float}, где координаты нормализованы от 0.0 до 1.0. Не добавляй никакого другого текста или форматирования, только JSON.`;
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [imagePart, textPart] } });
        const jsonStringMatch = response.text.match(/\{.*\}/s);
        if (!jsonStringMatch) throw new Error('Gemini did not return valid JSON for bounding box.');
        const boundingBox = JSON.parse(jsonStringMatch[0]);
        if (typeof boundingBox.x_min !== 'number' || typeof boundingBox.y_min !== 'number' || typeof boundingBox.x_max !== 'number' || typeof boundingBox.y_max !== 'number') {
            throw new Error('Полученные данные ограничивающей рамки недействительны.');
        }
        res.json({ boundingBox });
    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось определить положение человека на фото.');
        res.status(500).json({ error: userMessage });
    }
});

// New endpoint for intelligent clothing cropping
app.post('/api/cropClothing', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image || !image.base64 || !image.mimeType) {
        return res.status(400).json({ error: 'Изображение одежды для анализа не предоставлено.' });
    }

    try {
        const prompt = `Проанализируй это изображение. Найди основной предмет одежды на человеке. Твоя задача — вернуть координаты прямоугольника (bounding box), который охватывает одежду от плеч до бедер, но ОБЯЗАТЕЛЬНО ИСКЛЮЧАЕТ голову и лицо модели. Ответ должен быть СТРОГО в формате JSON: {"boundingBox": {"x_min": float, "y_min": float, "x_max": float, "y_max": float}}. Координаты должны быть нормализованы (от 0.0 до 1.0). Не добавляй никакого другого текста или форматирования.`;
        
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash', // Use a cheaper text model
            contents: { parts: [imagePart, textPart] },
        });

        const jsonStringMatch = response.text.match(/\{.*\}/s);
        if (!jsonStringMatch) {
            throw new Error('Gemini не вернул корректный JSON для координат.');
        }
        const result = JSON.parse(jsonStringMatch[0]);
        if (!result.boundingBox) {
            throw new Error('Ответ Gemini не содержит поля "boundingBox".');
        }

        res.json({ boundingBox: result.boundingBox });

    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось получить координаты для обрезки одежды.');
        res.status(500).json({ error: userMessage });
    }
});


// Endpoint for generating the main photoshoot
app.post('/api/generatePhotoshoot', verifyToken, authenticateAndCharge(1), async (req, res) => {
    const { parts } = req.body;
    const userEmail = req.userEmail;

    if (!parts || !Array.isArray(parts) || parts.length < 2) {
         await db.read();
         if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 1;
            await db.write();
         }
         return res.status(400).json({ error: 'Некорректные данные для фотосессии.' });
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: parts },
            config: { responseModalities: [Modality.IMAGE] },
        });
        const generatedImagePart = response.candidates[0].content.parts.find(part => part.inlineData);
        if (!generatedImagePart || !generatedImagePart.inlineData) {
            throw new Error('Gemini не вернул изображение фотосессии.');
        }
        const generatedPhotoshootResult = { base64: generatedImagePart.inlineData.data, mimeType: generatedImagePart.inlineData.mimeType };
        const resultUrl = `data:${generatedPhotoshootResult.mimeType};base64,${generatedPhotoshootResult.base64}`;
        await db.read();
        res.json({ resultUrl, generatedPhotoshootResult, newCredits: db.data.users[userEmail].credits });
    } catch (error) {
        await db.read();
        if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 1;
            await db.write();
        }
        const userMessage = handleGeminiError(error, 'Не удалось сгенерировать фотосессию.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint for analyzing image for text description
app.post('/api/analyzeImageForText', verifyToken, async (req, res) => {
    const { image, analysisPrompt } = req.body;
    if (!image || !analysisPrompt) return res.status(400).json({ error: 'Отсутствует изображение или промпт для анализа.' });
    
    try {
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: analysisPrompt };
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [imagePart, textPart] } });
        res.json({ text: response.text });
    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось проанализировать изображение.');
        res.status(500).json({ error: userMessage });
    }
});

app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});