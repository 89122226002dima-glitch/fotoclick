/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { GoogleGenAI } from '@google/genai';

// --- НАСТРОЙКА ТЕСТА ---
// Вставьте сюда ключ, который вы хотите проверить.
// Я взял его из вашего последнего файла ecosystem.config.cjs
const API_KEY_TO_TEST = "AIzaSyJD5DrPhonw9Q_VpKHAsheI5d7BUkGkBY";
// --- КОНЕЦ НАСТРОЙКИ ---

const testButton = document.getElementById('test-button') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLParagraphElement;

async function runTest() {
  if (!API_KEY_TO_TEST) {
    statusEl.textContent = 'Ошибка: API-ключ не указан в коде.';
    statusEl.className = 'error';
    return;
  }

  testButton.disabled = true;
  statusEl.textContent = 'Отправка запроса в Google...';
  statusEl.className = '';

  try {
    const ai = new GoogleGenAI({ apiKey: API_KEY_TO_TEST });
    
    // Отправляем самый простой запрос, который только можно
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: 'привет',
    });

    // Если мы получили ответ, значит ключ работает
    console.log('Ответ от Google:', response.text);
    statusEl.textContent = 'Ключ работает!';
    statusEl.className = 'success';

  } catch (error) {
    // Если произошла ошибка, ключ не работает
    console.error('Ошибка при проверке ключа:', error);
    statusEl.textContent = 'Ключ НЕ работает! Проверьте консоль для деталей.';
    statusEl.className = 'error';
  } finally {
    testButton.disabled = false;
  }
}

testButton.addEventListener('click', runTest);
