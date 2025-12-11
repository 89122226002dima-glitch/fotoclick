

// server.js - Версия с интеграцией LowDB, поддержкой SOCKS5 PROXY и Авто-Тестом соединения

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI, Modality } from '@google/genai';
import { OAuth2Client } from 'google-auth-library';
import { randomUUID } from 'crypto';
import https from 'https'; // Используем нативный https для максимальной надежности
import { HttpsProxyAgent } from 'https-proxy-agent'; // Агент для HTTP прокси
import { SocksProxyAgent } from 'socks-proxy-agent'; // Агент для SOCKS прокси

// --- LowDB Imports ---
import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

dotenv.config();

// --- Диагностика .env ---
console.log('DIAGNOSTICS: Загрузка конфигурации из .env');
if (!process.env.API_KEY) console.log('DIAGNOSTICS: ВНИМАНИЕ! Переменная API_KEY не найдена.');
if (!process.env.GOOGLE_CLIENT_ID) console.log('DIAGNOSTICS: ВНИМАНИЕ! Переменная GOOGLE_CLIENT_ID не найдена.');
if (!process.env.YOOKASSA_SHOP_ID) console.log('DIAGNOSTICS: ВНИМАНИЕ! YOOKASSA_SHOP_ID не найден.');
if (!process.env.YOOKASSA_SECRET_KEY) console.log('DIAGNOSTICS: ВНИМАНИЕ! YOOKASSA_SECRET_KEY не найден.');

let proxyAgent = null;

if (process.env.YOOKASSA_PROXY_URL) {
    console.log(`DIAGNOSTICS: Включен режим PROXY для ЮKassa.`);
    try {
        const proxyUrl = process.env.YOOKASSA_PROXY_URL.trim();
        
        // Автоматическое определение типа прокси
        if (proxyUrl.startsWith('socks')) {
            console.log('DIAGNOSTICS: Обнаружен протокол SOCKS. Используем SocksProxyAgent.');
            proxyAgent = new SocksProxyAgent(proxyUrl);
        } else {
            console.log('DIAGNOSTICS: Обнаружен протокол HTTP/HTTPS. Используем HttpsProxyAgent.');
            proxyAgent = new HttpsProxyAgent(proxyUrl);
        }
        
        console.log(`DIAGNOSTICS: Прокси агент успешно инициализирован.`);
    } catch (e) {
        console.error(`DIAGNOSTICS: Ошибка инициализации прокси агента: ${e.message}`);
    }
} else {
    console.log('DIAGNOSTICS: Режим PROXY выключен (переменная YOOKASSA_PROXY_URL не задана). Запрос пойдет напрямую.');
}

if (!process.env.API_KEY || !process.env.GOOGLE_CLIENT_ID || !process.env.YOOKASSA_SHOP_ID || !process.env.YOOKASSA_SECRET_KEY) {
  console.log('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Одна или несколько переменных окружения отсутствуют. Сервер не может запуститься.');
  // process.exit(1);
} else {
  console.log('DIAGNOSTICS: Все обязательные переменные окружения загружены.');
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

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
});

// --- PROXY CONNECTION TEST ---
// Функция проверяет, работает ли прокси с ЮКассой, при старте сервера
function testProxyConnection() {
    if (!proxyAgent) return;

    console.log('[Proxy Test] Запуск проверки соединения с api.yookassa.ru через прокси...');
    
    const options = {
        hostname: 'api.yookassa.ru',
        port: 443,
        path: '/', // Просто пинг корня или healthcheck, если есть. Или просто коннект.
        method: 'GET',
        agent: proxyAgent,
        headers: {
            'User-Agent': 'FotoclickServer/1.0',
            'Host': 'api.yookassa.ru',
            'Connection': 'close' // Для теста закрываем сразу
        },
        timeout: 15000
    };

    const req = https.request(options, (res) => {
        console.log(`[Proxy Test] Ответ получен! Статус: ${res.statusCode}`);
        if (res.statusCode === 404 || res.statusCode === 401 || res.statusCode === 200) {
             console.log('[Proxy Test] SUCCESS: Прокси работает и видит ЮКассу.');
        } else {
             console.log(`[Proxy Test] WARNING: Странный статус от ЮКассы: ${res.statusCode}.`);
        }
    });

    req.on('error', (e) => {
        console.error(`[Proxy Test] FAILED: Ошибка соединения через прокси: ${e.message}`);
        console.error('Рекомендация: Проверьте правильность логина/пароля прокси или попробуйте сменить протокол на socks5 в .env');
    });

    req.on('timeout', () => {
        console.error('[Proxy Test] FAILED: Таймаут (15 сек). Прокси слишком медленный или недоступен.');
        req.destroy();
    });

    req.end();
}

// Запускаем тест через 2 секунды после старта, чтобы логи успели прогрузиться
setTimeout(testProxyConnection, 2000);


const INITIAL_CREDITS = 5;
const PROMO_CODES = {
    "GEMINI": { type: 'credits', value: 12, message: "Вам начислено 12 кредитов!" },
    "521370": { type: 'credits', value: 500, message: "Владелец активировал 500 кредитов." },
    "521381": { type: 'credits', value: 500, message: "Владелец активировал 500 кредитов." }
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
    if (errorMessage.toLowerCase().includes('permission denied')) {
        return 'Ошибка: Нет прав доступа у API-ключа.';
    }
    if (errorMessage.toLowerCase().includes('safety')) {
        return 'Изображение заблокировано системой безопасности. Попробуйте другое фото.';
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
                 return res.status(404).json({ error: 'Пользователь не найден.' });
            }
            db.data.users[userEmail].credits += promo.value;
            userPromoCodes.push(code.toUpperCase());
            db.data.used_promo_codes[userEmail] = userPromoCodes;

            await db.write();
            
            res.json({
                newCredits: db.data.users[userEmail].credits,
                message: promo.message
            });
        } else {
            res.status(400).json({ error: 'Неподдерживаемый тип промокода.' });
        }
    } catch (dbError) {
        console.error('Ошибка LowDB при применении промокода:', dbError);
        res.status(500).json({ error: 'Ошибка сервера.' });
    }
});

// --- YooKassa Integration (Native HTTPS with PROXY Support) ---
app.post('/api/create-payment', verifyToken, async (req, res) => {
    console.log('[Payment] Received create-payment request.');
    try {
        const { plan } = req.body; // 'small' or 'large'
        const userEmail = req.userEmail;
        const idempotenceKey = randomUUID();
        
        const shopId = process.env.YOOKASSA_SHOP_ID ? process.env.YOOKASSA_SHOP_ID.trim() : '';
        const secretKey = process.env.YOOKASSA_SECRET_KEY ? process.env.YOOKASSA_SECRET_KEY.trim() : '';

        if (!shopId || !secretKey) {
            throw new Error('API Keys for YooKassa are missing in .env');
        }

        // --- NEW: Dynamic Payment Logic ---
        let amountValue = '129.00';
        let descriptionText = 'Пакет "12 фотографий" для photo-click-ai.ru';
        let creditsToAdd = 12;

        if (plan === 'large') {
            amountValue = '500.00';
            descriptionText = 'Пакет "60 фотографий" (Выгодно) для photo-click-ai.ru';
            creditsToAdd = 60;
        }

        const paymentPayload = {
            amount: { value: amountValue, currency: 'RUB' },
            confirmation: { type: 'redirect', return_url: 'https://photo-click-ai.ru?payment_status=success' },
            description: descriptionText,
            metadata: { 
                userEmail: userEmail,
                credits: String(creditsToAdd) // Pass credits amount to metadata
            },
            capture: true
        };

        const auth = Buffer.from(`${shopId}:${secretKey}`).toString('base64');
        
        const makeRequest = () => new Promise((resolve, reject) => {
            const options = {
                hostname: 'api.yookassa.ru',
                port: 443,
                path: '/v3/payments',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotence-Key': idempotenceKey,
                    'Authorization': `Basic ${auth}`,
                    'User-Agent': 'FotoclickServer/1.0',
                    'Host': 'api.yookassa.ru', // Явное указание Host важно для некоторых прокси
                    'Connection': 'keep-alive'
                },
                timeout: 30000 // 30 seconds timeout
            };

            // Используем глобальный агент, если он есть
            if (proxyAgent) {
                options.agent = proxyAgent;
                console.log('[Payment] Using Proxy Agent.');
            }

            console.log('[Payment] Sending request to YooKassa API...');

            const request = https.request(options, (response) => {
                console.log(`[Payment] Response received. Status: ${response.statusCode}`);
                let data = '';
                
                response.on('data', (chunk) => data += chunk);
                
                response.on('end', () => {
                    if (response.statusCode >= 200 && response.statusCode < 300) {
                        try {
                            resolve(JSON.parse(data));
                        } catch (e) {
                            reject(new Error('Invalid JSON from YooKassa'));
                        }
                    } else {
                        // Логируем тело ошибки, но обрезаем если слишком длинное (например HTML от прокси)
                        const safeData = data.length > 500 ? data.substring(0, 500) + '...' : data;
                        console.error(`[Payment] API Error (${response.statusCode}):`, safeData);
                        reject(new Error(`YooKassa API Error (${response.statusCode}): ${safeData}`));
                    }
                });
            });

            request.on('error', (error) => {
                console.error('[Payment] Network Request Error:', error);
                reject(new Error(`Network Error: ${error.message}`));
            });

            request.on('timeout', () => {
                console.error('[Payment] Request Timed Out (30s)');
                request.destroy();
                reject(new Error('Connection to YooKassa timed out. Check Proxy or Internet connection.'));
            });

            request.write(JSON.stringify(paymentPayload));
            request.end();
        });

        const payment = await makeRequest();
        console.log('[Payment] Success. Redirect URL:', payment.confirmation?.confirmation_url);
        res.json({ confirmationUrl: payment.confirmation.confirmation_url });

    } catch (error) {
        console.error('[Payment] Critical Error:', error.message);
        // Отправляем более понятную ошибку на фронтенд
        const uiMessage = error.message.includes('502') ? 'Ошибка прокси-сервера (502). Попробуйте позже.' : error.message;
        res.status(500).json({ error: `Ошибка оплаты: ${uiMessage}` });
    }
});


app.post('/api/payment-webhook', async (req, res) => {
    try {
        const notification = JSON.parse(req.body);
        console.log('Получено уведомление от YooKassa:', notification);

        if (notification.event === 'payment.succeeded') {
            const payment = notification.object;
            const userEmail = payment.metadata.userEmail;
            // Получаем количество кредитов из метаданных, либо ставим 12 (для совместимости)
            const creditsToAdd = payment.metadata.credits ? parseInt(payment.metadata.credits) : 12;

            if (userEmail) {
                await db.read();
                
                if (!db.data.users[userEmail]) {
                     db.data.users[userEmail] = { credits: 0 };
                }
                db.data.users[userEmail].credits += creditsToAdd;
                
                await db.write();
                
                console.log(`Успешно начислено ${creditsToAdd} фотографий пользователю ${userEmail}.`);
            }
        }
        res.status(200).send('OK');
    } catch (error) {
        console.error('Ошибка обработки webhook:', error);
        res.status(500).send('Webhook error');
    }
});


// Check image subject endpoint
app.post('/api/checkImageSubject', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image || !image.base64 || !image.mimeType) return res.status(400).json({ error: 'Изображение не предоставлено.' });
    
    try {
        const prompt = `Проанализируй это изображение и определи, кто на нем изображен, а также его/ее улыбку. Ответь в формате JSON {"category": "...", "smile": "..."}. Возможные значения для "category": "мужчина", "женщина", "подросток", "пожилой мужчина", "пожилая женщина", "ребенок", "другое". Возможные значения для "smile": "зубы", "закрытая", "нет улыбки".`;
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [imagePart, textPart] } });

        const jsonStringMatch = response.text.match(/\{.*\}/s);
        if (!jsonStringMatch) throw new Error("AI вернул некорректный ответ.");
        res.json({ subjectDetails: JSON.parse(jsonStringMatch[0]) });
    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось проанализировать изображение.');
        res.status(500).json({ error: userMessage });
    }
});

// New atomic endpoint for generating 4 variations via a 2x2 grid on Gemini 3 Pro
app.post('/api/generateFourVariations', verifyToken, authenticateAndCharge(4), async (req, res) => {
    const { prompts, image, aspectRatio = '1:1' } = req.body;
    const userEmail = req.userEmail;

    try {
        const gridPrompt = `Создай одно изображение с высоким разрешением (2K), которое представляет собой сетку (коллаж) 2x2.
        Изображение должно состоять из 4 независимых кадров, разделенных тонкими белыми линиями:
        1. ВЕРХНИЙ ЛЕВЫЙ КВАДРАТ: ${prompts[0]}
        2. ВЕРХНИЙ ПРАВЫЙ КВАДРАТ: ${prompts[1]}
        3. НИЖНИЙ ЛЕВЫЙ КВАДРАТ: ${prompts[2]}
        4. НИЖНИЙ ПРАВЫЙ КВАДРАТ: ${prompts[3]}
        ОЧЕНЬ ВАЖНО: Каждый квадрат должен содержать полноценный, завершенный портрет.`;

        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: gridPrompt };

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview',
            contents: { parts: [imagePart, textPart] },
            config: { 
                responseModalities: [Modality.IMAGE],
                imageConfig: { imageSize: '2K', aspectRatio: aspectRatio } 
            },
        });

        const generatedImagePart = response.candidates[0].content.parts.find(part => part.inlineData);
        if (!generatedImagePart || !generatedImagePart.inlineData) throw new Error('Gemini не вернул изображение.');

        const gridImageUrl = `data:${generatedImagePart.inlineData.mimeType};base64,${generatedImagePart.inlineData.data}`;
        
        await db.read();
        res.json({ gridImageUrl, newCredits: db.data.users[userEmail].credits, modelUsed: 'gemini-3-pro-image-preview' });

    } catch (error) {
        await db.read();
        if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 4; // Refund on error
            await db.write();
        }
        const userMessage = handleGeminiError(error, 'Не удалось сгенерировать вариации.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint to get the bounding box of a person
app.post('/api/detectPersonBoundingBox', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image || !image.base64 || !image.mimeType) return res.status(400).json({ error: 'Изображение не предоставлено.' });
    try {
        const prompt = `Найди главного человека на этом изображении и верни координаты его ограничивающей рамки (bounding box). Ответ должен быть СТРОГО в формате JSON: {"x_min": float, "y_min": float, "x_max": float, "y_max": float}, где координаты нормализованы от 0.0 до 1.0.`;
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [imagePart, textPart] } });
        const jsonStringMatch = response.text.match(/\{.*\}/s);
        if (!jsonStringMatch) throw new Error('Gemini did not return valid JSON.');
        res.json({ boundingBox: JSON.parse(jsonStringMatch[0]) });
    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось определить положение человека.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint for Face Cropping (Restore)
app.post('/api/cropFace', verifyToken, async (req, res) => {
    const { image } = req.body;
    if (!image || !image.base64 || !image.mimeType) return res.status(400).json({ error: 'Изображение не предоставлено.' });
    try {
        const prompt = `Find the face of the main person. Return JSON: {"x_min": float, "y_min": float, "x_max": float, "y_max": float} normalized 0-1.`;
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [imagePart, textPart] } });
        const jsonStringMatch = response.text.match(/\{.*\}/s);
        if (!jsonStringMatch) throw new Error('Gemini did not return valid JSON.');
        res.json({ boundingBox: JSON.parse(jsonStringMatch[0]) });
    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось найти лицо.');
        res.status(500).json({ error: userMessage });
    }
});

// New endpoint for intelligent clothing cropping
app.post('/api/cropClothing', verifyToken, async (req, res) => {
    const { image } = req.body;
    try {
        const prompt = `Проанализируй это изображение. Найди основной предмет одежды. Верни JSON: {"boundingBox": {"x_min": float, "y_min": float, "x_max": float, "y_max": float}} normalized.`;
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };
        const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts: [imagePart, textPart] } });
        const jsonStringMatch = response.text.match(/\{.*\}/s);
        if (!jsonStringMatch) throw new Error('Gemini JSON error.');
        res.json(JSON.parse(jsonStringMatch[0]));
    } catch (error) {
        const userMessage = handleGeminiError(error, 'Не удалось найти одежду.');
        res.status(500).json({ error: userMessage });
    }
});


// Endpoint for generating the main photoshoot
app.post('/api/generatePhotoshoot', verifyToken, authenticateAndCharge(1), async (req, res) => {
    const { parts } = req.body;
    const userEmail = req.userEmail;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', 
            contents: { parts: parts },
            config: { responseModalities: [Modality.IMAGE] },
        });
        const generatedImagePart = response.candidates[0].content.parts.find(part => part.inlineData);
        if (!generatedImagePart || !generatedImagePart.inlineData) throw new Error('Gemini не вернул изображение.');
        
        const generatedPhotoshootResult = { base64: generatedImagePart.inlineData.data, mimeType: generatedImagePart.inlineData.mimeType };
        const resultUrl = `data:${generatedPhotoshootResult.mimeType};base64,${generatedPhotoshootResult.base64}`;
        
        await db.read();
        res.json({ resultUrl, generatedPhotoshootResult, newCredits: db.data.users[userEmail].credits });
    } catch (error) {
        await db.read();
        if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 1; // Refund
            await db.write();
        }
        const userMessage = handleGeminiError(error, 'Не удалось сгенерировать фотосессию.');
        res.status(500).json({ error: userMessage });
    }
});

// Endpoint for analyzing image for text description
app.post('/api/analyzeImageForText', verifyToken, async (req, res) => {
    const { image, analysisPrompt } = req.body;
    if (!image || !analysisPrompt) return res.status(400).json({ error: 'Данные не предоставлены.' });
    
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

// Endpoint for Business Card Generation (Updated: No hidden prompts)
app.post('/api/generateBusinessCard', verifyToken, authenticateAndCharge(4), async (req, res) => {
    const { image, refImages, prompt } = req.body;
    const userEmail = req.userEmail;

    try {
        const parts = [{ inlineData: { data: image.base64, mimeType: image.mimeType } }];
        if (refImages && refImages.length) {
            refImages.forEach(ref => parts.push({ inlineData: { data: ref.base64, mimeType: ref.mimeType } }));
        }
        
        // We use the prompt exactly as provided by the user/frontend.
        // If it's empty, we add a generic fallback just to avoid API errors.
        const userTask = prompt && prompt.trim().length > 0 ? prompt : "Сделай 4 вариации карточки товара.";
        
        const fullPrompt = `Create 4 varied business/product card variations (2x2 grid). Product: Image 1. References: Images 2+. Task: ${userTask}. High quality.`;
        parts.push({ text: fullPrompt });

        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-image-preview',
            contents: { parts: parts },
            config: { 
                responseModalities: [Modality.IMAGE],
                imageConfig: { imageSize: '2K', aspectRatio: '3:4' }
            }
        });

        const imgPart = response.candidates[0].content.parts.find(p => p.inlineData);
        if (!imgPart) throw new Error('No image returned');

        await db.read();
        res.json({ 
            gridImageUrl: `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`,
            newCredits: db.data.users[userEmail].credits
        });

    } catch (error) {
        await db.read();
        if(db.data.users[userEmail]) {
            db.data.users[userEmail].credits += 4;
            await db.write();
        }
        res.status(500).json({ error: handleGeminiError(error, 'Business gen failed') });
    }
});

app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});
