// server.js - Финальная, стабильная версия с корректной архитектурой и YooKassa.

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Type, Modality } from '@google/genai';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'crypto';

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
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const yookassa = new Yookassa({
    shopId: process.env.YOOKASSA_SHOP_ID,
    secretKey: process.env.YOOKASSA_SECRET_KEY
});

const app = express();
const port = 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const userCredits = {};
const INITIAL_CREDITS = 1;

// --- Middleware ---
// Raw body is needed for YooKassa webhook
app.use((req, res, next) => {
    if (req.path === '/api/payment-webhook') {
        express.raw({ type: 'application/json' })(req, res, next);
    } else {
        express.json({ limit: '10mb' })(req, res, next);
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
    await verifyToken(req, res, async () => {
        const userEmail = req.userEmail;
        if (!userEmail) {
            return res.status(401).json({ error: 'Не удалось определить пользователя.' });
        }
        if (userCredits[userEmail] === undefined) {
             return res.status(403).json({ error: 'Пользователь не найден в системе кредитов.' });
        }
        if (userCredits[userEmail] < cost) {
            return res.status(402).json({ error: 'Недостаточно кредитов.' });
        }
        userCredits[userEmail] -= cost;
        next();
    });
};

/**
 * Enhanced error handler for Gemini API calls.
 * @param {Error} error The error object caught.
 * @param {string} defaultMessage A default message for the user.
 * @returns {string} A user-friendly error message.
 */
const handleGeminiError = (error, defaultMessage) => {
    console.error(`Ошибка Gemini: ${error.message}`);
    // Check for specific API key error message from Google
    if (error.message && (error.message.includes('API key not valid') || error.message.includes('API_KEY_INVALID'))) {
        return 'Ошибка: API-ключ Google недействителен. Пожалуйста, проверьте ключ в Google AI Studio и в файле .env на сервере.';
    }
    // Check for permission denied errors
    if (error.message && error.message.toLowerCase().includes('permission denied')) {
        return 'Ошибка: У API-ключа Google нет необходимых разрешений. Проверьте настройки в Google Cloud.';
    }
    return defaultMessage;
};


// --- API Routes ---

app.post('/api/login', async (req, res) => {
    const { token } = req.body;
    if (!token) {
        return res.status(400).json({ error: 'Токен не предоставлен.' });
    }
    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        if (!payload || !payload.email || !payload.name || !payload.picture) {
            return res.status(401).json({ error: 'Неверные данные токена.' });
        }
        const { email, name, picture } = payload;
        
        if (userCredits[email] === undefined) {
            userCredits[email] = INITIAL_CREDITS;
        }

        res.json({
            userProfile: { name, email, picture },
            credits: userCredits[email],
        });
    } catch (error) {
        console.error('Ошибка входа:', error);
        res.status(500).json({ error: 'Внутренняя ошибка сервера при входе.' });
    }
});

app.post('/api/addCredits', verifyToken, (req, res) => {
    const userEmail = req.userEmail;
    if (userCredits[userEmail] === undefined) {
        userCredits[userEmail] = 0;
    }
    userCredits[userEmail] += 12;
    res.json({ newCredits: userCredits[userEmail] });
});

// --- YooKassa Integration ---
app.post('/api/create-payment', verifyToken, async (req, res) => {
    try {
        const { paymentMethod } = req.body;
        const userEmail = req.userEmail;
        const idempotenceKey = randomUUID();
        
        let paymentPayload;

        if (paymentMethod === 'sberpay') {
            paymentPayload = {
                amount: { value: '79.00', currency: 'RUB' },
                payment_method_data: { type: 'sbp' }, // ИЗМЕНЕНО: Используем универсальный СБП
                confirmation: {
                    type: 'redirect', // YooKassa сама решит, как лучше перенаправить (QR или приложение)
                    return_url: 'https://photo-click-ai.ru/?payment_status=success'
                },
                description: 'Пакет "12 фотографий" для photo-click-ai.ru',
                metadata: { userEmail: userEmail },
                capture: true
            };
        } else { // Default to bank card
            paymentPayload = {
                amount: {
                    value: '79.00',
                    currency: 'RUB'
                },
                payment_method_data: {
                    type: 'bank_card'
                },
                confirmation: {
                    type: 'redirect',
                    return_url: 'https://photo-click-ai.ru/?payment_status=success'
                },
                description: 'Пакет "12 фотографий" для photo-click-ai.ru',
                metadata: {
                    userEmail: userEmail
                },
                capture: true
            };
        }

        const payment = await yookassa.createPayment(paymentPayload, idempotenceKey);

        res.json({ confirmationUrl: payment.confirmation.confirmation_url });
    } catch (error) {
        console.error('Ошибка создания платежа YooKassa:', error);
        res.status(500).json({ error: 'Не удалось создать платеж.' });
    }
});

app.post('/api/payment-webhook', (req, res) => {
    try {
        const notification = JSON.parse(req.body); // YooKassa sends raw JSON
        console.log('Получено уведомление от YooKassa:', notification);

        if (notification.event === 'payment.succeeded') {
            const payment = notification.object;
            const userEmail = payment.metadata.userEmail;
            if (userEmail) {
                if (userCredits[userEmail] === undefined) {
                    userCredits[userEmail] = 0;
                }
                userCredits[userEmail] += 12;
                console.log(`Успешно начислено 12 фотографий пользователю ${userEmail}. Текущий баланс: ${userCredits[userEmail]}`);
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
app.post('/api/checkImageSubject', authenticateAndCharge(0), async (req, res) => { // 0 cost for analysis
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
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, textPart] },
        });
        
        const jsonStringMatch = response.text.match(/\{.*\}/s);
        if (!jsonStringMatch) {
            throw new Error("Gemini не вернул корректный JSON.");
        }
        const subjectDetails = JSON.parse(jsonStringMatch[0]);

        res.json({ subjectDetails });

    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось проанализировать изображение.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint for generating a single variation
app.post('/api/generateVariation', authenticateAndCharge(1), async (req, res) => {
    const { prompt, image } = req.body;
    const userEmail = req.userEmail;

    if (!prompt || !image || !image.base64 || !image.mimeType) {
        userCredits[userEmail] += 1;
        return res.status(400).json({ error: 'Отсутствует промпт или изображение.' });
    }

    try {
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: [imagePart, textPart] },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });
        
        const generatedImagePart = response.candidates[0].content.parts.find(part => part.inlineData);

        if (!generatedImagePart || !generatedImagePart.inlineData) {
            throw new Error('Gemini не вернул изображение.');
        }

        const imageUrl = `data:${generatedImagePart.inlineData.mimeType};base64,${generatedImagePart.inlineData.data}`;
        res.json({ imageUrl, newCredits: userCredits[userEmail] });

    } catch (error) {
        userCredits[userEmail] += 1; // Refund credits on failure
        const userMessage = handleGeminiError(error, 'Не удалось сгенерировать вариацию.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint to get the bounding box of a person
app.post('/api/detectPersonBoundingBox', authenticateAndCharge(0), async (req, res) => {
    const { image } = req.body;
    if (!image || !image.base64 || !image.mimeType) {
        return res.status(400).json({ error: 'Изображение для анализа не предоставлено.' });
    }

    try {
        const prompt = `Найди главного человека на этом изображении и верни координаты его ограничивающей рамки (bounding box). Ответ должен быть СТРОГО в формате JSON: {"x_min": float, "y_min": float, "x_max": float, "y_max": float}, где координаты нормализованы от 0.0 до 1.0. Не добавляй никакого другого текста или форматирования, только JSON.`;

        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, textPart] },
        });

        const jsonStringMatch = response.text.match(/\{.*\}/s);
        if (!jsonStringMatch) {
            throw new Error('Gemini did not return valid JSON for bounding box.');
        }
        const boundingBox = JSON.parse(jsonStringMatch[0]);
        
        if (typeof boundingBox.x_min !== 'number' || typeof boundingBox.y_min !== 'number' ||
            typeof boundingBox.x_max !== 'number' || typeof boundingBox.y_max !== 'number') {
            throw new Error('Полученные данные ограничивающей рамки недействительны.');
        }

        res.json({ boundingBox });

    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось определить положение человека на фото.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint for generating the main photoshoot
app.post('/api/generatePhotoshoot', authenticateAndCharge(1), async (req, res) => {
    const { parts } = req.body;
    const userEmail = req.userEmail;

    if (!parts || !Array.isArray(parts) || parts.length < 2) {
         userCredits[userEmail] += 1; // Refund
         return res.status(400).json({ error: 'Некорректные данные для фотосессии.' });
    }

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image',
            contents: { parts: parts },
            config: {
                responseModalities: [Modality.IMAGE],
            },
        });

        const generatedImagePart = response.candidates[0].content.parts.find(part => part.inlineData);

        if (!generatedImagePart || !generatedImagePart.inlineData) {
            throw new Error('Gemini не вернул изображение фотосессии.');
        }
        
        const generatedPhotoshootResult = {
            base64: generatedImagePart.inlineData.data,
            mimeType: generatedImagePart.inlineData.mimeType
        };
        const resultUrl = `data:${generatedPhotoshootResult.mimeType};base64,${generatedPhotoshootResult.base64}`;

        res.json({ resultUrl, generatedPhotoshootResult, newCredits: userCredits[userEmail] });

    } catch (error) {
        userCredits[userEmail] += 1; // Refund
        const userMessage = handleGeminiError(error, 'Не удалось сгенерировать фотосессию.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint for analyzing image for text description
app.post('/api/analyzeImageForText', authenticateAndCharge(0), async (req, res) => {
    const { image, analysisPrompt } = req.body;
    if (!image || !analysisPrompt) {
        return res.status(400).json({ error: 'Отсутствует изображение или промпт для анализа.' });
    }
    
    try {
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: analysisPrompt };
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [imagePart, textPart] },
        });

        res.json({ text: response.text });
    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось проанализировать изображение.');
        res.status(500).json({ error: userMessage });
    }
});

app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});