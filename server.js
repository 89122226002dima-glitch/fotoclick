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
  console.log('DIAGNOSTICS: ВНИМАНИЕ! Переменная API_KEY не найдена.');
}
if (process.env.GOOGLE_CLIENT_ID) {
  console.log('DIAGNOSTICS: GOOGLE_CLIENT_ID успешно загружен.');
} else {
  console.log('DIAGNOSTICS: КРИТИЧЕСКАЯ ОШИБКА! Переменная GOOGLE_CLIENT_ID не найдена.');
  console.log('DIAGNOSTICS: СЕРВЕР НЕ МОЖЕТ ЗАПУСТИТЬСЯ! API_key или GOOGLE_CLIENT_ID не найден. Сервер не сможет работать.');
  process.exit(1); // Exit if critical env vars are missing
}

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const app = express();
const port = 3001; // Используем порт 3001, как указано в паспорте проекта для Caddy

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// In-memory "database" for user credits
const userCredits = {};
const INITIAL_CREDITS = 1;

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Middleware to verify Google token from Authorization header
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


// Middleware to authenticate and charge credits
const authenticateAndCharge = (cost) => async (req, res, next) => {
    // First, verify the token to get the user's email
    await verifyToken(req, res, async () => {
        const userEmail = req.userEmail;
        if (!userEmail) {
            // This case should be handled by verifyToken, but as a safeguard
            return res.status(401).json({ error: 'Не удалось определить пользователя.' });
        }

        if (userCredits[userEmail] === undefined) {
             return res.status(403).json({ error: 'Пользователь не найден в системе кредитов.' });
        }

        if (userCredits[userEmail] < cost) {
            return res.status(402).json({ error: 'Недостаточно кредитов.' });
        }
        
        userCredits[userEmail] -= cost;
        // The user's email is already on req from verifyToken, so we just proceed
        next();
    });
};

// --- API Routes ---

// Login endpoint
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
        
        // If user is new, grant them initial credits
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

// Endpoint to add credits (simulated payment)
app.post('/api/addCredits', verifyToken, (req, res) => {
    const userEmail = req.userEmail;
    if (userCredits[userEmail] === undefined) {
        // This shouldn't happen for a logged-in user, but handle it
        userCredits[userEmail] = 0;
    }
    userCredits[userEmail] += 12; // Add 12 credits on "payment"
    res.json({ newCredits: userCredits[userEmail] });
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
        
        const jsonString = response.text.match(/\{.*\}/s)[0];
        const subjectDetails = JSON.parse(jsonString);

        res.json({ subjectDetails });

    } catch (error) {
        console.error('Ошибка анализа изображения в Gemini:', error);
        res.status(500).json({ error: 'Не удалось проанализировать изображение.' });
    }
});

// Endpoint for generating a single variation
app.post('/api/generateVariation', authenticateAndCharge(1), async (req, res) => {
    const { prompt, image } = req.body;
    const userEmail = req.userEmail;

    if (!prompt || !image || !image.base64 || !image.mimeType) {
        // Refund if request is bad
        userCredits[userEmail] += 1;
        return res.status(400).json({ error: 'Отсутствует промпт или изображение.' });
    }

    try {
        const imagePart = { inlineData: { data: image.base64, mimeType: image.mimeType } };
        const textPart = { text: prompt };

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash-image', // nano banana
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
        console.error('Ошибка генерации вариации:', error);
        // Refund credits on failure
        userCredits[userEmail] += 1;
        res.status(500).json({ error: 'Не удалось сгенерировать вариацию.' });
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
        console.error('Ошибка генерации фотосессии:', error);
        userCredits[userEmail] += 1; // Refund
        res.status(500).json({ error: 'Не удалось сгенерировать фотосессию.' });
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
        console.error('Ошибка анализа изображения для текста:', error);
        res.status(500).json({ error: 'Не удалось проанализировать изображение.' });
    }
});

app.listen(port, () => {
  console.log(`Сервер запущен на http://localhost:${port}`);
});