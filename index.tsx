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
let referenceImageLocationPrompt: string | null = null; // NEW: Stores location prompt associated with reference
let detectedSubjectCategory: SubjectCategory | null = null;
let detectedSmileType: SmileType | null = null;
let malePoseIndex = 0;
let femalePoseIndex = 0;
let femaleGlamourPoseIndex = 0;
let prompts: Prompts | null = null;
let generationCredits = 0; // All users start with 0 credits until they log in.
let isLoggedIn = false;
let userProfile: UserProfile | null = null;
let idToken: string | null = null; // Holds the Google Auth Token
const GOOGLE_CLIENT_ID = '455886432948-lk8a1e745cq41jujsqtccq182e5lf9dh.apps.googleusercontent.com';
let db: IDBPDatabase<PhotoClickDB>;

// Page 1 State Variables (Moved here for accessibility)
let page1ReferenceImage: ImageState | null = null;
let page1ClothingImage: ImageState | null = null;
let generatedPhotoshootResult: ImageState | null = null;
let page1DetectedSubject: SubjectDetails | null = null;


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


// --- Helper Functions ---

function signOut() {
    isLoggedIn = false;
    userProfile = null;
    idToken = null;
    localStorage.removeItem('idToken');
    generationCredits = 0;
    
    if (authContainer) authContainer.classList.remove('hidden');
    if (userProfileContainer) userProfileContainer.classList.add('hidden');
    if (userProfileImage) userProfileImage.src = '';
    if (userProfileName) userProfileName.textContent = '';
    
    updateCreditCounterUI();
    updateAllGenerateButtons();
    showStatusError('Вы вышли из системы.');
    setWizardStep('AUTH');
}

function showPaymentModal() {
    if (paymentModalOverlay) {
        paymentModalOverlay.classList.remove('hidden');
    }
}

function hidePaymentModal() {
    if (paymentModalOverlay) {
        paymentModalOverlay.classList.add('hidden');
    }
    if (paymentQrView) paymentQrView.classList.add('hidden');
    // Assuming paymentSelectionView exists from the context of hidePaymentModal
    const paymentSelectionView = document.querySelector('#payment-selection-view') as HTMLDivElement;
    if (paymentSelectionView) paymentSelectionView.classList.remove('hidden');
}

function updatePage1WizardState() {
    if (generatedPhotoshootResult) {
        setWizardStep('NONE');
    } else if (!page1ReferenceImage) {
        setWizardStep('PAGE1_PHOTO');
    } else if (!page1ClothingImage) {
        setWizardStep('PAGE1_CLOTHING');
    } else {
        const locationInput = document.getElementById('location-prompt-input') as HTMLInputElement;
        if (locationInput && !locationInput.value) {
            setWizardStep('PAGE1_LOCATION');
        } else {
            setWizardStep('PAGE1_GENERATE');
        }
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


/**
 * A generic helper function to make API calls to our own server backend.
 * It automatically includes the authentication token and adds a timeout.
 * @param endpoint The API endpoint to call.
 * @param body The JSON payload to send.
 * @returns A promise that resolves with the JSON response from the server.
 */
async function callApi(endpoint: string, body: object) {
    const controller = new AbortController();
    // 45-second timeout for API calls, as Gemini can be slow, but this prevents infinite hangs on network issues.
    const timeoutId = setTimeout(() => controller.abort(), 45000);

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
            throw new Error('Не удалось связаться с сервером. Это может быть связано с проблемами сети или региональными блокировками. Проверьте ваше соединение и попробуйте снова.');
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
    malePoseIndex = 0;
    femalePoseIndex = 0;
    femaleGlamourPoseIndex = 0;
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
  referenceImageLocationPrompt = null;
  detectedSubjectCategory = null;
  detectedSmileType = null;
  initializePoseSequences();
  referenceImagePreview.src = '';
  referenceImagePreview.classList.add('hidden');
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
            generateButton.innerHTML = `Создать ${creditsNeeded} фотографии (Осталось: ${generationCredits})`;
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
    referenceImageLocationPrompt = null; // NEW: Reset location prompt on re-reference
    referenceImagePreview.src = imgSrc;
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

  const placeholders: HTMLDivElement[] = [];
  for (let i = 4; i > 0; i--) { // Correct loop to create 4 placeholders
    const placeholder = document.createElement('div');
    placeholder.className = 'bg-[#353739] rounded-lg relative overflow-hidden aspect-square placeholder-shimmer';
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
        
        let finalPrompt = `Это референсное фото. Твоя задача — сгенерировать новое фотореалистичное изображение, следуя строгим правилам.\n\nКРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:\n1.  **АБСОЛЮТНАЯ УЗНАВАЕМОСТЬ:** Внешность, уникальные черты лица (форма носа, глаз, губ), цвет кожи, прическа и выражение лица человека должны остаться АБСОЛЮТНО ИДЕНТИЧНЫМИ оригиналу. Это самое важное правило.\n2.  **НОВАЯ КОМПОЗИЦИЯ И РАКУРС:** Примени следующие изменения: "${changesDescription}". Это главный творческий элемент.\n3.  **СОХРАНИ ОДЕЖДУ:** Одежда человека должна быть взята с референсного фото.\n${backgroundPromptPart}`;
        
        if (customText) {
            finalPrompt += `\n5. **ВАЖНОЕ ДОПОЛНЕНИЕ:** Также учти это пожелание: "${customText}".`;
        }
        
        finalPrompt += `\n\n**ФИНАЛЬНАЯ ПРОВЕРКА СХОДСТВА:** Лицо должно быть максимально похожим и быть двойником референсного изображения с учетом эмоций и освещения.`;
        finalPrompt += `\n\n**КАЧЕСТВО:** стандартное разрешение, оптимизировано для веб.\n\nРезультат — только одно изображение без текста.`;
        generationPrompts.push(finalPrompt);
    }
    
    if (progressText) progressText.innerText = 'Генерация... 10%';

    const { imageUrls, newCredits } = await callApi('/api/generateFourVariations', {
        prompts: generationPrompts,
        image: referenceImage!
    });
    
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
                referenceImageLocationPrompt = null; // NEW: History items don't have a baked-in prompt
                const dataUrl = `data:${referenceImage.mimeType};base64,${referenceImage.base64}`;
                referenceImagePreview.src = dataUrl;
                referenceImagePreview.classList.remove('hidden');
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

function displaySuggestions(container: HTMLElement, allSuggestions: string[], shownSuggestions: Set<string>, input: HTMLInputElement) {
    container.innerHTML = '';
    let availableSuggestions = allSuggestions.filter(s => !shownSuggestions.has(s));
    if (availableSuggestions.length < 10) {
        shownSuggestions.clear();
        availableSuggestions = allSuggestions;
    }
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

function setupUploader(containerId: string, inputId: string, previewId: string, placeholderId: string, clearButtonId: string, onStateChange: (state: ImageState | null) => Promise<void>) {
    const uploadContainer = document.getElementById(containerId) as HTMLDivElement;
    const imageUpload = document.getElementById(inputId) as HTMLInputElement;
    const imagePreview = document.getElementById(previewId) as HTMLImageElement;
    const uploadPlaceholder = document.getElementById(placeholderId) as HTMLDivElement;
    const clearButton = document.getElementById(clearButtonId) as HTMLButtonElement;

    const handleFile = async (file: File) => {
        if (!file || !file.type.startsWith('image/')) return;

        try {
            // Use the new memory-efficient pre-resizer first for large images
            const preResizedState = await preResizeImage(file);
            const dataUrl = `data:${preResizedState.mimeType};base64,${preResizedState.base64}`;
            
            imagePreview.src = dataUrl;
            imagePreview.classList.remove('hidden');
            uploadPlaceholder.classList.add('hidden');
            clearButton.classList.remove('hidden');
            
            const statusText = `Оптимизация изображения...`;
            if(statusEl) statusEl.innerText = statusText;

            // Now, use the existing final resizer
            const finalResizedState = await resizeImage(preResizedState);
            
            imagePreview.src = `data:${finalResizedState.mimeType};base64,${finalResizedState.base64}`;
            await onStateChange(finalResizedState);
            if(statusEl && statusEl.innerText === statusText) statusEl.innerText = '';

        } catch (err) {
            console.error("Ошибка обработки изображения:", err);
            showStatusError(err instanceof Error ? err.message : "Не удалось обработать изображение.");
            await onStateChange(null);
            // Also need to reset the UI elements
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
            const file = (e as DragEvent).dataTransfer?.files?.[0];
            if (file) handleFile(file);
        }
    }));
    imageUpload.addEventListener('change', (event) => { if ((event.target as HTMLInputElement).files?.[0]) handleFile((event.target as HTMLInputElement).files[0]); });
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

// --- Initialization ---
document.addEventListener('DOMContentLoaded', async () => {
    // DOM Elements Assignment
    lightboxOverlay = document.getElementById('lightbox-overlay') as HTMLDivElement;
    lightboxImage = document.getElementById('lightbox-image') as HTMLImageElement;
    lightboxCloseButton = document.getElementById('lightbox-close') as HTMLButtonElement;
    statusEl = document.getElementById('status') as HTMLDivElement;
    planButtonsContainer = document.getElementById('plan-buttons') as HTMLDivElement;
    generateButton = document.getElementById('generate-button') as HTMLButtonElement;
    resetButton = document.getElementById('reset-button') as HTMLButtonElement;
    outputGallery = document.getElementById('output-gallery') as HTMLDivElement;
    uploadContainer = document.getElementById('upload-container') as HTMLDivElement;
    imageUpload = document.getElementById('image-upload') as HTMLInputElement;
    referenceImagePreview = document.getElementById('reference-image-preview') as HTMLImageElement;
    uploadPlaceholder = document.getElementById('upload-placeholder') as HTMLDivElement;
    customPromptInput = document.getElementById('custom-prompt') as HTMLInputElement;
    referenceDownloadButton = document.getElementById('download-reference-link') as HTMLAnchorElement;
    paymentModalOverlay = document.getElementById('payment-modal-overlay') as HTMLDivElement;
    paymentConfirmButton = document.getElementById('confirm-payment-button') as HTMLButtonElement;
    paymentCloseButton = document.getElementById('close-payment-button') as HTMLButtonElement;
    creditCounterEl = document.getElementById('credit-counter') as HTMLDivElement;
    promoCodeInput = document.getElementById('promo-code-input') as HTMLInputElement;
    applyPromoButton = document.getElementById('apply-promo-button') as HTMLButtonElement;
    authContainer = document.getElementById('auth-container') as HTMLDivElement;
    googleSignInContainer = document.getElementById('google-signin-container') as HTMLDivElement;
    userProfileContainer = document.getElementById('user-profile-container') as HTMLDivElement;
    userProfileImage = document.getElementById('user-profile-image') as HTMLImageElement;
    userProfileName = document.getElementById('user-profile-name') as HTMLSpanElement;
    paymentQrView = document.getElementById('payment-qr-view') as HTMLDivElement;
    paymentQrImage = document.getElementById('payment-qr-image') as HTMLImageElement;
    paymentBackButton = document.getElementById('payment-back-button') as HTMLButtonElement;

    paymentQrView?.classList.add('hidden');
    if(lightboxCloseButton) lightboxCloseButton.addEventListener('click', hideLightbox);
    if(lightboxOverlay) lightboxOverlay.addEventListener('click', (e) => { if(e.target === lightboxOverlay) hideLightbox(); });
    if(resetButton) resetButton.addEventListener('click', resetApp);
    if(generateButton) generateButton.addEventListener('click', generate);
    if(paymentCloseButton) paymentCloseButton.addEventListener('click', hidePaymentModal);
    if(paymentBackButton) paymentBackButton.addEventListener('click', () => {
        paymentQrView.classList.add('hidden');
        // Assuming paymentSelectionView exists from the context of hidePaymentModal
        const paymentSelectionView = document.querySelector('#payment-selection-view') as HTMLDivElement;
        if(paymentSelectionView) paymentSelectionView.classList.remove('hidden');
    });

    await initDB();

    // Mock prompts initialization to prevent crashes if backend fetch is not implemented
    prompts = {
        femalePosePrompts: ['standing confident', 'walking away', 'sitting relaxed'],
        femaleGlamourPosePrompts: ['fashion pose', 'hand on hip'],
        femaleCameraAnglePrompts: ['eye level', 'low angle'],
        malePosePrompts: ['standing straight', 'arms crossed'],
        maleCameraAnglePrompts: ['eye level'],
        femaleCloseUpPosePrompts: ['looking at camera'],
        maleCloseUpPosePrompts: ['looking at camera'],
        elderlyFemalePosePrompts: ['sitting'],
        elderlyFemaleCloseUpPosePrompts: ['smiling'],
        elderlyMalePosePrompts: ['standing'],
        elderlyMaleCloseUpPosePrompts: ['serious'],
        drasticCameraShiftPrompts: ['extreme high angle', 'wide shot'],
        femaleClothingSuggestions: ['dress', 'jeans'],
        maleClothingSuggestions: ['suit', 'casual'],
        teenClothingSuggestions: ['hoodie'],
        elderlyFemaleClothingSuggestions: ['cardigan'],
        elderlyMaleClothingSuggestions: ['shirt'],
        childClothingSuggestions: ['t-shirt'],
        locationSuggestions: ['park', 'studio'],
        childLocationSuggestions: ['playground'],
        teenLocationSuggestions: ['mall'],
        locationSets: {},
        couplePosePrompts: []
    };
    initializePoseSequences();

    // Page 2 Uploader
    if (uploadContainer) {
        setupUploader(
            'upload-container', 'image-upload', 'reference-image-preview', 'upload-placeholder', 'clear-reference-button',
            async (state) => {
                referenceImage = state;
                if (!state) {
                    resetApp();
                    return;
                }
                
                statusEl.innerText = 'Анализ изображения...';
                try {
                    const { category, smile } = await checkImageSubject(state);
                    detectedSubjectCategory = category;
                    detectedSmileType = smile;
                    initializePoseSequences(); // Re-init sequences based on new subject
                    
                    const subjectMap: Record<string, string> = { 
                        woman: 'женщина', man: 'мужчина', teenager: 'подросток', 
                        elderly_woman: 'пожилая женщина', elderly_man: 'пожилый мужчина', 
                        child: 'ребенок' 
                    };
                    statusEl.innerText = `Изображение загружено. Обнаружен: ${subjectMap[category] || 'человек'}.`;
                    updateAllGenerateButtons();
                    setWizardStep('PAGE2_PLAN');
                } catch (e) {
                    showStatusError(e instanceof Error ? e.message : 'Ошибка анализа.');
                    referenceImage = null;
                    resetApp();
                }
            }
        );
    }

    setupNavigation();

    // Check for existing session
    const token = localStorage.getItem('idToken');
    if (token) {
        // In a real app, we would verify the token with the backend here
        // For now, just assume logged in if token exists and try to load profile
        isLoggedIn = true;
        idToken = token;
        // Trigger a profile fetch or similar if needed
        // For now just update UI
        if (authContainer) authContainer.classList.add('hidden');
        if (userProfileContainer) userProfileContainer.classList.remove('hidden');
        updateAllGenerateButtons();
    }
});
