// server.js - Версия с интеграцией LowDB и Мульти-референсом лиц.

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
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
const defaultData = { users: {}, used_promo_codes: {} };
const db = new Low(adapter, defaultData);
db.read().then(() => {
    console.log('Успешное подключение и чтение базы данных LowDB (fotoclick_db.json).');
}).catch(error => {
    console.error("Критическая ошибка: не удалось прочитать файл базы данных LowDB.", error);
    process.exit(1);
});

const INITIAL_CREDITS = 1;
const PROMO_CODES = {
    "521377": { type: 'credits', value: 500, message: "Владелец активировал 500 тестовых кредитов." },
    "521374": { type: 'credits', value: 500, message: "Владелец активировал 500 тестовых кредитов." }
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
        await db.read();
        const user = db.data.users[userEmail];
        
        if (!user) {
            return res.status(403).json({ error: 'Пользователь не найден в системе кредитов.' });
        }
        
        if (user.credits < cost) {
            return res.status(402).json({ error: 'Недостаточно кредитов.' });
        }
        
        user.credits -= cost;
        await db.write();
        next();
    } catch (dbError) {
        console.error('Ошибка LowDB при списании кредитов:', dbError);
        return res.status(500).json({ error: 'Ошибка сервера при списании кредитов.' });
    }
};

const handleGeminiError = (error, defaultMessage) => {
    console.error(`Ошибка Gemini: ${error.message}`);
    const errorMessage = error.message || '';

    if (errorMessage.startsWith('Изображение было заблокировано') || 
        errorMessage.startsWith('Получен пустой ответ от AI') || 
        errorMessage.startsWith('AI вернул ответ в некорректном формате')) {
        return errorMessage;
    }
    if (errorMessage.includes('API key not valid') || errorMessage.includes('API_KEY_INVALID')) {
        return 'Ошибка: API-ключ Google недействителен.';
    }
    if (errorMessage.toLowerCase().includes('safety')) {
        return 'Не удалось обработать фото. Изображение заблокировано системой безопасности.';
    }
    return defaultMessage;
};

// --- Helper for Bounding Box extraction ---
function parseBoundingBox(text) {
    try {
        const match = text.match(/\[\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\]/);
        if (match) {
            const [_, y_min, x_min, y_max, x_max] = match;
            return {
                y_min: parseInt(y_min) / 1000,
                x_min: parseInt(x_min) / 1000,
                y_max: parseInt(y_max) / 1000,
                x_max: parseInt(x_max) / 1000,
            };
        }
        // Try finding JSON
        const jsonMatch = text.match(/\{.*\}/s);
        if (jsonMatch) {
             const json = JSON.parse(jsonMatch[0]);
             if (json.box_2d) return {
                 y_min: json.box_2d[0] / 1000,
                 x_min: json.box_2d[1] / 1000,
                 y_max: json.box_2d[2] / 1000,
                 x_max: json.box_2d[3] / 1000
             };
        }
    } catch (e) { console.error("Error parsing box:", e); }
    return null;
}

// --- API Routes ---

app.post('/api/login', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Токен не предоставлен.' });
    try {
        const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
        const ticket = await googleClient.verifyIdToken({ idToken: token, audience: process.env.GOOGLE_CLIENT_ID });
        const payload = ticket.getPayload();
        if (!payload || !payload.email || !payload.name || !payload.picture) return res.status(401).json({ error: 'Неверные данные токена.' });
        
        const { email, name, picture } = payload;
        await db.read();
        if (!db.data.users[email]) {
            db.data.users[email] = { credits: INITIAL_CREDITS };
            await db.write();
        }
        res.json({ userProfile: { name, email, picture }, credits: db.data.users[email].credits });
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
        if (userPromoCodes.includes(code.toUpperCase())) return res.status(409).json({ error: 'Этот промокод уже был использован.' });
        if (promo.type === 'credits') {
            if (!db.data.users[userEmail]) return res.status(404).json({ error: 'Пользователь не найден.' });
            db.data.users[userEmail].credits += promo.value;
            userPromoCodes.push(code.toUpperCase());
            db.data.used_promo_codes[userEmail] = userPromoCodes;
            await db.write();
            res.json({ newCredits: db.data.users[userEmail].credits, message: promo.message });
        } else {
            res.status(400).json({ error: 'Неподдерживаемый тип промокода.' });
        }
    } catch (dbError) {
        console.error('Ошибка LowDB:', dbError);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// --- YooKassa ---
app.post('/api/create-payment', verifyToken, async (req, res) => {
    try {
        const userEmail = req.userEmail;
        const idempotenceKey = randomUUID();
        const paymentPayload = {
            amount: { value: '129.00', currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: 'https://photo-click-ai.ru?payment_status=success' },
            description: 'Пакет "12 фотографий"',
            metadata: { userEmail: userEmail },
            capture: true
        };
        const payment = await yookassa.createPayment(paymentPayload, idempotenceKey);
        res.json({ confirmationUrl: payment.confirmation.confirmation_url });
    } catch (error) {
        console.error('Ошибка создания платежа:', error);
        res.status(500).json({ error: 'Не удалось создать платеж.' });
    }
});

app.post('/api/payment-webhook', async (req, res) => {
    try {
        const notification = JSON.parse(req.body);
        if (notification.event === 'payment.succeeded') {
            const payment = notification.object;
            const userEmail = payment.metadata.userEmail;
            if (userEmail) {
                await db.read();
                if (!db.data.users[userEmail]) db.data.users[userEmail] = { credits: 0 };
                db.data.users[userEmail].credits += 12;
                await db.write();
                console.log(`Начислено 12 кредитов пользователю ${userEmail}.`);
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('Ошибка webhook:', error);
        res.status(500).send('Error');
    }
});

// --- AI Endpoints ---

app.post('/api/checkImageSubject', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Изображение не предоставлено.' });
    
    try {
        const prompt = `Проанализируй это изображение и определи, кто на нем изображен, а также его/ее улыбку. 
        Ответь в формате JSON {"category": "...", "smile": "..."}.
        Возможные значения для "category": "мужчина", "женщина", "подросток", "пожилой мужчина", "пожилая женщина", "ребенок", "другое".
        Возможные значения для "smile": "зубы", "закрытая", "нет улыбки".`;
        
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }] }
        });

        const text = response.text;
        if (!text) throw new Error("Пустой ответ от AI.");

        const jsonStringMatch = text.match(/\{.*\}/s);
        if (!jsonStringMatch) {
            console.error('[checkImageSubject] Invalid JSON:', text);
            throw new Error("AI вернул ответ в некорректном формате.");
        }
        const jsonString = jsonStringMatch[0];
        const result = JSON.parse(jsonString);
        res.json({ subjectDetails: result });

    } catch (error) {
        console.error('Ошибка анализа:', error);
        res.status(500).json({ error: handleGeminiError(error, 'Не удалось проанализировать изображение.') });
    }
});

app.post('/api/detectPersonBoundingBox', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Нет изображения' });
    try {
        const prompt = "Detect the bounding box of the main person. Return JSON: {\"box_2d\": [ymin, xmin, ymax, xmax]} where coordinates are 0-1000.";
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }] }
        });
        const box = parseBoundingBox(response.text || '');
        res.json({ boundingBox: box });
    } catch (error) {
        res.status(500).json({ error: handleGeminiError(error, 'Ошибка поиска человека.') });
    }
});

app.post('/api/cropFace', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Нет изображения' });
    try {
        const prompt = "Detect the bounding box of the main person's FACE. Return JSON: {\"box_2d\": [ymin, xmin, ymax, xmax]} where coordinates are 0-1000.";
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }] }
        });
        const box = parseBoundingBox(response.text || '');
        if (!box) throw new Error("Лицо не найдено.");
        res.json({ boundingBox: box });
    } catch (error) {
        res.status(500).json({ error: handleGeminiError(error, 'Ошибка поиска лица.') });
    }
});

app.post('/api/cropClothing', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image) return res.status(400).json({ error: 'Нет изображения' });
    try {
        const prompt = "Detect the bounding box of the clothing item. Return JSON: {\"box_2d\": [ymin, xmin, ymax, xmax]} (0-1000).";
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: prompt }] }
        });
        const box = parseBoundingBox(response.text || '');
        res.json({ boundingBox: box });
    } catch (error) {
        res.status(500).json({ error: handleGeminiError(error, 'Ошибка поиска одежды.') });
    }
});

app.post('/api/analyzeImageForText', verifyToken, async (req, res) => {
    const { image, analysisPrompt } = req.body;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: { parts: [{ inlineData: { data: image.base64, mimeType: image.mimeType } }, { text: analysisPrompt }] }
        });
        res.json({ text: response.text });
    } catch (error) {
        res.status(500).json({ error: handleGeminiError(error, 'Ошибка анализа.') });
    }
});

app.post('/api/generatePhotoshoot', verifyToken, authenticateAndCharge(1), async (req, res) => {
    const { parts } = req.body;
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', // Using fast model for page 1
            contents: { parts: parts }
        });
        
        let generatedImage = null;
        if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    generatedImage = { base64: part.inlineData.data, mimeType: part.inlineData.mimeType };
                    break;
                }
            }
        }
        if (!generatedImage) throw new Error("AI не вернул изображение.");

        // Get updated credits
        await db.read();
        const newCredits = db.data.users[req.userEmail].credits;

        res.json({ generatedPhotoshootResult: generatedImage, newCredits });
    } catch (error) {
        res.status(500).json({ error: handleGeminiError(error, 'Ошибка генерации фотосессии.') });
    }
});

// --- UPDATED: Multi-Face Support for Variations ---
app.post('/api/generateFourVariations', verifyToken, authenticateAndCharge(4), async (req, res) => {
    const { prompts, image, faceImages, aspectRatio } = req.body;

    if (!prompts || prompts.length !== 4) return res.status(400).json({ error: 'Неверные промпты.' });
    if (!image) return res.status(400).json({ error: 'Нет основного изображения.' });
    
    // faceImages is an array of face crops. If missing (legacy), fallback to single ref logic or handled inside prompts.
    const faces = (faceImages && Array.isArray(faceImages) && faceImages.length > 0) ? faceImages : [];
    if (faces.length === 0) return res.status(400).json({ error: 'Лицо не найдено. Попробуйте загрузить фото снова.' });

    try {
        const parts = [];
        
        // 1. STYLE REFERENCE (Full Image) - Index 0 in model's view
        parts.push({ inlineData: { data: image.base64, mimeType: image.mimeType } });
        
        // 2. FACE REFERENCES - Indices 1, 2, 3...
        faces.forEach(face => {
            parts.push({ inlineData: { data: face.base64, mimeType: face.mimeType } });
        });

        const faceIndicesText = faces.length === 1 ? "ВТОРОЕ ИЗОБРАЖЕНИЕ" : `ИЗОБРАЖЕНИЯ со 2-го по ${faces.length + 1}-е`;

        // Updated System Prompt for Multi-Face
        const systemPrompt = `
ПЕРВОЕ ИЗОБРАЖЕНИЕ - это ГЛАВНЫЙ референс для стиля, композиции, одежды и фона.
${faceIndicesText} - это ЭТАЛОН(Ы) ВНЕШНОСТИ человека.

Твоя задача:
1. Использовать стиль/одежду/фон с ПЕРВОГО изображения.
2. ИГНОРИРОВАТЬ лицо на первом изображении при генерации черт лица.
3. Взять черты лица (глаза, нос, губы, улыбку, текстуру) ТОЛЬКО с ${faceIndicesText}. Собери идеальное сходство, используя детали со всех предоставленных крупных планов лиц.

Создай одно изображение с высоким разрешением (2K), которое представляет собой сетку (коллаж) 2x2.
Изображение должно состоять из 4 независимых кадров, разделенных тонкими белыми линиями:
1. ВЕРХНИЙ ЛЕВЫЙ КВАДРАТ: ${prompts[0]}
2. ВЕРХНИЙ ПРАВЫЙ КВАДРАТ: ${prompts[1]}
3. НИЖНИЙ ЛЕВЫЙ КВАДРАТ: ${prompts[2]}
4. НИЖНИЙ ПРАВЫЙ КВАДРАТ: ${prompts[3]}

ОЧЕНЬ ВАЖНО: Каждый квадрат должен содержать полноценный, завершенный портрет.
        `;

        parts.push({ text: systemPrompt });

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview', // Using Pro for best likeness
            contents: { parts: parts },
            config: {
                 imageConfig: {
                    aspectRatio: aspectRatio || "1:1", // Use the aspect ratio requested by the client (e.g. "3:4", "4:3")
                    imageSize: "2K"
                }
            }
        });

        let gridImage = null;
        if (response.candidates && response.candidates[0].content && response.candidates[0].content.parts) {
            for (const part of response.candidates[0].content.parts) {
                if (part.inlineData) {
                    gridImage = { base64: part.inlineData.data, mimeType: part.inlineData.mimeType };
                    break;
                }
            }
        }
        if (!gridImage) throw new Error("AI не вернул изображение.");

        await db.read();
        const newCredits = db.data.users[req.userEmail].credits;

        res.json({ gridImageUrl: `data:${gridImage.mimeType};base64,${gridImage.base64}`, newCredits });

    } catch (error) {
        res.status(500).json({ error: handleGeminiError(error, 'Ошибка генерации вариаций.') });
    }
});


app.listen(port, () => {
    console.log(`Сервер запущен на http://localhost:${port}`);
});