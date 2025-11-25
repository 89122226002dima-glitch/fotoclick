/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { openDB, IDBPDatabase, DBSchema } from 'idb';

// --- Type Definitions ---
interface ImageState {
  base64: string;
  mimeType: string;
}

interface UserProfile {
  name: string;
  email: string;
  picture: string;
}

type SubjectCategory = 'man' | 'woman' | 'teenager' | 'elderly_man' | 'elderly_woman' | 'child' | 'other';
type SmileType = 'teeth' | 'closed' | 'none';
interface SubjectDetails {
    category: SubjectCategory;
    smile: SmileType;
}

interface Prompts {
    femalePosePrompts: string[];
    femaleGlamourPosePrompts: string[];
    femaleCameraAnglePrompts: string[];
    malePosePrompts: string[];
    maleCameraAnglePrompts: string[];
    femaleCloseUpPosePrompts: string[];
    maleCloseUpPosePrompts: string[];
    elderlyFemalePosePrompts: string[];
    elderlyFemaleCloseUpPosePrompts: string[];
    elderlyMalePosePrompts: string[];
    elderlyMaleCloseUpPosePrompts: string[];
    drasticCameraShiftPrompts: string[];
    femaleClothingSuggestions: string[];
    maleClothingSuggestions: string[];
    teenClothingSuggestions: string[];
    elderlyFemaleClothingSuggestions: string[];
    elderlyMaleClothingSuggestions: string[];
    childClothingSuggestions: string[];
    locationSuggestions: string[];
    childLocationSuggestions: string[];
    teenLocationSuggestions: string[];
    locationSets: { [key: string]: string[] };
    couplePosePrompts: string[];
}

// --- Wizard State ---
type WizardStep = 'PAGE1_PHOTO' | 'PAGE1_CLOTHING' | 'PAGE1_LOCATION' | 'PAGE1_GENERATE' | 'PAGE2_PHOTO' | 'PAGE2_PLAN' | 'PAGE2_GENERATE' | 'CREDITS' | 'AUTH' | 'NONE';

// --- IndexedDB Schema ---
interface HistoryImage {
    id?: number;
    timestamp: number;
    image: ImageState;
}

interface PhotoClickDB extends DBSchema {
    historyImages: {
        key: number;
        value: HistoryImage;
    };
}

// --- DOM Element Variables (will be assigned on DOMContentLoaded) ---
let lightboxOverlay: HTMLDivElement, lightboxImage: HTMLImageElement, lightboxCloseButton: HTMLButtonElement, statusEl: HTMLDivElement,
    planButtonsContainer: HTMLDivElement, generateButton: HTMLButtonElement, resetButton: HTMLButtonElement,
    outputGallery: HTMLDivElement, uploadContainer: HTMLDivElement, imageUpload: HTMLInputElement,
    referenceImagePreview: HTMLImageElement, uploadPlaceholder: HTMLDivElement, customPromptInput: HTMLInputElement,
    referenceDownloadButton: HTMLAnchorElement, paymentModalOverlay: HTMLDivElement, paymentConfirmButton: HTMLButtonElement,
    paymentCloseButton: HTMLButtonElement, creditCounterEl: HTMLDivElement, promoCodeInput: HTMLInputElement,
    applyPromoButton: HTMLButtonElement, authContainer: HTMLDivElement, googleSignInContainer: HTMLDivElement,
    userProfileContainer: HTMLDivElement, userProfileImage: HTMLImageElement, userProfileName: HTMLSpanElement,
    paymentQrView: HTMLDivElement, paymentQrImage: HTMLImageElement, paymentBackButton: HTMLButtonElement;


// --- State Variables ---
let selectedPlan = 'close_up';
let referenceImage: ImageState | null = null;
let referenceImage2: ImageState | null = null; // NEW: Second reference image
let referenceImageLocationPrompt: string | null = null; // NEW: Stores location prompt associated with reference
let detectedSubjectCategory: SubjectCategory | null = null;
let detectedSmileType: SmileType | null = null;
let prompts: Prompts | null = null;
let generationCredits = 0; // All users start with 0 credits until they log in.
let isLoggedIn = false;
let userProfile: UserProfile | null = null;
let idToken: string | null = null;
const GOOGLE_CLIENT_ID = '455886432948-lk8a1e745cq41jujsqtccq182e5lf9dh.apps.googleusercontent.com';
let db: IDBPDatabase<PhotoClickDB>;


let poseSequences: {
    female: string[]; femaleGlamour: string[]; male: string[]; femaleCloseUp: string[]; maleCloseUp: string[];
    elderlyFemale: string[]; elderlyFemaleCloseUp: string[]; elderlyMale: string[]; elderlyMaleCloseUp: string[];
} = {
    female: [], femaleGlamour: [], male: [], femaleCloseUp: [], maleCloseUp: [],
    elderlyFemale: [], elderlyFemaleCloseUp: [], elderlyMale: [], elderlyMaleCloseUp: [],
};

const MAX_DIMENSION = 1024;
const MAX_PRE_RESIZE_DIMENSION = 2048; // A safe dimension for pre-processing large uploads
const HISTORY_LIMIT = 50;

// --- History (IndexedDB) Management Functions ---
async function initDB() {
    db = await openDB<PhotoClickDB>('photoClickDB', 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('historyImages')) {
                db.createObjectStore('historyImages', {
                    keyPath: 'id',
                    autoIncrement: true,
                });
            }
        },
    });
    console.log("База данных истории (IndexedDB) успешно инициализирована.");
}

async function addToHistory(images: ImageState[]) {
    if (!db) return;
    try {
        const tx = db.transaction('historyImages', 'readwrite');
        const store = tx.objectStore('historyImages');
        // Add new images
        for (const image of images) {
            await store.add({ image, timestamp: Date.now() });
        }
        // Enforce limit
        const count = await store.count();
        if (count > HISTORY_LIMIT) {
            let cursor = await store.openCursor();
            let toDelete = count - HISTORY_LIMIT;
            while (cursor && toDelete > 0) {
                await cursor.delete();
                cursor = await cursor.continue();
                toDelete--;
            }
        }
        await tx.done;
    } catch (error) {
        console.error("Не удалось сохранить генерации в историю:", error);
    }
}


/**
 * Sets the current step for the user guidance wizard, highlighting the active element.
 * @param step The wizard step to activate.
 */
function setWizardStep(step: WizardStep) {
    // Define all potential target elements
    const targets = {
        page1Photo: document.getElementById('page1-upload-container'),
        page1Clothing: document.querySelector('#clothing-location-container .step-container:first-child'),
        page1Location: document.querySelector('#clothing-location-container .step-container:last-child'),
        page1Generate: document.getElementById('generate-photoshoot-button'),
        page2Photo: document.getElementById('upload-container'),
        page2Plans: document.getElementById('plan-buttons'),
        page2Generate: document.getElementById('generate-button'),
        credits: document.getElementById('credit-counter'),
        auth: document.getElementById('google-signin-container'),
    };

    // Remove the highlight class from all targets first
    Object.values(targets).forEach(el => el?.classList.remove('highlight-step'));

    // Apply the highlight class to the specific target
    switch (step) {
        case 'PAGE1_PHOTO': targets.page1Photo?.classList.add('highlight-step'); break;
        case 'PAGE1_CLOTHING': targets.page1Clothing?.classList.add('highlight-step'); break;
        case 'PAGE1_LOCATION': targets.page1Location?.classList.add('highlight-step'); break;
        case 'PAGE1_GENERATE': targets.page1Generate?.classList.add('highlight-step'); break;
        case 'PAGE2_PHOTO': targets.page2Photo?.classList.add('highlight-step'); break;
        case 'PAGE2_PLAN': targets.page2Plans?.classList.add('highlight-step'); break;
        case 'PAGE2_GENERATE': targets.page2Generate?.classList.add('highlight-step'); break;
        case 'CREDITS': targets.credits?.classList.add('highlight-step'); break;
        case 'AUTH': targets.auth?.classList.add('highlight-step'); break;
        case 'NONE': // Do nothing, all highlights are cleared
            break;
    }
}

/**
 * Efficiently pre-resizes a large image file before further processing.
 * Uses URL.createObjectURL for better memory management compared to FileReader.
 * @param file The image file to resize.
 * @returns A promise that resolves with the resized image state.
 */
async function preResizeImage(file: File): Promise<ImageState> {
    return new Promise((resolve, reject) => {
        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            return reject(new Error('Файл слишком большой. Максимальный размер 50МБ.'));
        }

        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            let { width, height } = img;

            if (width > MAX_PRE_RESIZE_DIMENSION || height > MAX_PRE_RESIZE_DIMENSION) {
                if (width > height) {
                    height = Math.round((height * MAX_PRE_RESIZE_DIMENSION) / width);
                    width = MAX_PRE_RESIZE_DIMENSION;
                } else {
                    width = Math.round((width * MAX_PRE_RESIZE_DIMENSION) / height);
                    height = MAX_PRE_RESIZE_DIMENSION;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Не удалось получить 2D контекст холста.'));
            
            ctx.drawImage(img, 0, 0, width, height);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const [header, base64] = dataUrl.split(',');
            resolve({ base64, mimeType: 'image/jpeg' });
        };

        img.onerror = (err) => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Не удалось загрузить файл изображения для обработки. Возможно, файл поврежден или не является изображением.'));
        };

        img.src = objectUrl;
    });
}


/**
 * Resizes an image to a maximum dimension while maintaining aspect ratio.
 * @param imageState The original image state with base64 data.
 * @returns A promise that resolves with the new, resized image state.
 */
async function resizeImage(imageState: ImageState): Promise<ImageState> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;

            if (width > height) {
                if (width > MAX_DIMENSION) {
                    height = Math.round((height * MAX_DIMENSION) / width);
                    width = MAX_DIMENSION;
                }
            } else {
                if (height > MAX_DIMENSION) {
                    width = Math.round((width * MAX_DIMENSION) / height);
                    height = MAX_DIMENSION;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Не удалось получить 2D контекст холста для изменения размера изображения.'));
            }
            ctx.drawImage(img, 0, 0, width, height);

            // Convert to JPEG for better compression for photographic images, with a quality of 90%
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const [header, base64] = dataUrl.split(',');
            const mimeType = 'image/jpeg';

            resolve({ base64, mimeType });
        };
        img.onerror = (err) => {
            console.error("Ошибка при загрузке изображения для изменения размера:", err);
            reject(new Error('Не удалось загрузить изображение для обработки.'));
        };
        img.src = `data:${imageState.mimeType};base64,${imageState.base64}`;
    });
}

/**
 * Crops an image based on normalized coordinates using the HTML Canvas API.
 * @param imageState The original image state.
 * @param boundingBox The normalized coordinates for the crop area.
 * @returns A promise that resolves with the new, cropped image state.
 */
async function cropImageByCoords(imageState: ImageState, boundingBox: { x_min: number, y_min: number, x_max: number, y_max: number }): Promise<ImageState> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const sx = boundingBox.x_min * img.width;
            const sy = boundingBox.y_min * img.height;
            const sWidth = (boundingBox.x_max - boundingBox.x_min) * img.width;
            const sHeight = (boundingBox.y_max - boundingBox.y_min) * img.height;

            if (sWidth <= 0 || sHeight <= 0) {
                return reject(new Error('Неверные координаты для обрезки.'));
            }

            const canvas = document.createElement('canvas');
            canvas.width = sWidth;
            canvas.height = sHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Не удалось получить 2D контекст холста для обрезки.'));
            }
            ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);

            const dataUrl = canvas.toDataURL('image/jpeg', 0.9); // Use jpeg for consistency
            const [, base64] = dataUrl.split(',');
            resolve({ base64, mimeType: 'image/jpeg' });
        };
        img.onerror = (err) => {
            reject(new Error('Не удалось загрузить изображение для обрезки.'));
        };
        img.src = `data:${imageState.mimeType};base64,${imageState.base64}`;
    });
}

// --- NEW: Helper to slice a 2x2 grid image into 4 separate images ---
async function sliceGridImage(gridBase64: string, gridMimeType: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const w = img.width;
            const h = img.height;
            const halfW = Math.floor(w / 2);
            const halfH = Math.floor(h / 2);
            const imageUrls: string[] = [];

            // Order: Top-Left, Top-Right, Bottom-Left, Bottom-Right
            const positions = [
                { x: 0, y: 0 },
                { x: halfW, y: 0 },
                { x: 0, y: halfH },
                { x: halfW, y: halfH }
            ];

            positions.forEach(pos => {
                const canvas = document.createElement('canvas');
                canvas.width = halfW;
                canvas.height = halfH;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, pos.x, pos.y, halfW, halfH, 0, 0, halfW, halfH);
                    // Force PNG format to ensure high quality and larger file size (~2.5MB)
                    imageUrls.push(canvas.toDataURL('image/png'));
                }
            });
            resolve(imageUrls);
        };
        img.onerror = (e) => reject(new Error("Failed to load grid image for slicing"));
        img.src = `data:${gridMimeType};base64,${gridBase64}`;
    });
}


/**
 * A generic helper function to make API calls to our own server backend.
 * It automatically includes the authentication token and adds a timeout.
 * @param endpoint The API endpoint to call.
 * @param body The JSON payload to send.
 * @returns A promise that resolves with the JSON response from the server.
 */
async function callApi(endpoint: string, body: object) {
    const controller = new AbortController();
    // 90-second timeout for API calls to support high-res 2K generation on Gemini 3 Pro
    const timeoutId = setTimeout(() => controller.abort(), 90000);

    const headers: HeadersInit = {
        'Content-Type': 'application/json',
    };
    const currentToken = localStorage.getItem('idToken');
    if (currentToken) {
        headers['Authorization'] = `Bearer ${currentToken}`;
    }

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(body),
            signal: controller.signal,
        });
    } catch (error) {
        // This block catches network errors (e.g., CORS, DNS, no internet) and timeouts.
        if (error.name === 'AbortError' || error instanceof TypeError) {
            console.error(`API call to ${endpoint} failed or timed out. Error:`, error);
            // This user-friendly message addresses the user's suspicion directly.
            throw new Error('Не удалось связаться с сервером. Это может быть связано с проблемами сети или долгим временем генерации. Проверьте ваше соединение и попробуйте снова.');
        }
        // Re-throw any other unexpected errors.
        throw error;
    } finally {
        // Always clear the timeout, whether the request succeeded, failed, or timed out.
        clearTimeout(timeoutId);
    }

    const responseText = await response.text();
    let responseData;
    
    try {
        responseData = JSON.parse(responseText);
    } catch (e) {
        if (!response.ok) {
            console.error("Non-JSON error response from server:", responseText);
            throw new Error(`Сервер вернул неожиданный ответ (${response.status}).`);
        }
        console.warn("An OK response was not in JSON format:", responseText);
        return { error: 'Некорректный ответ от сервера.' };
    }

    if (!response.ok) {
        if (response.status === 401) {
             console.log("Сессия истекла. Пользователю нужно войти снова.");
             signOut();
             throw new Error("Ваша сессия истекла. Пожалуйста, войдите снова.");
        }
        console.error(`Ошибка API на ${endpoint}:`, responseData);
        throw new Error(responseData.error || `Произошла ошибка (${response.status}).`);
    }

    return responseData;
}


// --- Core Functions (defined globally, but depend on state) ---
function hideLightbox() {
    if (lightboxOverlay) {
      lightboxOverlay.classList.add('opacity-0', 'pointer-events-none');
      // Delay clearing the src to allow the fade-out animation to complete
      setTimeout(() => { if (lightboxImage) lightboxImage.src = ''; }, 300);
    }
}

function openLightbox(imageUrl: string) {
    if (lightboxImage && lightboxOverlay) {
        lightboxImage.src = imageUrl;
        lightboxOverlay.classList.remove('opacity-0', 'pointer-events-none');
    }
}

function shuffle<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function initializePoseSequences() {
    if (!prompts) return;
    poseSequences.female = shuffle(prompts.femalePosePrompts);
    poseSequences.femaleGlamour = shuffle(prompts.femaleGlamourPosePrompts);
    poseSequences.male = shuffle(prompts.malePosePrompts);
    poseSequences.femaleCloseUp = shuffle(prompts.femaleCloseUpPosePrompts);
    poseSequences.maleCloseUp = shuffle(prompts.maleCloseUpPosePrompts);
    poseSequences.elderlyFemale = shuffle(prompts.elderlyFemalePosePrompts);
    poseSequences.elderlyFemaleCloseUp = shuffle(prompts.elderlyFemaleCloseUpPosePrompts);
    poseSequences.elderlyMale = shuffle(prompts.elderlyMalePosePrompts);
    poseSequences.elderlyMaleCloseUp = shuffle(prompts.elderlyMaleCloseUpPosePrompts);
}

function updateCreditCounterUI() {
    if (creditCounterEl) {
        creditCounterEl.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-yellow-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M8.433 7.418c.158-.103.346-.196.567-.267v1.698a2.5 2.5 0 00-.567-.267C8.07 8.488 8 8.731 8 9c0 .269.07.512.433.582.221.07.41.164.567.267v1.698c-.22.071-.409.164-.567-.267C8.07 11.512 8 11.731 8 12c0 .269.07.512.433.582.221.07.41.164.567.267v1.698c-1.135-.285-2-1.201-2-2.423 0-1.209.865-2.138 2-2.423v-1.698c.221.07.41.164.567.267C11.93 8.488 12 8.731 12 9c0 .269-.07-.512-.433-.582-.221-.07-.41-.164-.567-.267V7.862c1.135.285 2 1.201 2 2.423 0 1.22-.865-2.138-2 2.423v1.698a2.5 2.5 0 00.567-.267c.364-.24.433-.482.433-.582 0-.269-.07-.512-.433-.582-.221-.07-.41-.164-.567-.267V12.14c1.135-.285 2-1.201 2-2.423s-.865-2.138-2-2.423V5.577c1.135.285 2 1.201 2 2.423 0 .269.07.512.433.582.221.07.409.164.567.267V7.862a2.5 2.5 0 00-.567-.267C11.93 7.512 12 7.269 12 7c0-1.22-.865-2.138-2-2.423V3a1 1 0 00-2 0v1.577C6.865 4.862 6 5.78 6 7c0 .269.07.512.433.582.221.07.41.164.567.267V6.14a2.5 2.5 0 00-.567-.267C5.07 5.512 5 5.269 5 5c0-1.22.865-2.138 2-2.423V1a1 1 0 10-2 0v1.577c-1.135-.285-2 1.201-2 2.423s.865 2.138 2 2.423v1.698c-.221-.07-.41-.164-.567-.267C4.07 8.488 4 8.731 4 9s.07.512.433.582c.221.07.41.164.567.267v1.698a2.5 2.5 0 00.567.267C4.07 11.512 4 11.731 4 12s.07.512.433.582c.221.07.41.164.567.267v1.698c-.221-.07-.409-.164-.567-.267C4.07 13.512 4 13.731 4 14c0 1.22.865 2.138 2 2.423v1.577a1 1 0 102 0v-1.577c1.135-.285 2-1.201 2-2.423s-.865-2.138-2-2.423v-1.698c.221.07.41.164.567.267.364.24.433.482.433.582s-.07.512-.433-.582c-.221-.07-.41-.164-.567-.267v1.698a2.5 2.5 0 00.567.267c.364.24.433.482.433.582s-.07.512-.433-.582c-.221-.07-.41-.164-.567-.267V13.86c-1.135-.285-2-1.201-2-2.423s.865-2.138 2-2.423V7.862c-.221-.07-.41-.164-.567-.267C8.07 7.512 8 7.269 8 7c0-.269.07.512.433-.582z" /></svg>
            <span class="credit-value">${generationCredits}</span>
            <span class="hidden sm:inline credit-label">кредитов</span>
        `;
    }
}

function selectPlan(plan: string) {
  selectedPlan = plan;
  const buttons = planButtonsContainer.querySelectorAll<HTMLButtonElement>('.plan-button');
  buttons.forEach((btn) => btn.classList.remove('selected'));
  const buttonToSelect = planButtonsContainer.querySelector(`button[data-plan="${plan}"]`) as HTMLButtonElement;
  if (buttonToSelect) buttonToSelect.classList.add('selected');
  setWizardStep('PAGE2_GENERATE');
}

function resetApp() {
  referenceImage = null;
  referenceImage2 = null; // NEW: Reset second image
  referenceImageLocationPrompt = null;
  detectedSubjectCategory = null;
  detectedSmileType = null;
  initializePoseSequences();
  referenceImagePreview.src = '';
  referenceImagePreview.classList.add('hidden');
  const secondaryContainer = document.getElementById('secondary-images-container');
  if (secondaryContainer) secondaryContainer.innerHTML = '';
  referenceDownloadButton.href = '#';
  referenceDownloadButton.removeAttribute('download');
  referenceDownloadButton.classList.add('hidden');
  uploadPlaceholder.classList.remove('hidden');
  uploadContainer.classList.add('aspect-square');
  imageUpload.value = '';
  outputGallery.innerHTML = '';
  selectPlan('close_up');
  customPromptInput.value = '';
  statusEl.innerText = 'Приложение сброшено. Загрузите новое изображение.';
  const progressContainer = document.querySelector('#progress-container');
  progressContainer?.classList.add('hidden');
  setControlsDisabled(false);
  updateAllGenerateButtons();
  setWizardStep('NONE');
}

function showStatusError(message: string) {
  statusEl.innerHTML = `<span class="text-red-400">${message}</span>`;
}

function setControlsDisabled(disabled: boolean) {
  resetButton.disabled = disabled;
  imageUpload.disabled = disabled;
  customPromptInput.disabled = disabled;
  const buttons = planButtonsContainer.querySelectorAll<HTMLButtonElement>('button');
  buttons.forEach((btn) => (btn.disabled = disabled));
  if (disabled) {
    generateButton.disabled = true;
  } else {
    updateAllGenerateButtons();
  }
}

function displayErrorInContainer(container: HTMLElement, message: string, clearContainer = true) {
  if (clearContainer) container.innerHTML = '';
  const errorContainer = document.createElement('div');
  errorContainer.className = 'bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center flex flex-col items-center justify-center w-full';
  if (container.id === 'output-gallery' || container.id === 'history-gallery') errorContainer.classList.add('col-span-1', 'sm:col-span-2');
  errorContainer.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-red-400 mb-4" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
    </svg>
    <p class="text-red-300 text-lg">${message}</p>
    <p class="text-gray-600 text-sm mt-4">Попробуйте выполнить действие еще раз. Если ошибка повторяется, попробуйте изменить запрос или обновить страницу.</p>
  `;
  if (clearContainer) {
    container.appendChild(errorContainer);
  } else {
    container.prepend(errorContainer);
  }
}

function showGalleryError(message: string, clearContainer = true) {
  displayErrorInContainer(outputGallery, message, clearContainer);
}

function getPlanInstruction(plan: string): string {
  switch (plan) {
    case 'close_up': return 'композиция кадра: ПОРТРЕТНОЕ ФОТО ОТ ГРУДИ, крупный план';
    case 'medium_shot': return 'композиция кадра: портрет по пояс';
    case 'full_shot': return 'композиция кадра: человек виден в полный рост';
    default: return '';
  }
}

function getPlanDisplayName(plan: string): string {
  switch (plan) {
    case 'close_up': return 'Крупный план';
    case 'medium_shot': return 'Средний план';
    case 'full_shot': return 'Общий план';
    default: return 'Пользовательский план';
  }
}

async function checkImageSubject(image: ImageState): Promise<SubjectDetails> {
  try {
    const data = await callApi('/api/checkImageSubject', { image });
    const result = data.subjectDetails;

    const categoryMapping: { [key: string]: SubjectCategory } = {
        'мужчина': 'man', 'женщина': 'woman', 'подросток': 'teenager',
        'пожилой мужчина': 'elderly_man', 'пожилая женщина': 'elderly_woman',
        'ребенок': 'child', 'другое': 'other',
    };
    const smileMapping: { [key: string]: SmileType } = {
        'зубы': 'teeth', 'закрытая': 'closed', 'нет улыбки': 'none',
    };

    const category = categoryMapping[result.category] || 'other';
    const smile = smileMapping[result.smile] || 'none';
    return { category, smile };

  } catch (e) {
    console.error('Subject check failed:', e);
    throw new Error(e instanceof Error ? e.message : 'Не удалось проанализировать изображение.');
  }
}

function updateAllGenerateButtons() {
    if (generateButton) {
        const creditsNeeded = 4;
        if (generationCredits >= creditsNeeded) {
            generateButton.innerHTML = `Создать 4 фотографии (Осталось: ${generationCredits})`;
            generateButton.disabled = !referenceImage;
        } else {
            generateButton.disabled = false; // Always enabled to show prompt
            if (!isLoggedIn) {
                generateButton.innerHTML = `Войти, чтобы продолжить`;
            } else {
                generateButton.innerHTML = `Пополнить кредиты (${creditsNeeded} необх.)`;
            }
        }
    }
}

const setAsReference = (imgContainer: HTMLElement, imgSrc: string) => {
    const [header, base64] = imgSrc.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
    referenceImage = { base64, mimeType };
    referenceImage2 = null; // NEW: When setting generated image as reference, we usually use just that one
    referenceImageLocationPrompt = null; // NEW: Reset location prompt on re-reference
    referenceImagePreview.src = imgSrc;
    const secondaryContainer = document.getElementById('secondary-images-container');
    if (secondaryContainer) secondaryContainer.innerHTML = '';
    referenceDownloadButton.href = imgSrc;
    referenceDownloadButton.download = `variation-reference-${Date.now()}.png`;
    referenceDownloadButton.classList.remove('hidden');
    initializePoseSequences();
    uploadContainer.classList.remove('aspect-square');
    outputGallery.querySelectorAll<HTMLDivElement>('.gallery-item').forEach(c => c.classList.remove('is-reference'));
    imgContainer.classList.add('is-reference');
    statusEl.innerText = 'Новый референс выбран. Создайте новые вариации.';
    setWizardStep('PAGE2_PLAN');
};

async function generate() {
  const creditsNeeded = 4;

  if (!isLoggedIn) {
      setWizardStep('AUTH');
      showStatusError('Пожалуйста, войдите, чтобы получить кредиты для генерации.');
      return;
  }

  if (generationCredits < creditsNeeded) {
      const modalTitle = document.querySelector('#payment-modal-title');
      const modalDescription = document.querySelector('#payment-modal-description');
      if (modalTitle) modalTitle.textContent = "Недостаточно кредитов!";
      if (modalDescription) modalDescription.innerHTML = `У вас ${generationCredits} кредитов. Для создания ${creditsNeeded} вариаций требуется ${creditsNeeded}. Пополните баланс, чтобы купить <strong>пакет '12 фотографий'</strong> за 129 ₽.`;
      
      setWizardStep('CREDITS');
      showPaymentModal();
      return;
  }
  
  if (!referenceImage || !detectedSubjectCategory || !prompts) {
    showStatusError('Пожалуйста, загрузите изображение-референс человека.');
    return;
  }

  initializePoseSequences(); // Re-shuffle poses for every new generation batch.

  const progressContainer = document.querySelector('#progress-container') as HTMLDivElement;
  const progressBar = document.querySelector('#progress-bar') as HTMLDivElement;
  const progressText = document.querySelector('#progress-text') as HTMLDivElement;

  statusEl.innerText = 'Генерация вариаций...';
  setControlsDisabled(true);
  setWizardStep('NONE');

  const divider = document.createElement('div');
  const timestamp = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  divider.className = 'col-span-2 w-full mt-6 pt-4 border-t border-[var(--border-color)] flex justify-between items-center text-sm';
  divider.innerHTML = `<span class="font-semibold text-gray-300">${getPlanDisplayName(selectedPlan)}</span><span class="text-gray-500">${timestamp}</span>`;
  outputGallery.prepend(divider);

  // --- ASPECT RATIO DETECTION ---
  let aspectRatioRequest = '1:1';
  let aspectClass = 'aspect-square';
  try {
      const img = new Image();
      img.src = `data:${referenceImage.mimeType};base64,${referenceImage.base64}`;
      await new Promise<void>(resolve => { img.onload = () => resolve(); img.onerror = () => resolve(); });
      if (img.width && img.height) {
          const ratio = img.width / img.height;
          if (ratio < 0.85) {
              aspectRatioRequest = '3:4';
              aspectClass = 'aspect-[3/4]';
          } else if (ratio > 1.15) {
              aspectRatioRequest = '4:3';
              aspectClass = 'aspect-[4/3]';
          }
      }
  } catch (e) { console.warn('Could not detect aspect ratio, defaulting to square', e); }
  // ------------------------------

  const placeholders: HTMLDivElement[] = [];
  for (let i = 0; i < 4; i++) {
    const placeholder = document.createElement('div');
    placeholder.className = `bg-[#353739] rounded-lg relative overflow-hidden ${aspectClass} placeholder-shimmer`;
    placeholders.push(placeholder);
  }
  placeholders.slice().reverse().forEach((p) => outputGallery.prepend(p));

  if (progressContainer && progressBar && progressText) {
      progressContainer.classList.remove('hidden');
      progressBar.style.width = '10%'; // Start with a small progress
      progressText.innerText = 'Отправка запросов...';
  }

  try {
    // --- NEW HYBRID PROMPT LOGIC ---
    let finalLocationPrompt = referenceImageLocationPrompt;
    if (!finalLocationPrompt && referenceImage) {
        statusEl.innerText = 'Анализ фона референса для создания единого стиля...';
        try {
            finalLocationPrompt = await analyzeImageForText(referenceImage, "Опиши фон или локацию на этом изображении одним коротким, но емким предложением. Ответ должен быть только описанием, без лишних слов.");
        } catch (e) {
            console.warn("Анализ фона не удался, будет использован стандартный метод расширения фона.", e);
            finalLocationPrompt = null;
        }
    }
    // --- END OF NEW LOGIC ---

    let poses: string[], glamourPoses: string[] = [];
    const angles = (detectedSubjectCategory === 'man' || detectedSubjectCategory === 'elderly_man') ? prompts.maleCameraAnglePrompts : prompts.femaleCameraAnglePrompts;
    if (selectedPlan === 'close_up') {
        switch (detectedSubjectCategory) {
            case 'man': poses = poseSequences.maleCloseUp; break;
            case 'woman': poses = poseSequences.femaleCloseUp; glamourPoses = poseSequences.femaleGlamour; break;
            case 'elderly_man': poses = poseSequences.elderlyMaleCloseUp; break;
            case 'elderly_woman': poses = poseSequences.elderlyFemaleCloseUp; break;
            default: poses = poseSequences.femaleCloseUp; break;
        }
    } else {
        switch (detectedSubjectCategory) {
            case 'man': poses = poseSequences.male; break;
            case 'woman': poses = poseSequences.female; glamourPoses = poseSequences.femaleGlamour; break;
            case 'elderly_man': poses = poseSequences.elderlyMale; break;
            case 'elderly_woman': poses = poseSequences.elderlyFemale; break;
            default: poses = poseSequences.female; break;
        }
    }

    if (detectedSmileType === 'closed' || detectedSmileType === 'none') {
        const smileKeywords = ['улыбка', 'улыбкой', 'смех', 'смеется', 'ухмылка', 'веселая'];
        poses = poses.filter(prompt => !smileKeywords.some(keyword => prompt.toLowerCase().includes(keyword)));
        if (glamourPoses.length > 0) glamourPoses = glamourPoses.filter(prompt => !smileKeywords.some(keyword => prompt.toLowerCase().includes(keyword)));
    }

    const availableStandardAngles = shuffle(angles);
    const availableDrasticShifts = shuffle(prompts.drasticCameraShiftPrompts);

    const generationPrompts: string[] = [];
    for (let i = 0; i < 4; i++) {
        const allChanges: string[] = [];
        const planInstruction = getPlanInstruction(selectedPlan);
        if (planInstruction) allChanges.push(planInstruction);

        const useDrasticShift =
            (selectedPlan === 'full_shot' && i >= 2) || // Для общего плана, используем креатив на 3-м и 4-м
            ((selectedPlan === 'medium_shot' || selectedPlan === 'close_up') && i === 3); // Для остальных, используем креатив на 4-м

        let cameraAnglePrompt = '';
        if (useDrasticShift) {
            // Пытаемся взять креативный ракурс, если нет - стандартный
            cameraAnglePrompt = availableDrasticShifts.pop() || availableStandardAngles.pop() || '';
        } else {
            // Пытаемся взять стандартный ракурс, если нет - креативный
            cameraAnglePrompt = availableStandardAngles.pop() || availableDrasticShifts.pop() || '';
        }
        allChanges.push(cameraAnglePrompt);

        // Всегда добавляем позу для разнообразия, если она доступна
        let currentPose: string;
        if (detectedSubjectCategory === 'woman' && glamourPoses.length > 0 && i < 2) { // Используем гламурные позы для первых 2 фото женщины
            currentPose = glamourPoses.pop() || poses.pop() || ''; // Берем гламурную, если кончились - обычную
        } else if (detectedSubjectCategory === 'man' || detectedSubjectCategory === 'elderly_man') {
            currentPose = poses.pop() || '';
        } else { // Для всех остальных
            currentPose = poses.pop() || '';
        }
        if (currentPose) allChanges.push(currentPose);

        const customText = customPromptInput.value.trim();
        const changesDescription = allChanges.filter(Boolean).join(', ');

        let backgroundPromptPart: string;
        if (finalLocationPrompt) {
            backgroundPromptPart = `4. **РАСШИРЬ ЛОКАЦИЮ:** Сгенерируй новый фон для локации "${finalLocationPrompt}". **Важно:** сохрани стиль, атмосферу и цветовую палитру фона с референсного фото, чтобы все изображения выглядели как единая фотосессия. Фон должен соответствовать новому ракурсу камеры.`;
        } else {
            backgroundPromptPart = `4.  **РАСШИРЬ ФОН:** Сохрани стиль, атмосферу и ключевые детали фона с референсного фото, но дострой и сгенерируй его так, чтобы он соответствовал новому ракурсу камеры. Представь, что ты поворачиваешь камеру в том же самом месте.`;
        }
        
        // UPDATED PROMPT HERE
        let finalPrompt = `Это референсное фото. Твоя задача — сгенерировать новое изображение это фото гламурной фотосессии с художественной ретушью, следуя строгим правилам.\n\nКРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:\n1.  **АБСОЛЮТНАЯ УЗНАВАЕМОСТЬ:** Внешность, уникальные черты лица (форма носа, глаз, губ), цвет кожи, прическа и выражение лица человека должны остаться АБСОЛЮТНО ИДЕНТИЧНЫМИ оригиналу. Это самое важное правило.`;
        
        // NEW: Add instruction about dual reference if applicable
        if (referenceImage2) {
            finalPrompt += `\n**ВАЖНО: Я предоставляю ДВА референсных фото одного и того же человека. Проанализируй оба изображения, чтобы создать максимально точный цифровой двойник. Используй черты лица с обоих снимков для улучшения сходства.**\n`;
        }

        finalPrompt += `\n2.  **НОВАЯ КОМПОЗИЦИЯ И РАКУРС:** Примени следующие изменения: "${changesDescription}". Это главный творческий элемент.\n3.  **СОХРАНИ ОДЕЖДУ:** Одежда человека должна быть взята с референсного фото.\n${backgroundPromptPart}`;
        
        if (customText) {
            finalPrompt += `\n5. **ВАЖНОЕ ДОПОЛНЕНИЕ:** Также учти это пожелание: "${customText}".`;
        }

        finalPrompt += `\n6. **ЦИФРОВОЙ ДВОЙНИК:** СГЕНЕРИРОВАННОЕ ЛИЦО ДОЛЖНО БЫТЬ ЦИФРОВЫМ ДВОЙНИКОМ РЕФЕРЕНСНОГО ЛИЦА С УЧЕТОМ ОСВЕЩЕНИЯ И ЭМОЦИЙ.`;
        
        finalPrompt += `\n\n**КАЧЕСТВО:** стандартное разрешение, оптимизировано для веб.\n\nРезультат — только одно изображение без текста.`;
        generationPrompts.push(finalPrompt);
    }
    
    if (progressText) progressText.innerText = 'Генерация (это может занять до 40 секунд)...';

    // --- UPDATED API CALL FOR SINGLE GRID IMAGE ---
    const { gridImageUrl, newCredits } = await callApi('/api/generateFourVariations', {
        prompts: generationPrompts,
        image: referenceImage!,
        image2: referenceImage2 || undefined, // Pass the second image if exists
        aspectRatio: aspectRatioRequest // Pass detected ratio
    });
    
    if (progressText) progressText.innerText = 'Обработка результатов...';

    // --- SLICE THE GRID IMAGE CLIENT-SIDE ---
    const [header, gridBase64] = gridImageUrl.split(',');
    const gridMimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
    const imageUrls = await sliceGridImage(gridBase64, gridMimeType);

    if (progressBar && progressText) {
        progressBar.style.width = `100%`;
        progressText.innerText = `Обработка завершена!`;
    }

    generationCredits = newCredits;
    updateCreditCounterUI();
    updateAllGenerateButtons();

    imageUrls.forEach((imageUrl: string, i: number) => {
        const imgContainer = placeholders[i];
        imgContainer.classList.remove('placeholder-shimmer');
        imgContainer.innerHTML = '';
        
        imgContainer.classList.add('cursor-pointer', 'gallery-item');
        const img = document.createElement('img');
        img.src = imageUrl;
        img.alt = 'Сгенерированная вариация';
        img.className = 'w-full h-full object-cover block rounded-lg';
        imgContainer.appendChild(img);
        imgContainer.innerHTML += `
            <div class="ref-indicator absolute top-2 left-2 bg-blue-500 text-white p-1.5 rounded-full z-20" title="Текущий референс">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" /></svg>
            </div>
            <a href="${imageUrl}" download="variatsiya-${Date.now()}.png" class="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-colors z-20" title="Скачать изображение">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
            </a>
            <button class="set-ref-button absolute bottom-2 left-2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-colors z-20" title="Сделать референсом">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" /></svg>
            </button>`;
        
        imgContainer.querySelector('a')?.addEventListener('click', e => e.stopPropagation());
        imgContainer.querySelector('.set-ref-button')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setAsReference(imgContainer, img.src); });
        imgContainer.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('a, button')) openLightbox(img.src); });
    });

    const imageStatesToSave: ImageState[] = imageUrls.map((url: string) => {
        const [header, base64] = url.split(',');
        const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
        return { base64, mimeType };
    });
    await addToHistory(imageStatesToSave);

    if (progressContainer) setTimeout(() => progressContainer.classList.add('hidden'), 1000);
    statusEl.innerText = 'Вариации сгенерированы. Кликните на результат, чтобы сделать его новым референсом.';
    if (referenceImage) setWizardStep('PAGE2_PLAN');

  } catch (e) {
    placeholders.forEach(p => p.remove());
    divider.remove();
    if (progressContainer) progressContainer.classList.add('hidden');
    const errorMessage = e instanceof Error ? e.message : 'Произошла неизвестная ошибка.';
    showGalleryError(errorMessage, false);
    showStatusError('Произошла ошибка. См. подробности выше.');
  } finally {
    setControlsDisabled(false);
  }
}

async function renderHistoryPage() {
    const historyGallery = document.getElementById('history-gallery');
    if (!historyGallery || !db) return;

    historyGallery.innerHTML = `<div class="loading-spinner col-span-full mx-auto"></div>`;

    try {
        const images = await db.getAll('historyImages');
        images.sort((a, b) => b.timestamp - a.timestamp); // Show newest first

        if (images.length === 0) {
            historyGallery.innerHTML = `<p class="text-center col-span-full mt-8">История генераций пуста. Создайте свои первые вариации!</p>`;
            return;
        }

        historyGallery.innerHTML = ''; // Clear loader
        images.forEach(historyItem => {
            const imageUrl = `data:${historyItem.image.mimeType};base64,${historyItem.image.base64}`;
            const imgContainer = document.createElement('div');
            imgContainer.className = 'cursor-pointer gallery-item';
            
            const img = document.createElement('img');
            img.src = imageUrl;
            img.alt = 'Сгенерированная вариация из истории';
            img.className = 'w-full h-full object-cover block rounded-lg';
            imgContainer.appendChild(img);

            imgContainer.innerHTML += `
                <a href="${imageUrl}" download="history-${historyItem.timestamp}.png" class="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-colors z-20" title="Скачать изображение">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
                </a>
                <button class="set-ref-button absolute bottom-2 left-2 bg-black bg-opacity-50 text-white p-2 rounded-full hover:bg-opacity-75 transition-colors z-20" title="Сделать референсом">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12a2 2 0 100-4 2 2 0 000 4z" /><path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.022 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd" /></svg>
                </button>`;
            
            imgContainer.querySelector('a')?.addEventListener('click', e => e.stopPropagation());
            
            imgContainer.querySelector('.set-ref-button')?.addEventListener('click', async (e) => {
                e.preventDefault();
                e.stopPropagation();
                
                // Set as reference logic
                referenceImage = historyItem.image;
                referenceImage2 = null; // NEW: History item is a single image reference
                referenceImageLocationPrompt = null; // NEW: History items don't have a baked-in prompt
                const dataUrl = `data:${referenceImage.mimeType};base64,${referenceImage.base64}`;
                referenceImagePreview.src = dataUrl;
                referenceImagePreview.classList.remove('hidden');
                const secondaryContainer = document.getElementById('secondary-images-container');
                if (secondaryContainer) secondaryContainer.innerHTML = '';
                referenceDownloadButton.href = dataUrl;
                referenceDownloadButton.download = `restored-reference-${Date.now()}.png`;
                referenceDownloadButton.classList.remove('hidden');
                uploadPlaceholder.classList.add('hidden');
                uploadContainer.classList.remove('aspect-square');
                outputGallery.innerHTML = '';
                
                statusEl.innerText = 'Анализ фото из истории...';
                (window as any).navigateToPage('page2');
                
                try {
                    const { category, smile } = await checkImageSubject(referenceImage);
                    detectedSubjectCategory = category;
                    detectedSmileType = smile;
                    initializePoseSequences();
                    if (category === 'other') {
                        showStatusError('На фото не обнаружен человек. Попробуйте другое изображение.');
                        resetApp();
                        return;
                    }
                    const subjectMap = { woman: 'женщина', man: 'мужчина', teenager: 'подросток', elderly_woman: 'пожилая женщина', elderly_man: 'пожилый мужчина', child: 'ребенок' };
                    statusEl.innerText = `Изображение из истории загружено. Обнаружен: ${subjectMap[category] || 'человек'}.`;
                    setWizardStep('PAGE2_PLAN');
                } catch (error) {
                    showStatusError(error instanceof Error ? error.message : "Ошибка анализа референса из истории.");
                }
            });

            imgContainer.addEventListener('click', e => {
                if (!(e.target as HTMLElement).closest('a, button')) {
                    openLightbox(img.src);
                }
            });
            
            historyGallery.appendChild(imgContainer);
        });

    } catch (error) {
        console.error("Ошибка при отображении истории:", error);
        displayErrorInContainer(historyGallery, "Не удалось загрузить историю генераций.");
    }
}


function setupNavigation() {
    const navContainer = document.querySelector('#app-nav');
    const pages = document.querySelectorAll<HTMLElement>('.page-content');
    const navButtons = document.querySelectorAll<HTMLButtonElement>('.nav-button');
    if (!navContainer || pages.length === 0) return;

    const navigateToPage = (pageId: string) => {
        pages.forEach(page => page.classList.add('hidden'));
        const pageToShow = document.querySelector<HTMLElement>(`#${pageId}`);
        pageToShow?.classList.remove('hidden');
        navButtons.forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.page === pageId) btn.classList.add('active');
        });

        // Update wizard step or render content on page change
        if (pageId === 'page1') {
            updatePage1WizardState();
        } else if (pageId === 'page2') {
            updateAllGenerateButtons();
            if (referenceImage) {
                setWizardStep('PAGE2_PLAN');
            } else {
                setWizardStep('PAGE2_PHOTO');
            }
        } else if (pageId === 'page3') {
            renderHistoryPage();
            setWizardStep('NONE');
        }
    };
    navContainer.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-page]');
        if (button?.dataset.page) navigateToPage(button.dataset.page);
    });
    (window as any).navigateToPage = navigateToPage;
}

let page1ReferenceImage: ImageState | null = null;
let page1ReferenceImage2: ImageState | null = null; // NEW
let page1ClothingImage: ImageState | null = null;
let generatedPhotoshootResult: ImageState | null = null;
let page1DetectedSubject: SubjectDetails | null = null;

function displaySuggestions(container: HTMLElement, allSuggestions: string[], shownSuggestions: Set<string>, input: HTMLInputElement) {
    container.innerHTML = '';
    let availableSuggestions = allSuggestions.filter(s => !shownSuggestions.has(s));
    if (availableSuggestions.length < 10) {
        shownSuggestions.clear();
        availableSuggestions = allSuggestions;
    }
    // --- FIXED: .slice(0, 10) instead of .slice(10) ---
    const selected = [...availableSuggestions].sort(() => 0.5 - Math.random()).slice(0, 10);
    
    selected.forEach(s => shownSuggestions.add(s));
    selected.forEach(suggestionText => {
        const item = document.createElement('button');
        item.className = 'suggestion-item';
        item.textContent = suggestionText;
        item.type = 'button';
        item.addEventListener('click', () => {
            input.value = suggestionText;
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        container.appendChild(item);
    });
}

function setupUploader(containerId: string, inputId: string, previewId: string, placeholderId: string, clearButtonId: string, onStateChange: (state: ImageState | null, state2?: ImageState | null) => Promise<void>) {
    const uploadContainer = document.getElementById(containerId) as HTMLDivElement;
    const imageUpload = document.getElementById(inputId) as HTMLInputElement;
    const imagePreview = document.getElementById(previewId) as HTMLImageElement;
    const uploadPlaceholder = document.getElementById(placeholderId) as HTMLDivElement;
    const clearButton = document.getElementById(clearButtonId) as HTMLButtonElement;

    // Modified to handle multiple files (up to 2)
    const handleFiles = async (files: FileList | null) => {
        if (!files || files.length === 0) return;

        try {
            const processFile = async (file: File) => {
                if (!file.type.startsWith('image/')) throw new Error('Файл не является изображением');
                const preResizedState = await preResizeImage(file);
                const finalResizedState = await resizeImage(preResizedState);
                return finalResizedState;
            };

            const statusText = `Оптимизация изображений...`;
            if(statusEl) statusEl.innerText = statusText;

            // Process first image
            const img1 = await processFile(files[0]);
            let img2: ImageState | null = null;

            // Process second image if exists
            if (files.length > 1) {
                img2 = await processFile(files[1]);
            }

            // Update UI (showing only first image as preview)
            imagePreview.src = `data:${img1.mimeType};base64,${img1.base64}`;
            imagePreview.classList.remove('hidden');
            uploadPlaceholder.classList.add('hidden');
            clearButton.classList.remove('hidden');

            await onStateChange(img1, img2);
            if(statusEl && statusEl.innerText === statusText) statusEl.innerText = '';

        } catch (err) {
            console.error("Ошибка обработки изображения:", err);
            showStatusError(err instanceof Error ? err.message : "Не удалось обработать изображение.");
            await onStateChange(null);
            // Reset UI
            imageUpload.value = '';
            imagePreview.src = '';
            imagePreview.classList.add('hidden');
            uploadPlaceholder.classList.remove('hidden');
            clearButton.classList.add('hidden');
        }
    };

    uploadContainer.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest(`#${clearButtonId}`)) imageUpload.click(); });
    ['dragover', 'dragleave', 'drop'].forEach(eventName => uploadContainer.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
        if (eventName === 'dragover') uploadContainer.classList.add('drag-over');
        if (eventName === 'dragleave' || eventName === 'drop') uploadContainer.classList.remove('drag-over');
        if (eventName === 'drop') {
            const files = (e as DragEvent).dataTransfer?.files;
            if (files && files.length > 0) handleFiles(files);
        }
    }));
    
    // Handle input change
    imageUpload.addEventListener('change', (event) => { 
        handleFiles((event.target as HTMLInputElement).files); 
    });
    
    clearButton.addEventListener('click', async () => {
        await onStateChange(null);
        imageUpload.value = '';
        imagePreview.src = '';
        imagePreview.classList.add('hidden');
        uploadPlaceholder.classList.remove('hidden');
        clearButton.classList.add('hidden');
    });
}

async function analyzeImageForText(image: ImageState, analysisPrompt: string): Promise<string> {
    try {
        const data = await callApi('/api/analyzeImageForText', { image, analysisPrompt });
        return data.text;
    } catch (e) {
        console.error('Image analysis failed:', e);
        throw new Error(`Ошибка анализа изображения: ${e instanceof Error ? e.message : 'Неизвестная ошибка'}`);
    }
}

async function generatePhotoshoot(parts: any[]): Promise<{ resultUrl: string; generatedPhotoshootResult: ImageState, newCredits: number }> {
    try {
        const data = await callApi('/api/generatePhotoshoot', { parts });
        return data;
    } catch (e) {
        console.error('generatePhotoshoot failed:', e);
        throw e;
    }
}


const paymentSelectionView = document.querySelector('#payment-selection-view') as HTMLDivElement;
const paymentProcessingView = document.querySelector('#payment-processing-view') as HTMLDivElement;
const paymentProceedButton = document.querySelector('#payment-proceed-button') as HTMLButtonElement;


function showPaymentModal() {
    if (paymentModalOverlay) {
        // Reset to initial state every time
        paymentSelectionView.classList.remove('hidden');
        paymentProcessingView.classList.add('hidden');
        paymentModalOverlay.classList.remove('hidden');
    }
}

function hidePaymentModal() {
    paymentModalOverlay?.classList.add('hidden');
    const page1 = document.getElementById('page1');
    if (page1 && !page1.classList.contains('hidden')) {
        updatePage1WizardState();
    } else {
        if(referenceImage) setWizardStep('PAGE2_GENERATE');
    }
}

async function handlePayment() {
    if (paymentProceedButton.disabled) return; // Prevent double clicks

    paymentProceedButton.disabled = true;
    paymentSelectionView.classList.add('hidden');
    paymentProcessingView.classList.remove('hidden');

    try {
        const response = await callApi('/api/create-payment', {});
        const confirmationUrl = response.confirmationUrl;

        if (!confirmationUrl) {
            throw new Error("Не удалось получить ссылку для оплаты.");
        }
        
        // Redirect to YooKassa payment page
        window.location.href = confirmationUrl;

    } catch (error) {
        const message = error instanceof Error ? error.message : "Неизвестная ошибка.";
        showStatusError(`Не удалось создать платеж: ${message}`);
        paymentProcessingView.classList.add('hidden');
        paymentSelectionView.classList.remove('hidden');
        paymentProceedButton.disabled = false; // Re-enable button on error
    }
}


let updatePage1WizardState: () => void = () => {};

function initializePage1Wizard() {
    const subtitle = document.getElementById('page1-subtitle') as HTMLParagraphElement;
    const clothingLocationContainer = document.getElementById('clothing-location-container') as HTMLDivElement;
    const clothingPromptInput = document.getElementById('clothing-prompt') as HTMLInputElement;
    const locationPromptInput = document.getElementById('location-prompt') as HTMLInputElement;
    const clothingSuggestionsContainer = document.getElementById('clothing-suggestions-container') as HTMLDivElement;
    const locationSuggestionsContainer = document.getElementById('location-suggestions-container') as HTMLDivElement;
    const refreshClothingBtn = document.getElementById('refresh-clothing-suggestions') as HTMLButtonElement;
    const refreshLocationBtn = document.getElementById('refresh-location-suggestions') as HTMLButtonElement;
    const generatePhotoshootButton = document.getElementById('generate-photoshoot-button') as HTMLButtonElement;
    const photoshootResultContainer = document.getElementById('photoshoot-result-container') as HTMLDivElement;

    let currentClothingSuggestions: string[] = prompts?.femaleClothingSuggestions || [];
    let currentLocationSuggestions: string[] = prompts?.locationSuggestions || [];
    let shownClothingSuggestions: Set<string> = new Set();
    let shownLocationSuggestions: Set<string> = new Set();
    let page1LocationImage: ImageState | null = null;
    
    const doGeneratePhotoshoot = async () => {
        if (!page1ReferenceImage) { displayErrorInContainer(photoshootResultContainer, 'Пожалуйста, загрузите ваше фото.'); return; }
        
        const clothingText = clothingPromptInput.value.trim();
        let locationText = locationPromptInput.value.trim();
        if (!page1ClothingImage && !clothingText) { displayErrorInContainer(photoshootResultContainer, 'Пожалуйста, опишите одежду текстом или загрузите ее фото.'); return; }
        if (!locationText) { displayErrorInContainer(photoshootResultContainer, 'Пожалуйста, опишите локацию текстом.'); return; }

        if (prompts?.locationSets?.[locationText]) {
            const options = prompts.locationSets[locationText];
            locationText = options[Math.floor(Math.random() * options.length)];
        }
    
        generatePhotoshootButton.disabled = true;
        setWizardStep('NONE');
        photoshootResultContainer.innerHTML = `<div class="loading-spinner flex flex-col items-center justify-center" role="status">
            <p id="photoshoot-loading-text" class="text-lg mt-4">Подготовка фотосессии...</p>
            <p class="text-gray-500 text-sm mt-2">Это может занять до 1 минуты. Пожалуйста, подождите.</p>
        </div>`;
        const loadingTextEl = document.getElementById('photoshoot-loading-text');

        const loadingMessages = [
            'Подбираем одежду...',
            'Выбираем идеальную локацию...',
            'Настраиваем виртуальную камеру...',
            'Рендеринг финального кадра...',
            'Почти готово, последние штрихи...'
        ];
        let messageIndex = 0;
        const messageInterval = setInterval(() => {
            if (loadingTextEl) {
                messageIndex = (messageIndex + 1) % loadingMessages.length;
                loadingTextEl.textContent = loadingMessages[messageIndex];
            }
        }, 4000);
        
        try {
            const img = new Image();
            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = (err) => reject(new Error("Не удалось загрузить изображение для определения пропорций."));
                img.src = `data:${page1ReferenceImage.mimeType};base64,${page1ReferenceImage.base64}`;
            });

            const isPortrait = img.height > img.width;
            const aspectRatioInstruction = isPortrait ? '4:5 (портретный)' : '3:2 (альбомный)';

            // --- Updated Logic: Handle one or two reference images ---
            const parts: any[] = [{ inlineData: { data: page1ReferenceImage.base64, mimeType: page1ReferenceImage.mimeType } }];
            
            // Add second image if available
            if (page1ReferenceImage2) {
                parts.push({ inlineData: { data: page1ReferenceImage2.base64, mimeType: page1ReferenceImage2.mimeType } });
            }

            let promptText: string;
            // Base context about reference photos
            let referenceContext = `Это референсное фото человека.`;
            if (page1ReferenceImage2) {
                referenceContext = `Это ДВА референсных фото одного и того же человека. Проанализируй оба изображения, чтобы создать максимально точный цифровой двойник. Используй черты лица с обоих снимков.`;
            }

            if (page1ClothingImage) {
                parts.push({ inlineData: { data: page1ClothingImage.base64, mimeType: page1ClothingImage.mimeType } });
                const additionalClothingDetails = clothingText ? ` Дополнительные пожелания к одежде (например, изменение цвета или детали): "${clothingText}".` : '';
                promptText = `Твоя задача — действовать как 'цифровой стилист'. ${referenceContext} Следующее изображение — референс одежды.
Твоя главная цель — идеально сохранить человека с референсных фото, изменив только его одежду и фон, и приведя результат к стандартному фото-формату.
КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1.  **СОХРАНИ ЧЕЛОВЕКА:** Внешность, уникальные черты лица (форма носа, глаз, губ), прическа и выражение лица должны остаться АБСОЛЮТНО ИДЕНТИЧНЫМИ оригиналу. **Поза и выражение лица ОБЯЗАТЕЛЬНО должны остаться без изменения.**
2.  **АДАПТИРУЙ КОМПОЗИЦИЮ:** Сохрани основную композицию, но адаптируй под соотношение сторон ${aspectRatioInstruction}.
3.  **ЗАМЕНИ ОДЕЖДУ:** Переодень человека в одежду с референсного фото одежды. Игнорируй лицо на фото одежды. Нарисуй только ту часть одежды, которая видна в новом кадре.${additionalClothingDetails}
4.  **ЗАМЕНИ ФОН И ВПИШИ ЧЕЛОВЕКА:** Полностью замени фон на новый: "${locationText}". Критически важно: впиши человека в локацию так, чтобы **перспектива фона и линия горизонта** идеально совпадали с ракурсом съемки человека.
5.  **АДАПТИРУЙ ОСВЕЩЕНИЕ:** Создай единую световую среду. Наложи на человека тени и **цветовые рефлексы** от нового фона.
6.  **ЦИФРОВОЙ ДВОЙНИК:** СГЕНЕРИРОВАННОЕ ЛИЦО ДОЛЖНО БЫТЬ ЦИФРОВЫМ ДВОЙНИКОМ РЕФЕРЕНСНОГО ЛИЦА.
**КАЧЕСТВО:** стандартное разрешение, оптимизировано для веб.
Результат — только одно изображение без текста.`;
            } else {
                promptText = `Твоя задача — действовать как 'цифровой стилист'. ${referenceContext}
Твоя главная цель — идеально сохранить человека с фото, изменив только его одежду и фон, и приведя результат к стандартному фото-формату.
КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1.  **СОХРАНИ ЧЕЛОВЕКА:** Внешность, уникальные черты лица (форма носа, глаз, губ), прическа и выражение лица должны остаться АБСОЛЮТНО ИДЕНТИЧНЫМИ оригиналу. **Поза и выражение лица ОБЯЗАТЕЛЬНО должны остаться без изменения.**
2.  **АДАПТИРУЙ КОМПОЗИЦИЮ:** Сохрани основную композицию, но адаптируй под соотношение сторон ${aspectRatioInstruction}.
3.  **ЗАМЕНИ ОДЕЖДУ:** Переодень человека в: "${clothingText}". Нарисуй только ту часть одежды, которая видна в новом кадре.
4.  **ЗАМЕНИ ФОН И ВПИШИ ЧЕЛОВЕКА:** Полностью замени фон на новый: "${locationText}". Критически важно: впиши человека в локацию так, чтобы **перспектива фона и линия горизонта** идеально совпадали с ракурсом съемки человека.
5.  **АДАПТИРУЙ ОСВЕЩЕНИЕ:** Создай единую световую среду. Наложи на человека тени и **цветовые рефлексы** от нового фона.
6.  **ЦИФРОВОЙ ДВОЙНИК:** СГЕНЕРИРОВАННОЕ ЛИЦО ДОЛЖНО БЫТЬ ЦИФРОВЫМ ДВОЙНИКОМ РЕФЕРЕНСНОГО ЛИЦА.
**КАЧЕСТВО:** стандартное разрешение, оптимизировано для веб.
Результат — только одно изображение без текста.`;
            }
            parts.push({ text: promptText.trim() });
    
            const data = await generatePhotoshoot(parts);
            
            await addToHistory([data.generatedPhotoshootResult]);

            generatedPhotoshootResult = data.generatedPhotoshootResult;
            generationCredits = data.newCredits;
            updateCreditCounterUI();
            updateAllGenerateButtons();

            const resultUrl = `data:${generatedPhotoshootResult.mimeType};base64,${generatedPhotoshootResult.base64}`;

            photoshootResultContainer.innerHTML = `<div class="generated-photoshoot-wrapper cursor-pointer">
                    <img src="${resultUrl}" alt="Сгенерированная фотосессия" class="w-full h-auto object-contain rounded-lg max-h-[60vh]"/>
                    <div class="result-actions">
                         <a href="${resultUrl}" download="fotosessiya-${Date.now()}.png" class="result-action-button" title="Скачать"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" /></svg></a>
                    </div></div>`;
            photoshootResultContainer.querySelector('.generated-photoshoot-wrapper')?.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('a')) openLightbox(resultUrl); });

            if (generatedPhotoshootResult && page1DetectedSubject) {
                referenceImage = generatedPhotoshootResult;
                referenceImage2 = null; // Reset second ref when proceeding
                
                // --- FIX: CLEAR TEXT TAIL ---
                referenceImageLocationPrompt = null; // Force visual extension, remove text tail
                customPromptInput.value = ''; // Clear custom prompt to avoid leftover instructions
                // -----------------------------
                
                detectedSubjectCategory = page1DetectedSubject.category;
                detectedSmileType = page1DetectedSubject.smile;
                initializePoseSequences();
                const dataUrlForPage2 = `data:${referenceImage.mimeType};base64,${referenceImage.base64}`;
                referenceImagePreview.src = dataUrlForPage2;
                referenceImagePreview.classList.remove('hidden');
                const secondaryContainer = document.getElementById('secondary-images-container');
                if (secondaryContainer) secondaryContainer.innerHTML = '';
                referenceDownloadButton.href = dataUrlForPage2;
                referenceDownloadButton.download = `photoshoot-result-${Date.now()}.png`;
                referenceDownloadButton.classList.remove('hidden');
                uploadPlaceholder.classList.add('hidden');
                uploadContainer.classList.remove('aspect-square');
                outputGallery.innerHTML = '';
                statusEl.innerText = 'Изображение из фотосессии загружено. Выберите план и создайте вариации.';
                generatedPhotoshootResult = null;
                (window as any).navigateToPage('page2');
            }
        } catch (e) {
            const errorMessage = e instanceof Error ? e.message : 'Произошла неизвестная ошибка.';
            displayErrorInContainer(photoshootResultContainer, errorMessage);
        } finally {
            clearInterval(messageInterval);
            updatePage1WizardState();
        }
    }

    const handlePhotoshootButtonClick = async () => {
        const creditsNeeded = 1;

        if (!isLoggedIn) {
            setWizardStep('AUTH');
            showStatusError('Пожалуйста, войдите, чтобы начать фотосессию.');
            return;
        }

        if (generationCredits < creditsNeeded) {
            const modalTitle = document.querySelector('#payment-modal-title');
            if (modalTitle) modalTitle.textContent = "Закончились кредиты!";
            const modalDescription = document.querySelector('#payment-modal-description');
            if (modalDescription) modalDescription.innerHTML = `У вас ${generationCredits} кредитов. Для фотосессии требуется ${creditsNeeded}. Пополните баланс, чтобы купить <strong>пакет '12 фотографий'</strong> за 129 ₽.`;

            setWizardStep('CREDITS');
            showPaymentModal();
            return;
        }
        await doGeneratePhotoshoot();
    };

    updatePage1WizardState = () => {
        const generatePhotoshootButton = document.getElementById('generate-photoshoot-button') as HTMLButtonElement;
        const clothingPromptInput = document.getElementById('clothing-prompt') as HTMLInputElement;
        const locationPromptInput = document.getElementById('location-prompt') as HTMLInputElement;

        if (!generatePhotoshootButton || !clothingPromptInput || !locationPromptInput) return;
        const isReady = !!(page1ReferenceImage && (page1ClothingImage || clothingPromptInput.value.trim()) && locationPromptInput.value.trim());
        const creditsNeeded = 1;
    
        if (generationCredits >= creditsNeeded) {
            generatePhotoshootButton.disabled = !isReady;
            generatePhotoshootButton.innerHTML = `Начать фотосессию (Осталось: ${generationCredits})`;
        } else {
            generatePhotoshootButton.disabled = false; // Always enable to trigger modal/auth
            if (!isLoggedIn) {
                generatePhotoshootButton.innerHTML = `Войти, чтобы продолжить`;
            } else {
                generatePhotoshootButton.innerHTML = `Пополнить кредиты`;
            }
        }

        // Wizard Logic
        if (!page1ReferenceImage) {
            setWizardStep('PAGE1_PHOTO');
        } else if (!page1ClothingImage && !clothingPromptInput.value.trim()) {
            setWizardStep('PAGE1_CLOTHING');
        } else if (!locationPromptInput.value.trim()) {
            setWizardStep('PAGE1_LOCATION');
        } else if (isReady) {
            setWizardStep('PAGE1_GENERATE');
        } else {
            setWizardStep('NONE');
        }
    };

    const resetWizard = () => {
        subtitle.textContent = 'Шаг 1: Загрузите ваше фото для начала (можно 2)';
        subtitle.classList.remove('text-red-400');
        clothingLocationContainer.classList.add('hidden');
        clothingPromptInput.value = ''; locationPromptInput.value = '';
        generatedPhotoshootResult = null; page1DetectedSubject = null;
        page1ClothingImage = null; page1LocationImage = null;
        page1ReferenceImage2 = null; // Reset second image
        shownClothingSuggestions.clear(); shownLocationSuggestions.clear();
        (document.getElementById('clothing-image-upload') as HTMLInputElement).value = '';
        (document.getElementById('clothing-image-preview') as HTMLImageElement).src = '';
        document.getElementById('clothing-image-preview')?.classList.add('hidden');
        document.getElementById('clothing-upload-placeholder')?.classList.remove('hidden');
        document.getElementById('clothing-clear-button')?.classList.add('hidden');
        
        // --- NEW: Clear Page 1 secondary images ---
        const secondaryContainer = document.getElementById('page1-secondary-images-container');
        if (secondaryContainer) secondaryContainer.innerHTML = '';
        
        updatePage1WizardState();
    };
    
    const showCombinedSteps = async (imageState: ImageState) => {
        if (!prompts) return;
        try {
            subtitle.textContent = 'Анализ фото...';
            const subjectDetails = await checkImageSubject(imageState);
            page1DetectedSubject = subjectDetails;
            if (subjectDetails.category === 'other') {
                subtitle.innerHTML = `<span class="text-red-400">На фото не удалось распознать человека. Пожалуйста, загрузите другое изображение.</span>`;
                return;
            }
            let subjectText = '';
            switch(subjectDetails.category) {
                case 'woman': currentClothingSuggestions = prompts.femaleClothingSuggestions; currentLocationSuggestions = prompts.locationSuggestions; subjectText = 'женщины'; break;
                case 'man': currentClothingSuggestions = prompts.maleClothingSuggestions; currentLocationSuggestions = prompts.locationSuggestions; subjectText = 'мужчины'; break;
                case 'teenager': currentClothingSuggestions = prompts.teenClothingSuggestions; currentLocationSuggestions = prompts.teenLocationSuggestions; subjectText = 'подростка'; break;
                case 'elderly_woman': currentClothingSuggestions = prompts.elderlyFemaleClothingSuggestions; currentLocationSuggestions = prompts.locationSuggestions; subjectText = 'пожилой женщины'; break;
                case 'elderly_man': currentClothingSuggestions = prompts.elderlyMaleClothingSuggestions; currentLocationSuggestions = prompts.locationSuggestions; subjectText = 'пожилого мужчины'; break;
                case 'child': currentClothingSuggestions = prompts.childClothingSuggestions; currentLocationSuggestions = prompts.childLocationSuggestions; subjectText = 'ребенка'; break;
            }
            // IMPORTANT: Do NOT clear shown suggestions here, we might be resuming.
            // The clearing happens in setupUploader when a NEW image is provided.
            subtitle.textContent = `Обнаружено фото ${subjectText}. Шаг 2: Опишите одежду и локацию.`;
            displaySuggestions(clothingSuggestionsContainer, currentClothingSuggestions, shownClothingSuggestions, clothingPromptInput);
            displaySuggestions(locationSuggestionsContainer, currentLocationSuggestions, shownLocationSuggestions, locationPromptInput);
            clothingLocationContainer.classList.remove('hidden');
            updatePage1WizardState();
        } catch (e) {
            const message = e instanceof Error ? e.message : 'Неизвестная ошибка анализа.';
            subtitle.innerHTML = `<span class="text-red-400">${message}</span>`;
            page1DetectedSubject = null;
        }
    };

    setupUploader('page1-upload-container', 'page1-image-upload', 'page1-image-preview', 'page1-upload-placeholder', 'page1-clear-button', async (state, state2) => {
        page1ReferenceImage = state;
        page1ReferenceImage2 = state2 || null;

        if (state) {
            subtitle.textContent = 'Оптимизация изображения...';
            let imageState = state;
    
            // --- AUTO-CROP LOGIC (Apply only to primary image) ---
            const processedImageState = await new Promise<ImageState>((resolve) => {
                const img = new Image();
                img.onload = async () => {
                    if (img.width > img.height) { // Only process horizontal images
                        subtitle.textContent = 'Анализ композиции...';
                        try {
                            const { boundingBox } = await callApi('/api/detectPersonBoundingBox', { image: imageState });
                            if (boundingBox) {
                                const originalWidth = img.width;
                                const originalHeight = img.height;
                                const targetAspectRatio = 4 / 5;
                                const newWidth = originalHeight * targetAspectRatio;
                                
                                if (newWidth < originalWidth) {
                                    const personCenterX = ((boundingBox.x_min + boundingBox.x_max) / 2) * originalWidth;
                                    let cropX = personCenterX - (newWidth / 2);
                                    cropX = Math.max(0, Math.min(cropX, originalWidth - newWidth));
    
                                    const canvas = document.createElement('canvas');
                                    canvas.width = newWidth;
                                    canvas.height = originalHeight;
                                    const ctx = canvas.getContext('2d');
                                    if (ctx) {
                                        ctx.drawImage(img, cropX, 0, newWidth, originalHeight, 0, 0, newWidth, originalHeight);
                                        const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.9);
                                        const [, croppedBase64] = croppedDataUrl.split(',');
                                        console.log("Фото для фотосессии успешно обрезано.");
                                        resolve({ base64: croppedBase64, mimeType: 'image/jpeg' });
                                        return;
                                    }
                                }
                            }
                        } catch (cropError) {
                            console.warn("Не удалось автоматически обрезать фото, используется оригинал:", cropError);
                        }
                    }
                    resolve(imageState);
                };
                img.onerror = () => resolve(imageState);
                img.src = `data:${imageState.mimeType};base64,${imageState.base64}`;
            });
            // --- END OF AUTO-CROP LOGIC ---
            
            page1ReferenceImage = processedImageState;

            // --- Reset secondary inputs ---
            clothingPromptInput.value = '';
            locationPromptInput.value = '';
            shownClothingSuggestions.clear();
            shownLocationSuggestions.clear();
            page1ClothingImage = null;
            page1LocationImage = null;
            
            (document.getElementById('clothing-image-preview') as HTMLImageElement).src = '';
            document.getElementById('clothing-image-preview')?.classList.add('hidden');
            document.getElementById('clothing-upload-placeholder')?.classList.remove('hidden');
            document.getElementById('clothing-clear-button')?.classList.add('hidden');

            (document.getElementById('location-image-preview') as HTMLImageElement).src = '';
            document.getElementById('location-image-preview')?.classList.add('hidden');
            document.getElementById('location-upload-placeholder')?.classList.remove('hidden');
            document.getElementById('location-clear-button')?.classList.add('hidden');

            // --- NEW: Render secondary image for Page 1 ---
            const secondaryContainer = document.getElementById('page1-secondary-images-container');
            if (secondaryContainer) {
                secondaryContainer.innerHTML = '';
                if (state2) {
                    const thumb = document.createElement('img');
                    thumb.src = `data:${state2.mimeType};base64,${state2.base64}`;
                    thumb.className = "w-16 h-16 object-cover rounded-lg border-2 border-white shadow-lg bg-gray-800";
                    secondaryContainer.appendChild(thumb);
                }
            }
            
            await showCombinedSteps(processedImageState);
        } else {
            resetWizard();
        }
    });
    
    setupUploader('clothing-upload-container', 'clothing-image-upload', 'clothing-image-preview', 'clothing-upload-placeholder', 'clothing-clear-button', async (state) => {
        if (!state) {
            page1ClothingImage = null;
        } else {
            const originalPlaceholder = clothingPromptInput.placeholder;
            clothingPromptInput.placeholder = 'Анализ фото одежды...';
            clothingPromptInput.disabled = true;
            try {
                // Get coordinates from the server
                const { boundingBox } = await callApi('/api/cropClothing', { image: state });
                
                // Crop the image on the client-side
                clothingPromptInput.placeholder = 'Обрезка изображения...';
                const croppedImage = await cropImageByCoords(state, boundingBox);
                page1ClothingImage = croppedImage;
                
                // Update the preview with the client-cropped image
                const imagePreview = document.getElementById('clothing-image-preview') as HTMLImageElement;
                if (imagePreview) {
                    imagePreview.src = `data:${croppedImage.mimeType};base64,${croppedImage.base64}`;
                }
            } catch (err) {
                 console.error("Ошибка обрезки изображения одежды по координатам:", err);
                 showStatusError("Не удалось автоматически обрезать фото одежды. Используется оригинал.");
                 page1ClothingImage = state; // Fallback to original
            } finally {
                clothingPromptInput.disabled = false;
                clothingPromptInput.placeholder = originalPlaceholder;
            }
        }

        clothingPromptInput.placeholder = page1ClothingImage ? 'Фото одежды загружено (можно добавить детали)' : 'Опишите или выберите вариант...';
        clothingPromptInput.value = '';
        updatePage1WizardState();
    });

    setupUploader('location-upload-container', 'location-image-upload', 'location-image-preview', 'location-upload-placeholder', 'location-clear-button', async (state) => {
        page1LocationImage = state;
        if (state) {
            const originalPlaceholder = locationPromptInput.placeholder;
            locationPromptInput.value = ''; locationPromptInput.placeholder = 'Анализ фото локации...'; locationPromptInput.disabled = true;
            try {
                const description = await analyzeImageForText(state, "Опиши фон или локацию на этом изображении одним коротким, но емким предложением. Ответ должен быть только описанием, без лишних слов. Например: 'уютная кофейня со старинной мебелью' или 'бескрайнее лавандовое поле на закате'.");
                locationPromptInput.value = description;
                locationPromptInput.dispatchEvent(new Event('input', { bubbles: true }));
            } catch (e) { locationPromptInput.placeholder = e instanceof Error ? e.message : 'Ошибка'; }
            finally { locationPromptInput.disabled = false; if (!locationPromptInput.value) locationPromptInput.placeholder = originalPlaceholder; }
        } else {
            locationPromptInput.value = '';
            locationPromptInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    generatePhotoshootButton.addEventListener('click', handlePhotoshootButtonClick);
    clothingPromptInput.addEventListener('input', updatePage1WizardState);
    locationPromptInput.addEventListener('input', updatePage1WizardState);
    
    // --- FIXED REFRESH LISTENERS: Ensure visibility and focus ---
    refreshClothingBtn.addEventListener('mousedown', (e) => { 
        e.preventDefault(); 
        displaySuggestions(clothingSuggestionsContainer, currentClothingSuggestions, shownClothingSuggestions, clothingPromptInput);
        clothingSuggestionsContainer.classList.add('visible');
        clothingPromptInput.focus();
    });
    refreshLocationBtn.addEventListener('mousedown', (e) => { 
        if (!prompts) return; 
        e.preventDefault(); 
        displaySuggestions(locationSuggestionsContainer, currentLocationSuggestions, shownLocationSuggestions, locationPromptInput);
        locationSuggestionsContainer.classList.add('visible');
        locationPromptInput.focus();
    });
    
    clothingPromptInput.addEventListener('focus', () => clothingSuggestionsContainer.classList.add('visible'));
    clothingPromptInput.addEventListener('blur', () => setTimeout(() => clothingSuggestionsContainer.classList.remove('visible'), 200));
    locationPromptInput.addEventListener('focus', () => locationSuggestionsContainer.classList.add('visible'));
    locationPromptInput.addEventListener('blur', () => setTimeout(() => locationSuggestionsContainer.classList.remove('visible'), 200));

    resetWizard();
}

// --- Auth Functions ---
function getUploaderPlaceholderHtml() {
    return `<div class="flex flex-col items-center justify-center pt-5 pb-6">
        <svg class="w-8 h-8 mb-4 text-gray-500" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 20 16">
            <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 13h3a3 3 0 0 0 0-6h-.025A5.56 5.56 0 0 0 16 6.5 5.5 5.5 0 0 0 5.207 5.021C5.137 5.017 5.071 5 5 5a4 4 0 0 0 0 8h2.167M10 15V6m0 0L8 8m2-2 2 2"/>
        </svg>
        <p class="mb-2 text-sm text-gray-400"><span class="font-semibold">Нажмите для загрузки</span> или перетащите</p>
        <p class="text-xs text-gray-500">SVG, PNG, JPG или WEBP</p>
    </div>`;
}

function updateAuthUI() {
    if (isLoggedIn && userProfile) {
        if(authContainer) authContainer.classList.add('hidden');
        if(userProfileContainer) userProfileContainer.classList.remove('hidden');
        if(userProfileImage) userProfileImage.src = userProfile.picture;
        if(userProfileName) userProfileName.textContent = userProfile.name;
    } else {
        if(authContainer) authContainer.classList.remove('hidden');
        if(userProfileContainer) userProfileContainer.classList.add('hidden');
        if(userProfileImage) userProfileImage.src = '';
        if(userProfileName) userProfileName.textContent = '';
    }
    updateCreditCounterUI();
    updateAllGenerateButtons();
}

function signOut() {
    isLoggedIn = false;
    userProfile = null;
    idToken = null;
    generationCredits = 0;
    localStorage.removeItem('idToken');
    localStorage.removeItem('userProfile');
    updateAuthUI();
    if ((window as any).google) {
        (window as any).google.accounts.id.disableAutoSelect();
    }
    statusEl.innerText = 'Вы вышли из системы.';
}

async function handleCredentialResponse(response: any) {
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: response.credential }),
        });

        if (!res.ok) {
            const errData = await res.json();
            throw new Error(errData.error || 'Ошибка входа');
        }

        const data = await res.json();
        isLoggedIn = true;
        userProfile = data.userProfile;
        idToken = response.credential;
        generationCredits = data.credits;

        localStorage.setItem('idToken', idToken!);
        localStorage.setItem('userProfile', JSON.stringify(userProfile));

        updateAuthUI();
        statusEl.innerText = `Добро пожаловать, ${userProfile?.name}!`;
    } catch (error) {
        console.error('Login error:', error);
        showStatusError('Не удалось войти в систему.');
    }
}

async function loadGoogleScriptAndInitAuth() {
    const storedToken = localStorage.getItem('idToken');
    const storedProfile = localStorage.getItem('userProfile');

    if (storedToken && storedProfile) {
        try {
            userProfile = JSON.parse(storedProfile);
            idToken = storedToken;
            isLoggedIn = true;
            updateAuthUI();
            
            // Validate token silently
            try {
                 const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ token: storedToken }),
                 });
                 if (res.ok) {
                     const data = await res.json();
                     generationCredits = data.credits;
                     updateCreditCounterUI();
                     updateAllGenerateButtons();
                 } else {
                     signOut();
                 }
            } catch(e) { console.warn('Silent login check failed', e); }
        } catch (e) {
            console.error("Error parsing stored profile", e);
            signOut();
        }
    } else {
        updateAuthUI();
    }

    const script = document.createElement('script');
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => {
        if ((window as any).google) {
            (window as any).google.accounts.id.initialize({
                client_id: GOOGLE_CLIENT_ID,
                callback: handleCredentialResponse
            });
            if (googleSignInContainer) {
                (window as any).google.accounts.id.renderButton(
                    googleSignInContainer,
                    { theme: "outline", size: "large", width: '100%' }
                );
            }
        }
    };
    document.body.appendChild(script);
}

async function applyPromoCode() {
    if (!promoCodeInput || !applyPromoButton) return;
    const code = promoCodeInput.value.trim();
    if (!code) { showStatusError('Введите промокод.'); return; }
    
    if (!isLoggedIn) {
        showStatusError('Сначала войдите в систему.');
        setWizardStep('AUTH');
        return;
    }

    applyPromoButton.disabled = true;
    const originalText = applyPromoButton.textContent;
    applyPromoButton.textContent = '...';

    try {
        const data = await callApi('/api/apply-promo', { code });
        generationCredits = data.newCredits;
        updateCreditCounterUI();
        updateAllGenerateButtons();
        statusEl.innerHTML = `<span class="text-green-400">${data.message || 'Промокод применен!'}</span>`;
        promoCodeInput.value = '';
    } catch (e) {
        showStatusError(e instanceof Error ? e.message : 'Ошибка применения промокода.');
    } finally {
        applyPromoButton.disabled = false;
        applyPromoButton.textContent = originalText || 'Применить';
    }
}

// --- MAIN APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  // --- DOM Element Selection (Safe Zone) ---
  lightboxOverlay = document.querySelector('#lightbox-overlay')!;
  lightboxImage = document.querySelector('#lightbox-image')!;
  lightboxCloseButton = document.querySelector('#lightbox-close-button')!;
  statusEl = document.querySelector('#status')!;
  planButtonsContainer = document.querySelector('#plan-buttons')!;
  generateButton = document.querySelector('#generate-button')!;
  resetButton = document.querySelector('#reset-button')!;
  outputGallery = document.querySelector('#output-gallery')!;
  uploadContainer = document.querySelector('#upload-container')!;
  imageUpload = document.querySelector('#image-upload')!;
  referenceImagePreview = document.querySelector('#reference-image-preview')!;
  uploadPlaceholder = document.querySelector('#upload-placeholder')!;
  customPromptInput = document.querySelector('#custom-prompt-input')!;
  referenceDownloadButton = document.querySelector('#reference-download-button')!;
  paymentModalOverlay = document.querySelector('#payment-modal-overlay')!;
  paymentConfirmButton = document.querySelector('#payment-confirm-button')!;
  paymentCloseButton = document.querySelector('#payment-close-button')!;
  creditCounterEl = document.querySelector('#credit-counter')!;
  promoCodeInput = document.querySelector('#promo-code-input')!;
  applyPromoButton = document.querySelector('#apply-promo-button')!;
  authContainer = document.getElementById('auth-container') as HTMLDivElement;
  googleSignInContainer = document.getElementById('google-signin-container') as HTMLDivElement;
  userProfileContainer = document.getElementById('user-profile-container') as HTMLDivElement;
  userProfileImage = document.getElementById('user-profile-image') as HTMLImageElement;
  userProfileName = document.getElementById('user-profile-name') as HTMLSpanElement;
  paymentQrView = document.getElementById('payment-qr-view') as HTMLDivElement;
  paymentQrImage = document.getElementById('payment-qr-image') as HTMLImageElement;
  paymentBackButton = document.getElementById('payment-back-button') as HTMLButtonElement;


  try {
    generationCredits = 0;
    updateCreditCounterUI(); 

    await initDB();
    await loadGoogleScriptAndInitAuth();
    
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('payment_status') === 'success') {
      statusEl.innerHTML = '<span class="text-green-400">Спасибо за оплату! Ваши фотографии будут зачислены в течение минуты.</span>';
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    const response = await fetch('/prompts.json');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    prompts = await response.json();
    
    // --- Initial UI Setup & Event Listeners ---
    const placeholderHtml = getUploaderPlaceholderHtml();
    document.getElementById('page1-upload-placeholder')!.innerHTML = placeholderHtml;
    uploadPlaceholder.innerHTML = '<p class="text-gray-400">Нажмите, чтобы загрузить референс (можно выбрать 2)</p><p class="text-xs text-gray-500 mt-1">PNG, JPG, WEBP</p>';

    setupNavigation();
    initializePage1Wizard();
    
    selectPlan(selectedPlan);
    initializePoseSequences();

    lightboxOverlay.addEventListener('click', (e) => {
        if (e.target === lightboxOverlay) {
          hideLightbox();
        }
    });
    lightboxCloseButton.addEventListener('click', hideLightbox);

    generateButton.addEventListener('click', generate);
    resetButton.addEventListener('click', resetApp);
    applyPromoButton.addEventListener('click', applyPromoCode);
    promoCodeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyPromoCode(); });
    
    paymentCloseButton.addEventListener('click', hidePaymentModal);
    paymentModalOverlay.addEventListener('click', (e) => { if (e.target === paymentModalOverlay) hidePaymentModal(); });
    creditCounterEl.addEventListener('click', showPaymentModal);
    userProfileContainer.addEventListener('click', signOut);
    
    paymentProceedButton.addEventListener('click', handlePayment);
    paymentBackButton.addEventListener('click', () => {
        paymentQrView.classList.add('hidden');
        paymentSelectionView.classList.remove('hidden');
        if(paymentQrImage) paymentQrImage.src = ''; 
    });

    referenceDownloadButton.addEventListener('click', e => e.stopPropagation());
    
    planButtonsContainer.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-plan]');
      if (button?.dataset.plan) selectPlan(button.dataset.plan);
    });

    // --- UPDATED Page 2 Upload Handler for Multiple Files ---
    const handlePage2Upload = async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      
      const file = files[0];
      if (!file.type.startsWith('image/')) {
        showStatusError('Пожалуйста, выберите файл изображения.');
        return;
      }
      
      const overlay = document.createElement('div');
      overlay.className = 'analysis-overlay';
      overlay.innerHTML = `<div class="loading-spinner"></div><p class="mt-2 text-sm text-center">Обработка изображения...</p>`;
      uploadContainer.appendChild(overlay);
      const overlayText = overlay.querySelector('p');
      setControlsDisabled(true);
      setWizardStep('NONE');

      try {
        const processFile = async (f: File) => {
            const preResized = await preResizeImage(f);
            return await resizeImage(preResized);
        };

        const img1 = await processFile(file);
        let img2: ImageState | null = null;
        let img3: ImageState | null = null; // Prepare for potential 3rd image

        // Process secondary images
        if (files.length > 1) {
            if (overlayText) overlayText.textContent = 'Обработка второго изображения...';
            if (files[1].type.startsWith('image/')) img2 = await processFile(files[1]);
        }
        if (files.length > 2) {
            if (overlayText) overlayText.textContent = 'Обработка третьего изображения...';
             if (files[2].type.startsWith('image/')) img3 = await processFile(files[2]);
        }


        // --- AUTO-CROP LOGIC (Main image only) ---
        let processedImageState = img1;
        const img = new Image();
        await new Promise<void>((resolve) => {
            img.onload = async () => {
                if (img.width > img.height) { // Only process horizontal images
                    if (overlayText) overlayText.textContent = 'Анализ композиции...';
                    try {
                        const { boundingBox } = await callApi('/api/detectPersonBoundingBox', { image: img1 });
                        if (boundingBox) {
                            const originalWidth = img.width;
                            const originalHeight = img.height;
                            const targetAspectRatio = 4 / 5;
                            const newWidth = originalHeight * targetAspectRatio;
                            if (newWidth < originalWidth) {
                                const personCenterX = ((boundingBox.x_min + boundingBox.x_max) / 2) * originalWidth;
                                let cropX = personCenterX - (newWidth / 2);
                                cropX = Math.max(0, Math.min(cropX, originalWidth - newWidth));
                                const canvas = document.createElement('canvas');
                                canvas.width = newWidth;
                                canvas.height = originalHeight;
                                const ctx = canvas.getContext('2d');
                                if (ctx) {
                                    ctx.drawImage(img, cropX, 0, newWidth, originalHeight, 0, 0, newWidth, originalHeight);
                                    const croppedDataUrl = canvas.toDataURL('image/jpeg', 0.9);
                                    const [, croppedBase64] = croppedDataUrl.split(',');
                                    resolve();
                                    processedImageState = { base64: croppedBase64, mimeType: 'image/jpeg' };
                                    return;
                                }
                            }
                        }
                    } catch (e) { console.warn('Auto-crop failed', e); }
                }
                resolve();
            };
            img.onerror = () => resolve();
            img.src = `data:${img1.mimeType};base64,${img1.base64}`;
        });
        
        const finalDataUrl = `data:${processedImageState.mimeType};base64,${processedImageState.base64}`;

        referenceImage = processedImageState;
        referenceImage2 = img2; // Store second image for generation
        // Note: img3 is processed but not sent to generation API yet as per previous request to keep logic minimal, 
        // but we WILL show it in UI below.

        referenceImageLocationPrompt = null; 
        referenceImagePreview.src = finalDataUrl;
        referenceImagePreview.classList.remove('hidden');
        
        // --- UI UPDATE: SHOW SECONDARY IMAGES ---
        const secondaryContainer = document.getElementById('secondary-images-container');
        if (secondaryContainer) {
            secondaryContainer.innerHTML = ''; // Clear previous
            
            // Helper to add thumb
            const addThumb = (imgState: ImageState) => {
                const thumb = document.createElement('img');
                thumb.src = `data:${imgState.mimeType};base64,${imgState.base64}`;
                thumb.className = "w-16 h-16 object-cover rounded-lg border-2 border-white shadow-lg bg-gray-800";
                secondaryContainer.appendChild(thumb);
            };

            if (img2) addThumb(img2);
            if (img3) addThumb(img3);
        }
        // ----------------------------------------

        referenceDownloadButton.href = finalDataUrl;
        referenceDownloadButton.download = `reference-${Date.now()}.png`;
        referenceDownloadButton.classList.remove('hidden');
        uploadPlaceholder.classList.add('hidden');
        uploadContainer.classList.remove('aspect-square');
        outputGallery.innerHTML = '';
        
        if (overlayText) overlayText.textContent = 'Анализ фото...';

        statusEl.innerText = 'Анализ фото, чтобы подобрать лучшие позы...';
        
        const { category, smile } = await checkImageSubject(processedImageState);
        detectedSubjectCategory = category;
        detectedSmileType = smile;
        initializePoseSequences();
        if (category === 'other') { showStatusError('На фото не обнаружен человек. Попробуйте другое изображение.'); resetApp(); return; }
        const subjectMap = { woman: 'женщина', man: 'мужчина', teenager: 'подросток', elderly_woman: 'пожилая женщина', elderly_man: 'пожилый мужчина', child: 'ребенок' };
        
        const count = files.length;
        const msg = count > 1 ? `Загружено изображений: ${count}. Обнаружен: ${subjectMap[category] || 'человек'}.` : `Изображение загружено. Обнаружен: ${subjectMap[category] || 'человек'}.`;
        statusEl.innerText = msg;
        setWizardStep('PAGE2_PLAN');

      } catch (e) { 
        showStatusError(e instanceof Error ? e.message : 'Неизвестная ошибка анализа или оптимизации.'); 
        resetApp();
      } finally { 
          overlay.remove();
          setControlsDisabled(false); 
      }
    };
    
    imageUpload.addEventListener('change', (event) => {
        handlePage2Upload((event.target as HTMLInputElement).files);
    });
    
    uploadContainer.addEventListener('click', (e) => {
      if (referenceImage && e.target === referenceImagePreview) {
        openLightbox(referenceImagePreview.src);
      } else if (!(e.target as HTMLElement).closest('a')) {
        imageUpload.click();
      }
    });

    ['dragover', 'dragleave', 'drop'].forEach(eventName => uploadContainer.addEventListener(eventName, e => {
        e.preventDefault(); e.stopPropagation();
        if (eventName === 'dragover') uploadContainer.classList.add('drag-over');
        if (eventName === 'dragleave' || eventName === 'drop') uploadContainer.classList.remove('drag-over');
        if (eventName === 'drop') {
            const files = (e as DragEvent).dataTransfer?.files;
            if (files && files.length > 0) handlePage2Upload(files);
        }
    }));

    (window as any).navigateToPage('page1');
    updateAllGenerateButtons();
    updatePage1WizardState();
    updateAuthUI();

  } catch (error) {
    console.error("Fatal Error: Could not load prompts configuration.", error);
    document.body.innerHTML = `<div class="w-screen h-screen flex items-center justify-center bg-gray-900 text-white"><div class="text-center p-8 bg-gray-800 rounded-lg shadow-lg"><h1 class="text-2xl font-bold text-red-500 mb-4">Ошибка загрузки приложения</h1><p>Не удалось загрузить необходимые данные (prompts.json).</p><p>Пожалуйста, проверьте консоль и перезагрузите страницу.</p></div></div>`;
  }
});