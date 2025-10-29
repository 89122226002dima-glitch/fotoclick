/* tslint:disable */
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

// --- Type Definitions ---
interface ImageState {
  base64: string;
  mimeType: string;
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

// --- NEW User State ---
interface User {
    id: number;
    email: string;
    displayName: string;
    credits: number;
}


// --- Wizard State ---
type WizardStep = 'PAGE1_PHOTO' | 'PAGE1_CLOTHING' | 'PAGE1_LOCATION' | 'PAGE1_GENERATE' | 'PAGE2_PLAN' | 'PAGE2_GENERATE' | 'CREDITS' | 'LOGIN' | 'NONE';

// --- DOM Element Variables (will be assigned on DOMContentLoaded) ---
let lightboxOverlay: HTMLDivElement, lightboxImage: HTMLImageElement, lightboxCloseButton: HTMLButtonElement, statusEl: HTMLDivElement,
    planButtonsContainer: HTMLDivElement, generateButton: HTMLButtonElement, resetButton: HTMLButtonElement,
    outputGallery: HTMLDivElement, uploadContainer: HTMLDivElement, imageUpload: HTMLInputElement,
    referenceImagePreview: HTMLImageElement, uploadPlaceholder: HTMLDivElement, customPromptInput: HTMLInputElement,
    referenceDownloadButton: HTMLAnchorElement, userAreaEl: HTMLDivElement;


// --- State Variables ---
let currentUser: User | null | undefined = undefined; // undefined: loading, null: logged out, User: logged in
let selectedPlan = 'close_up';
let referenceImage: ImageState | null = null;
let detectedSubjectCategory: SubjectCategory | null = null;
let detectedSmileType: SmileType | null = null;
let malePoseIndex = 0;
let femalePoseIndex = 0;
let femaleGlamourPoseIndex = 0;
let prompts: Prompts | null = null;

let poseSequences: {
    female: string[]; femaleGlamour: string[]; male: string[]; femaleCloseUp: string[]; maleCloseUp: string[];
    elderlyFemale: string[]; elderlyFemaleCloseUp: string[]; elderlyMale: string[]; elderlyMaleCloseUp: string[];
} = {
    female: [], femaleGlamour: [], male: [], femaleCloseUp: [], maleCloseUp: [],
    elderlyFemale: [], elderlyFemaleCloseUp: [], elderlyMale: [], elderlyMaleCloseUp: [],
};

const MAX_DIMENSION = 1024;

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
        page2Plans: document.getElementById('plan-buttons'),
        page2Generate: document.getElementById('generate-button'),
        credits: document.getElementById('user-area'), // Highlight the whole user area
        login: document.getElementById('user-area'), // Highlight the login buttons
    };

    // Remove the highlight class from all targets first
    Object.values(targets).forEach(el => el?.classList.remove('highlight-step'));

    // Apply the highlight class to the specific target
    switch (step) {
        case 'PAGE1_PHOTO': targets.page1Photo?.classList.add('highlight-step'); break;
        case 'PAGE1_CLOTHING': targets.page1Clothing?.classList.add('highlight-step'); break;
        case 'PAGE1_LOCATION': targets.page1Location?.classList.add('highlight-step'); break;
        case 'PAGE1_GENERATE': targets.page1Generate?.classList.add('highlight-step'); break;
        case 'PAGE2_PLAN': targets.page2Plans?.classList.add('highlight-step'); break;
        case 'PAGE2_GENERATE': targets.page2Generate?.classList.add('highlight-step'); break;
        case 'CREDITS': targets.credits?.classList.add('highlight-step'); break;
        case 'LOGIN': targets.login?.classList.add('highlight-step'); break;
        case 'NONE': // Do nothing, all highlights are cleared
            break;
    }
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
 * Crops tall images (like screenshots) by removing the top and bottom sections.
 * This is used to clean up clothing reference images.
 * @param imageState The image to process.
 * @returns A promise that resolves with the cropped image state, or the original if not a tall image.
 */
async function cropImage(imageState: ImageState): Promise<ImageState> {
    const topPercent = 15;
    const bottomPercent = 20;
    const requiredAspectRatio = 3 / 2; // Crop if taller than 3:2 portrait (1.5)

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const originalWidth = img.width;
            const originalHeight = img.height;

            // Only crop if image is taller than the required aspect ratio.
            if (originalWidth <= 0 || (originalHeight / originalWidth) <= requiredAspectRatio) {
                resolve(imageState);
                return;
            }

            const topCrop = originalHeight * (topPercent / 100);
            const bottomCrop = originalHeight * (bottomPercent / 100);
            const newHeight = originalHeight - topCrop - bottomCrop;
            
            if (newHeight <= 0) { // Safety check
                resolve(imageState);
                return;
            }

            const canvas = document.createElement('canvas');
            canvas.width = originalWidth;
            canvas.height = newHeight;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Не удалось получить 2D контекст холста для обрезки.'));
            }
            
            // Draw the middle part of the source image onto the new, smaller canvas
            ctx.drawImage(img,
                0, topCrop,                 // Source x, y (start cropping from 20% down)
                originalWidth, newHeight,  // Source width, height (the middle 60% of the image)
                0, 0,                      // Destination x, y (draw at the top-left of the canvas)
                originalWidth, newHeight   // Destination width, height (fill the new canvas)
            );

            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const [, base64] = dataUrl.split(',');
            const mimeType = 'image/jpeg';

            resolve({ base64, mimeType });
        };
        img.onerror = (err) => {
            console.error("Ошибка при загрузке изображения для обрезки:", err);
            reject(new Error('Не удалось загрузить изображение для обрезки.'));
        };
        img.src = `data:${imageState.mimeType};base64,${imageState.base64}`;
    });
}

/**
 * A generic helper function to make API calls to our own server backend.
 * @param endpoint The API endpoint to call (e.g., '/api/generateVariation').
 * @param body The JSON payload to send.
 * @returns A promise that resolves with the JSON response from the server.
 */
async function callApi(endpoint: string, body: object) {
    const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        let errorData = { error: `Сервер вернул ошибку ${response.status}.`};
        try {
            const errorText = await response.text();
            errorData = JSON.parse(errorText);
        } catch (e) {
             console.error("Failed to parse server error JSON, status:", response.status);
        }
        
        // Handle specific authentication error
        if (response.status === 401) {
            errorData.error = "Пожалуйста, войдите в систему, чтобы продолжить.";
            setWizardStep('LOGIN');
        } else if (response.status === 402) { // Payment Required
             errorData.error = "У вас недостаточно кредитов для этого действия.";
             setWizardStep('CREDITS');
        }
        
        console.error(`Ошибка API на ${endpoint}:`, errorData);
        throw new Error(errorData.error || `Технические детали записаны в консоль разработчика.`);
    }

    return response.json();
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

async function generateVariation(prompt: string, image: ImageState): Promise<{ imageUrl: string, newCreditCount: number }> {
   try {
        const data = await callApi('/api/generateVariation', { prompt, image });
        return { imageUrl: data.imageUrl, newCreditCount: data.newCreditCount };
    } catch (e) {
        console.error('generateVariation failed:', e);
        throw e;
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

function updateUser(user: User | null) {
    currentUser = user;
    renderUserArea();
    updateAllGenerateButtons();
    updatePage1WizardState();
}

function renderUserArea() {
    if (!userAreaEl) return;
    const promoContainer = document.getElementById('promo-code-container');

    if (currentUser === undefined) { // Loading state
        userAreaEl.innerHTML = `<div class="loading-spinner small"></div>`;
        promoContainer?.classList.add('hidden');
        return;
    }
    
    if (currentUser === null) { // Logged out
        userAreaEl.innerHTML = `
            <div class="flex items-center gap-2">
                <a href="/auth/google" class="auth-button google">Войти через Google</a>
            </div>
        `;
        promoContainer?.classList.add('hidden');
        return;
    }

    // Logged in
    promoContainer?.classList.remove('hidden');
    userAreaEl.innerHTML = `
        <div class="flex items-center gap-4">
            <div class="text-right hidden sm:block">
                <p class="text-sm font-medium truncate" title="${currentUser.email}">${currentUser.displayName || currentUser.email}</p>
                <p class="text-xs text-gray-500">Добро пожаловать!</p>
            </div>
            <div id="credit-counter" class="credit-counter-glow bg-black/30 backdrop-blur-sm px-3 py-1.5 rounded-full text-base font-semibold flex items-center gap-1.5" title="Кредиты">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-yellow-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M8.433 7.418c.158-.103.346-.196.567-.267v1.698a2.5 2.5 0 00-.567-.267C8.07 8.488 8 8.731 8 9c0 .269.07.512.433.582.221.07.41.164.567.267v1.698c-.22.071-.409.164-.567-.267C8.07 11.512 8 11.731 8 12c0 .269.07.512.433.582.221.07.41.164.567.267v1.698c-1.135-.285-2-1.201-2-2.423 0-1.22.865-2.138 2-2.423v-1.698c.221.07.41.164.567.267C11.93 8.488 12 8.731 12 9c0 .269-.07-.512-.433-.582-.221-.07-.41-.164-.567-.267V7.862c1.135.285 2 1.201 2 2.423 0 1.22-.865-2.138-2 2.423v1.698a2.5 2.5 0 00.567-.267c.364-.24.433-.482.433-.582 0-.269-.07-.512-.433-.582-.221-.07-.41-.164-.567-.267V12.14c1.135-.285 2-1.201 2-2.423s-.865-2.138-2-2.423V5.577c1.135.285 2 1.201 2 2.423 0 .269.07.512.433.582.221.07.409.164.567.267V7.862a2.5 2.5 0 00-.567-.267C11.93 7.512 12 7.269 12 7c0-1.22-.865-2.138-2-2.423V3a1 1 0 00-2 0v1.577C6.865 4.862 6 5.78 6 7c0 .269.07.512.433.582.221.07.41.164.567.267V6.14a2.5 2.5 0 00-.567-.267C5.07 5.512 5 5.269 5 5c0-1.22.865-2.138 2-2.423V1a1 1 0 10-2 0v1.577c-1.135-.285-2 1.201-2 2.423s.865 2.138 2 2.423v1.698c-.221-.07-.41-.164-.567-.267C4.07 8.488 4 8.731 4 9s.07.512.433.582c.221.07.41.164.567.267v1.698a2.5 2.5 0 00.567.267C4.07 11.512 4 11.731 4 12s.07.512.433.582c.221.07.41.164.567.267v1.698c-.221-.07-.409-.164-.567-.267C4.07 13.512 4 13.731 4 14c0 1.22.865 2.138 2 2.423v1.577a1 1 0 102 0v-1.577c1.135-.285 2-1.201 2-2.423s-.865-2.138-2-2.423v-1.698c.221.07.41.164.567.267.364.24.433.482.433.582s-.07.512-.433-.582c-.221-.07-.41-.164-.567-.267v1.698a2.5 2.5 0 00.567.267c.364.24.433.482.433.582s-.07.512-.433-.582c-.221-.07-.41-.164-.567-.267V13.86c-1.135-.285-2-1.201-2-2.423s.865-2.138 2-2.423V7.862c-.221-.07-.41-.164-.567-.267C8.07 7.512 8 7.269 8 7c0-.269.07.512.433-.582z" /></svg>
                <span class="credit-value">${currentUser.credits}</span>
                <span class="hidden sm:inline credit-label">кредитов</span>
            </div>
             <a href="/auth/logout" class="logout-button" title="Выйти">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z" clip-rule="evenodd" /></svg>
            </a>
        </div>
    `;
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
  if (container.id === 'output-gallery') errorContainer.classList.add('col-span-1', 'md:col-span-2');
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
    const creditsNeededPage2 = 4;
    const creditsAvailable = currentUser?.credits ?? 0;

    if (generateButton) {
        generateButton.disabled = !referenceImage || !currentUser;
        generateButton.innerHTML = `Создать ${creditsNeededPage2} фото (${creditsNeededPage2} кр.)`;
        
        if (!currentUser) {
           generateButton.innerHTML = 'Войдите, чтобы генерировать';
        } else if (creditsAvailable < creditsNeededPage2) {
            generateButton.innerHTML = `Нужно ${creditsNeededPage2} кредита`;
        }
    }
}


async function generate() {
  if (!currentUser) {
      showStatusError('Пожалуйста, войдите в систему, чтобы создавать изображения.');
      setWizardStep('LOGIN');
      return;
  }
  
  if (!referenceImage || !detectedSubjectCategory || !prompts) {
    showStatusError('Пожалуйста, загрузите изображение-референс человека.');
    return;
  }

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
  for (let i = 0; i < 4; i++) {
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
            cameraAnglePrompt = availableDrasticShifts.pop() || availableStandardAngles.pop() || '';
        } else {
            cameraAnglePrompt = availableStandardAngles.pop() || availableDrasticShifts.pop() || '';
        }
        allChanges.push(cameraAnglePrompt);

        const customText = customPromptInput.value.trim();
        if (customText) {
            allChanges.push(`дополнительная деталь: ${customText}`);
        } else {
            let currentPose: string;
            if (detectedSubjectCategory === 'woman' && glamourPoses.length > 0 && i < 2) { 
                currentPose = glamourPoses.pop() || poses.pop() || '';
            } else {
                currentPose = poses.pop() || '';
            }
             if (currentPose) allChanges.push(currentPose);
        }
        
        const changesDescription = allChanges.filter(Boolean).join(', ');
        const finalPrompt = `Это референсное фото. Твоя задача — сгенерировать новое фотореалистичное изображение, следуя строгим правилам.\n\nКРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:\n1.  **АБСОЛЮТНАЯ УЗНАВАЕМОСТЬ:** Внешность, уникальные черты лица (форма носа, глаз, губ), цвет кожи, прическа и выражение лица человека должны остаться АБСОЛЮТНО ИДЕНТИЧНЫМИ оригиналу. Это самое важное правило. Не изменяй человека.\n2.  **РАСШИРЬ ФОН:** Сохрани стиль, атмосферу и ключевые детали фона с референсного фото, но дострой и сгенерируй его так, чтобы он соответствовал новому ракурсу камеры. Представь, что ты поворачиваешь камеру в том же самом месте.\n3.  **СОХРАНИ ОДЕЖДУ:** Одежда человека должна быть взята с референсного фото.\n4.  **НОВАЯ КОМПОЗИЦИЯ И РАКУРС:** Примени следующие изменения: "${changesDescription}". Это главный творческий элемент.\n\n**КАЧЕСТВО:** стандартное разрешение, оптимизировано для веб.\n\nРезультат — только одно изображение без текста.`;
        generationPrompts.push(finalPrompt);
    }
    
    if (progressText) progressText.innerText = 'Генерация... 10%';
    const generationPromises = generationPrompts.map(prompt => generateVariation(prompt, referenceImage!));
    
    const results = await Promise.allSettled(generationPromises);
    let successfulGenerations = 0;
    
    if (progressBar && progressText) {
        progressBar.style.width = `100%`;
        progressText.innerText = `Обработка завершена!`;
    }

    results.forEach((result, i) => {
        const imgContainer = placeholders[i];
        imgContainer.classList.remove('placeholder-shimmer');
        imgContainer.innerHTML = '';
        
        if (result.status === 'fulfilled') {
            successfulGenerations++;
            const { imageUrl, newCreditCount } = result.value;
            // Update user state with the latest credit count from the last successful response
            if (currentUser && newCreditCount !== undefined) {
                updateUser({ ...currentUser, credits: newCreditCount });
            }

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
            
            const setAsReference = () => {
              const [header, base64] = img.src.split(',');
              const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
              referenceImage = { base64, mimeType };
              referenceImagePreview.src = img.src;
              referenceDownloadButton.href = img.src;
              referenceDownloadButton.download = `variation-reference-${Date.now()}.png`;
              referenceDownloadButton.classList.remove('hidden');
              initializePoseSequences();
              uploadContainer.classList.remove('aspect-square');
              outputGallery.querySelectorAll<HTMLDivElement>('.gallery-item').forEach(c => c.classList.remove('is-reference'));
              imgContainer.classList.add('is-reference');
              statusEl.innerText = 'Новый референс выбран. Создайте новые вариации.';
            };

            imgContainer.querySelector('a')?.addEventListener('click', e => e.stopPropagation());
            imgContainer.querySelector('.set-ref-button')?.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); setAsReference(); });
            imgContainer.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('a, button')) openLightbox(img.src); });

        } else {
            const error = result.reason as Error;
            const errorMessage = error.message || 'Ошибка генерации';
            displayErrorInContainer(imgContainer, errorMessage, true);
            console.error(`Error generating variation ${i + 1}:`, error);
        }
    });
    
    // If all generations failed, we might not have an updated credit count. Re-fetch to be sure.
    if (successfulGenerations === 0) {
        fetchCurrentUser();
    }


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
    fetchCurrentUser(); // Re-fetch user to restore correct credit count if call failed before deduction
  } finally {
    setControlsDisabled(false);
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

        if (pageId === 'page1') {
            updatePage1WizardState();
        } else if (pageId === 'page2') {
            if (referenceImage) {
                setWizardStep('PAGE2_PLAN');
            } else {
                setWizardStep('NONE');
            }
        }
    };
    navContainer.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-page]');
        if (button?.dataset.page) navigateToPage(button.dataset.page);
    });
    (window as any).navigateToPage = navigateToPage;
}

let page1ReferenceImage: ImageState | null = null;
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

    const handleFile = (file: File) => {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            const dataUrl = e.target?.result as string;
            if (dataUrl) {
                imagePreview.src = dataUrl;
                imagePreview.classList.remove('hidden');
                uploadPlaceholder.classList.add('hidden');
                clearButton.classList.remove('hidden');
                
                const [header, base64] = dataUrl.split(',');
                const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
                const originalState: ImageState = { base64, mimeType };

                try {
                    const statusText = `Оптимизация изображения...`;
                    if(statusEl) statusEl.innerText = statusText;

                    const resizedState = await resizeImage(originalState);
                    
                    imagePreview.src = `data:${resizedState.mimeType};base64,${resizedState.base64}`;
                    await onStateChange(resizedState);
                    if(statusEl && statusEl.innerText === statusText) statusEl.innerText = '';

                } catch (err) {
                    console.error("Ошибка изменения размера изображения:", err);
                    showStatusError("Не удалось оптимизировать изображение. Используется оригинал.");
                    await onStateChange(originalState); // Fallback to original
                }
            }
        };
        reader.readAsDataURL(file);
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

async function generatePhotoshoot(parts: any[]): Promise<{ resultUrl: string; generatedPhotoshootResult: ImageState, newCreditCount: number }> {
    try {
        const data = await callApi('/api/generatePhotoshoot', { parts });
        return data;
    } catch (e) {
        console.error('generatePhotoshoot failed:', e);
        throw e;
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
        if (!currentUser) {
            displayErrorInContainer(photoshootResultContainer, 'Пожалуйста, войдите, чтобы начать фотосессию.');
            setWizardStep('LOGIN');
            return;
        }
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

            const parts: any[] = [{ inlineData: { data: page1ReferenceImage.base64, mimeType: page1ReferenceImage.mimeType } }];
            let promptText: string;
            
            if (page1ClothingImage) {
                parts.push({ inlineData: { data: page1ClothingImage.base64, mimeType: page1ClothingImage.mimeType } });
                const additionalClothingDetails = clothingText ? ` Дополнительные пожелания к одежде (например, изменение цвета или детали): "${clothingText}".` : '';
                promptText = `Твоя задача — действовать как 'цифровой стилист', используя это референсное фото человека (первое изображение) и референсное фото одежды (второе изображение).
Твоя главная цель — идеально сохранить человека с первого фото, изменив только его одежду и фон, и приведя результат к стандартному фото-формату.
КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1.  **СОХРАНИ ЧЕЛОВЕКА:** Внешность, уникальные черты лица (форма носа, глаз, губ), цвет кожи, прическа и выражение лица человека с ПЕРВОГО фото должны остаться АБСОЛЮТНО ИДЕНТИЧНЫМИ оригиналу. Это самое важное правило. Не изменяй человека.
2.  **НОВЫЙ ФОРМАТ ИЗОБРАЖЕНИЯ:** Итоговое изображение должно иметь стандартное фотографическое соотношение сторон **${aspectRatioInstruction}**. Игнорируй оригинальные пропорции референсного фото.
3.  **АДАПТИРУЙ КОМПОЗИЦИЮ:** Сохрани основную композицию и кадрирование человека с референсного фото (например, если это был портрет по пояс, результат тоже должен быть портретом по пояс), но адаптируй его под новое соотношение сторон ${aspectRatioInstruction}. Поза должна остаться без изменений.
4.  **ЗАМЕНИ ОДЕЖДУ:** Переодень человека в: "**одежду которую нужно взять в точности со 2 референсной фотографии,нужно взять только одежду и игнорировать лицо на 2 референсном кадре**". Нарисуй только ту часть одежды, которая видна в новом кадре.${additionalClothingDetails}
5.  **ЗАМЕНИ ФОН:** Полностью замени фон на новый: "${locationText}".
6.  **АДАПТИРУЙ ОСВЕЩЕНИЕ:** Сделай так, чтобы освещение на человеке гармонично соответствовало новому фону, но при этом НЕ ИЗМЕНЯЙ его черты лица или цвет кожи. Освещение должно выглядеть естественно и фотореалистично.
**КАЧЕСТВО:** стандартное разрешение, оптимизировано для веб.
Результат — только одно изображение без текста.`;
            } else {
                promptText = `Твоя задача — действовать как 'цифровой стилист', используя это референсное фото.
Твоя главная цель — идеально сохранить человека с фото, изменив только его одежду и фон, и приведя результат к стандартному фото-формату.
КРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:
1.  **СОХРАНИ ЧЕЛОВЕКА:** Внешность, уникальные черты лица (форма носа, глаз, губ), цвет кожи, прическа и выражение лица человека должны остаться АБСОЛЮТНО ИДЕНТИЧНЫМИ оригиналу. Это самое важное правило. Не изменяй человека.
2.  **НОВЫЙ ФОРМАТ ИЗОБРАЖЕНИЯ:** Итоговое изображение должно иметь стандартное фотографическое соотношение сторон **${aspectRatioInstruction}**. Игнорируй оригинальные пропорции референсного фото.
3.  **АДАПТИРУЙ КОМПОЗИЦИЮ:** Сохрани основную композицию и кадрирование человека с референсного фото (например, если это был портрет по пояс, результат тоже должен быть портретом по пояс), но адаптируй его под новое соотношение сторон ${aspectRatioInstruction}. Поза должна остаться без изменений.
4.  **ЗАМЕНИ ОДЕЖДУ:** Переодень человека в: "${clothingText}". Нарисуй только ту часть одежды, которая видна в новом кадре.
5.  **ЗАМЕНИ ФОН:** Полностью замени фон на новый: "${locationText}".
6.  **АДАПТИРУЙ ОСВЕЩЕНИЕ:** Сделай так, чтобы освещение на человеке гармонично соответствовало новому фону, но при этом НЕ ИЗМЕНЯЙ его черты лица или цвет кожи. Освещение должно выглядеть естественно и фотореалистично.
**КАЧЕСТВО:** стандартное разрешение, оптимизировано для веб.
Результат — только одно изображение без текста.`;
            }
            parts.push({ text: promptText.trim() });
    
            const data = await generatePhotoshoot(parts);
             if (currentUser && data.newCreditCount !== undefined) {
                updateUser({ ...currentUser, credits: data.newCreditCount });
            }
            
            generatedPhotoshootResult = data.generatedPhotoshootResult;
            const resultUrl = `data:${generatedPhotoshootResult.mimeType};base64,${generatedPhotoshootResult.base64}`;

            photoshootResultContainer.innerHTML = `<div class="generated-photoshoot-wrapper cursor-pointer">
                    <img src="${resultUrl}" alt="Сгенерированная фотосессия" class="w-full h-auto object-contain rounded-lg max-h-[60vh]"/>
                    <div class="result-actions">
                         <a href="${resultUrl}" download="fotosessiya-${Date.now()}.png" class="result-action-button" title="Скачать"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd" /></svg></a>
                    </div></div>`;
            photoshootResultContainer.querySelector('.generated-photoshoot-wrapper')?.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest('a')) openLightbox(resultUrl); });

            if (generatedPhotoshootResult && page1DetectedSubject) {
                referenceImage = generatedPhotoshootResult;
                detectedSubjectCategory = page1DetectedSubject.category;
                detectedSmileType = page1DetectedSubject.smile;
                initializePoseSequences();
                const dataUrlForPage2 = `data:${referenceImage.mimeType};base64,${referenceImage.base64}`;
                referenceImagePreview.src = dataUrlForPage2;
                referenceImagePreview.classList.remove('hidden');
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
            fetchCurrentUser(); // Re-fetch on error to ensure credits are correct
        } finally {
            clearInterval(messageInterval);
            updatePage1WizardState();
        }
    }

    updatePage1WizardState = () => {
        const generatePhotoshootButton = document.getElementById('generate-photoshoot-button') as HTMLButtonElement;
        const clothingPromptInput = document.getElementById('clothing-prompt') as HTMLInputElement;
        const locationPromptInput = document.getElementById('location-prompt') as HTMLInputElement;

        if (!generatePhotoshootButton || !clothingPromptInput || !locationPromptInput) return;
        
        const isReady = !!(page1ReferenceImage && (page1ClothingImage || clothingPromptInput.value.trim()) && locationPromptInput.value.trim());
        const creditsNeeded = 1;
        const creditsAvailable = currentUser?.credits ?? 0;

        generatePhotoshootButton.disabled = !isReady || !currentUser;
        generatePhotoshootButton.innerHTML = `Начать фотосессию (${creditsNeeded} кр.)`;

        if (!currentUser) {
            generatePhotoshootButton.innerHTML = 'Войдите, чтобы начать';
        } else if (creditsAvailable < creditsNeeded) {
            generatePhotoshootButton.innerHTML = `Нужен ${creditsNeeded} кредит`;
        }


        // Wizard Logic
        if (!currentUser) {
            setWizardStep('LOGIN');
        }
        else if (!page1ReferenceImage) {
            setWizardStep('PAGE1_PHOTO');
        } else if (!page1ClothingImage && !clothingPromptInput.value.trim()) {
            setWizardStep('PAGE1_CLOTHING');
        } else if (!locationPromptInput.value.trim()) {
            setWizardStep('PAGE1_LOCATION');
        } else {
            setWizardStep('PAGE1_GENERATE');
        }
    };

    const resetWizard = () => {
        subtitle.textContent = 'Шаг 1: Загрузите ваше фото для начала';
        subtitle.classList.remove('text-red-400');
        clothingLocationContainer.classList.add('hidden');
        clothingPromptInput.value = ''; locationPromptInput.value = '';
        generatedPhotoshootResult = null; page1DetectedSubject = null;
        page1ClothingImage = null; page1LocationImage = null;
        shownClothingSuggestions.clear(); shownLocationSuggestions.clear();
        (document.getElementById('clothing-image-upload') as HTMLInputElement).value = '';
        (document.getElementById('clothing-image-preview') as HTMLImageElement).src = '';
        document.getElementById('clothing-image-preview')?.classList.add('hidden');
        document.getElementById('clothing-upload-placeholder')?.classList.remove('hidden');
        document.getElementById('clothing-clear-button')?.classList.add('hidden');
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
            shownClothingSuggestions.clear(); shownLocationSuggestions.clear();
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

    setupUploader('page1-upload-container', 'page1-image-upload', 'page1-image-preview', 'page1-upload-placeholder', 'page1-clear-button', async (state) => {
        page1ReferenceImage = state;
        if (state) await showCombinedSteps(state);
        else resetWizard();
    });
    
    setupUploader('clothing-upload-container', 'clothing-image-upload', 'clothing-image-preview', 'clothing-upload-placeholder', 'clothing-clear-button', async (state) => {
        if (!state) {
            page1ClothingImage = null;
        } else {
            try {
                const croppedState = await cropImage(state);
                page1ClothingImage = croppedState;
                const imagePreview = document.getElementById('clothing-image-preview') as HTMLImageElement;
                if (imagePreview) {
                    imagePreview.src = `data:${croppedState.mimeType};base64,${croppedState.base64}`;
                }
            } catch (err) {
                 console.error("Ошибка обрезки изображения одежды:", err);
                 showStatusError("Не удалось обрезать изображение одежды. Используется оригинал.");
                 page1ClothingImage = state;
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

    generatePhotoshootButton.addEventListener('click', doGeneratePhotoshoot);
    clothingPromptInput.addEventListener('input', updatePage1WizardState);
    locationPromptInput.addEventListener('input', updatePage1WizardState);
    refreshClothingBtn.addEventListener('mousedown', (e) => { e.preventDefault(); displaySuggestions(clothingSuggestionsContainer, currentClothingSuggestions, shownClothingSuggestions, clothingPromptInput) });
    refreshLocationBtn.addEventListener('mousedown', (e) => { if (!prompts) return; e.preventDefault(); displaySuggestions(locationSuggestionsContainer, currentLocationSuggestions, shownLocationSuggestions, locationPromptInput) });
    clothingPromptInput.addEventListener('focus', () => clothingSuggestionsContainer.classList.add('visible'));
    clothingPromptInput.addEventListener('blur', () => setTimeout(() => clothingSuggestionsContainer.classList.remove('visible'), 200));
    locationPromptInput.addEventListener('focus', () => locationSuggestionsContainer.classList.add('visible'));
    locationPromptInput.addEventListener('blur', () => setTimeout(() => locationSuggestionsContainer.classList.remove('visible'), 200));

    resetWizard();
}

function getUploaderPlaceholderHtml(): string {
  return `<div class="w-full h-full flex flex-col items-center justify-center p-4 gap-4">
    <div class="w-full max-w-xs aspect-square border border-stone-400/50 rounded-lg flex items-center justify-center p-2">
      <svg version="1.0" xmlns="http://www.w3.org/2000/svg" width="1024pt" height="1024pt" viewBox="0 0 1024 1024" preserveAspectRatio="xMidYMid" meet" class="w-full h-full object-contain text-stone-600 opacity-70 pointer-events-none">
        <g transform="translate(0,1024) scale(0.1,-0.1)" fill="currentColor" stroke="none">
          <path d="M4753 9900 c-140 -19 -330 -99 -472 -200 -83 -59 -227 -193 -273 -255 -17 -22 -5 -12 26 22 32 34 93 92 136 127 311 257 650 355 876 252 60 -28 65 -17 6 13 -75 38 -193 54 -299 41z"/>
          <path d="M5235 9197 c-46 -48 -79 -101 -180 -288 -83 -154 -169 -276 -274 -390 -68 -73 -84 -86 -113 -87 -63 -2 -159 -47 -215 -101 -36 -34 -27 -35 22 -1 49 34 115 60 149 60 17 -1 7 -14 -47 -65 -106 -99 -283 -230 -498 -367 -271 -173 -416 -282 -545 -412 -121 -121 -196 -225 -254 -350 -50 -108 -70 -190 -77 -316 -8 -142 13 -222 118 -445 45 -97 83 -174 85 -172 2 2 -28 76 -66 164 -86 197 -110 286 -110 408 0 119 26 222 90 350 61 123 127 213 245 330 114 115 189 171 515 388 276 183 396 273 541 407 l86 79 59 -18 c33 -11 103 -35 157 -55 99 -36 151 -45 162 -26 7 12 -3 50 -13 48 -4 -2 -18 5 -32 14 -31 21 -108 46 -205 67 l-74 16 75 89 c102 121 159 207 255 387 90 171 122 220 171 265 39 37 57 44 81 32 19 -10 23 2 5 20 -26 26 -70 14 -113 -31z"/>
          <path d="M5683 9087 c105 -299 223 -432 657 -736 214 -151 337 -250 422 -339 159 -169 251 -373 265 -589 15 -230 -62 -437 -264 -712 -133 -181 -176 -268 -192 -386 -12 -83 3 -182 39 -268 30 -72 133 -220 186 -267 26 -23 25 -21 -4 15 -122 149 -171 233 -197 332 -45 171 6 323 181 551 176 228 250 364 285 524 40 178 15 390 -66 565 -50 108 -100 178 -205 287 -108 112 -192 180 -405 326 -219 151 -300 214 -398 309 -121 118 -175 194 -258 365 -39 80 -74 146 -79 146 -5 0 10 -56 33 -123z"/>
          <path d="M5809 8435 c-81 -16 -201 -57 -237 -81 -15 -10 -30 -18 -34 -16 -10 2 -20 -36 -13 -48 7 -12 -3 50 -13 48 -4 -2 -18 5 -32 14 -31 21 -108 46 -205 67 l-74 16 75 89 c102 121 159 207 255 387 90 171 122 220 171 265 39 37 57 44 81 32 19 -10 23 2 5 20 -26 26 -70 14 -113 -31z"/>
          <path d="M5683 9087 c105 -299 223 -432 657 -736 214 -151 337 -250 422 -339 159 -169 251 -373 265 -589 15 -230 -62 -437 -264 -712 -133 -181 -176 -268 -192 -386 -12 -83 3 -182 39 -268 30 -72 133 -220 186 -267 26 -23 25 -21 -4 15 -122 149 -171 233 -197 332 -45 171 6 323 181 551 176 228 250 364 285 524 40 178 15 390 -66 565 -50 108 -100 178 -205 287 -108 112 -192 180 -405 326 -219 151 -300 214 -398 309 -121 118 -175 194 -258 365 -39 80 -74 146 -79 146 -5 0 10 -56 33 -123z"/>
          <path d="M5809 8435 c-81 -16 -201 -57 -237 -81 -15 -10 -30 -18 -34 -16 -10 2 -20 -36 -13 -48 12 -20 59 -9 154 33 230 104 293 108 421 26 l35 -23 -30 32 c-16 18 -56 46 -89 62 -66 33 -102 36 -207 15z"/>
          <path d="M5750 8260 c-24 -4 -6 -8 60 -12 52 -3 106 -9 120 -12 l25 -7 -25 11 c-34 15 -138 26 -180 20z"/>
          <path d="M4715 8253 c-32 -6 -107 -35 -103 -39 2 -2 32 6 67 16 79 25 157 25 221 1 27 -11 48 -15 45 -11 -17 28 -160 48 -230 33z"/>
          <path d="M5664 8234 c-19 -15 -19 -15 1 -6 11 5 27 12 35 15 13 5 13 6 -1 6 -8 1 -24 -6 -35 -15z"/>
          <path d="M4690 8194 c-36 -9 -92 -19 -125 -22 l-60 -7 28 -20 c16 -11 40 -30 55 -41 44 -35 107 -63 154 -69 l43 -6 -52 20 c-29 11 -67 29 -84 42 l-31 22 23 12 c50 26 69 28 69 7 0 -11 9 -30 20 -43 l20 -24 -15 38 c-9 21 -13 42 -10 47 10 17 43 11 50 -9 3 -10 14 -26 25 -36 30 -27 70 -7 70 35 0 31 6 35 34 24 21 -8 20 -43 0 -72 -9 -13 -14 -25 -11 -28 7 -7 47 46 47 62 0 21 12 17 53 -17 48 -40 48 -21 0 21 -79 70 -186 92 -303 64z"/>
          <path d="M5691 8193 c-44 -16 -131 -90 -131 -111 0 -7 18 6 40 28 22 22 43 40 48 40 4 0 15 -18 24 -40 9 -22 21 -40 27 -40 6 0 4 12 -5 28 -20 38 -18 60 7 67 24 8 22 9 35 -30 8 -26 14 -30 44 -30 32 0 35 3 38 33 3 28 7 33 25 30 20 -3 22 -9 20 -53 -1 -46 0 -48 13 -31 8 11 14 31 14 44 0 21 3 23 28 17 15 -3 31 -11 37 -16 13 -13 -38 -54 -100 -78 -37 -15 -44 -20 -25 -20 42 -1 123 43 185 102 l60 57 -33 -5 c-19 -2 -67 3 -109 11 -95 18 -186 17 -242 -3z"/>
          <path d="M6157 7789 c-21 -79 -50 -205 -66 -279 -47 -218 -77 -289 -177 -410 -85 -105 -325 -335 -374 -360 -63 -32 -264 -46 -347 -24 -142 37 -572 317 -655 426 -39 51 -56 88 -135 298 -41 107 -80 201 -87 208 -18 18 113 -368 149 -438 15 -30 42 -75 59 -99 68 -95 317 -279 513 -378 l95 -48 162 0 c177 1 207 7 279 58 75 54 286 248 349 322 64 75 118 164 143 235 9 25 33 130 55 235 22 104 49 232 60 284 33 148 18 129 -23 -30z"/>
          <path d="M5422 7566 c-34 -28 -66 -46 -85 -46 -8 0 -34 13 -58 30 -43 29 -72 36 -103 24 -9 -3 -16 -12 -16 -20 0 -11 9 -13 41 -8 32 5 46 3 69 -15 40 -29 92 -27 138 4 20 14 49 25 65 25 31 0 29 14 -3 23 -13 3 -31 -3 -48 -17z"/>
          <path d="M5150 7324 c-95 -32 -174 -41 -195 -24 -19 16 -32 5 -16 -14 15 -18 117 -36 202 -36 35 0 91 -5 124 -10 45 -7 85 -6 160 5 248 38 295 50 295 82 0 14 -2 14 -20 -2 -26 -24 -99 -23 -179 4 -75 25 -123 27 -154 6 -19 -12 -28 -12 -62 0 -53 19 -67 18 -155 -11z m370 -13 l85 -28 -60 -7 c-33 -4 -92 -11 -132 -18 -54 -8 -103 -8 -202 2 -72 7 -131 16 -131 20 0 10 133 50 165 50 16 0 43 -5 62 -12 27 -10 38 -9 65 4 45 23 52 22 148 -11z"/>
          <path d="M5541 7169 c-59 -53 -130 -73 -232 -66 -83 5 -173 39 -216 79 -13 12 -23 16 -23 10 0 -7 19 -26 43 -42 23 -17 49 -37 58 -44 9 -7 30 -18 49 -24 55 -20 238 -13 225 8 -2 4 13 15 34 25 22 9 56 35 77 56 49 50 41 49 -15 -2z"/>
          <path d="M4507 6975 c8 -168 -38 -341 -127 -470 -18 -26 -102 -119 -189 -208 -144 -150 -215 -229 -236 -267 -10 -17 259 234 343 320 152 156 226 338 226 560 0 63 -5 126 -11 140 -8 19 -10 3 -6 -75z"/>
          <path d="M5662 6687 c-105 -331 -172 -699 -172 -942 0 -60 6 -128 12 -150 11 -36 13 -22 19 140 12 301 84 706 183 1027 8 26 12 50 8 52 -5 3 -27 -55 -50 -127z"/>
          <path d="M4545 6184 c-125 -33 -302 -100 -291 -111 2 -2 59 15 127 38 69 30 146 44 200 47 71 4 82 2 138 -27 133 -67 278 -178 356 -271 50 -59 92 -150 110 -236 28 -140 48 -449 47 -744 -1 -157 -3 -295 -6 -308 -3 -12 -8 -147 -11 -300 l-6 -277 -77 -59 c-183 -141 -361 -286 -407 -332 -27 -27 -71 -66 -99 -86 -27 -21 -65 -52 -85 -71 -20 -18 -44 -38 -53 -43 -10 -5 -58 -50 -108 -98 -58 -57 -91 -84 -94 -75 -3 8 -28 156 -56 329 -90 549 -128 721 -189 853 -26 57 -81 125 -81 100 0 -6 6 -16 14 -22 21 -17 63 -124 85 -216 27 -109 60 -299 121 -684 28 -179 55 -344 59 -368 l8 -43 -158 -160 c-87 -88 -160 -156 -163 -151 -8 12 -65 169 -76 206 -4 17 -41 122 -80 235 -208 591 -249 776 -257 1145 -6 284 10 450 72 760 69 340 127 490 263 671 35 47 63 87 61 89 -5 4 -108 -117 -150 -175 -238 -329 -399 -1005 -359 -1510 28 -366 143 -748 394 -1313 35 -78 66 -153 70 -165 8 -25 -44 -100 -136 -192 -82 -82 -236 -294 -279 -384 -71 -145 -47 -255 66 -307 39 -18 136 -26 169 -13 26 10 18 24 -15 24 -37 0 -30 16 11 25 17 4 30 11 30 16 0 5 -1 9 -2 9 -2 1 -30 3 -63 6 -79 7 -157 29 -186 53 -19 15 -24 29 -24 64 0 36 9 57 49 118 27 41 77 108 110 149 61 76 292 322 307 328 4 2 24 -27 43 -65 43 -84 46 -78 6 10 -16 37 -30 70 -30 74 0 5 10 14 21 22 18 11 23 11 31 -1 7 -9 8 -7 3 8 -5 18 18 44 127 149 143 136 166 154 173 133 6 -20 170 -843 206 -1033 17 -93 40 -191 50 -217 23 -59 282 -558 287 -553 2 1 -5 20 -16 42 -11 21 -47 106 -81 188 -34 83 -89 205 -122 271 -49 98 -63 138 -75 210 -73 455 -75 471 -185 1004 l-30 145 23 18 c23 18 92 76 158 132 19 17 69 57 110 90 41 33 77 63 78 68 2 4 10 7 17 7 7 0 15 4 17 9 2 7 125 100 179 136 9 6 51 33 95 62 43 28 90 61 102 72 13 12 28 21 32 21 5 0 29 13 53 30 25 17 48 30 51 30 3 0 6 -24 6 -52 0 -66 39 -588 46 -607 12 -35 13 6 4 125 -5 71 -12 228 -15 349 l-7 220 47 28 c25 15 50 27 55 27 6 0 10 3 10 8 0 4 17 16 38 27 20 11 39 23 42 26 3 4 21 14 40 23 19 9 49 25 65 35 30 19 152 81 210 106 17 7 75 35 130 63 105 52 358 162 372 161 4 0 -35 -23 -87 -50 -111 -59 -103 -58 40 4 58 25 143 57 190 72 47 15 90 29 96 32 6 2 32 -24 57 -59 25 -35 98 -121 162 -193 175 -194 175 -193 175 -285 0 -180 -52 -318 -230 -614 -70 -116 -146 -247 -170 -291 l-42 -80 71 75 c196 207 329 435 382 657 18 73 20 108 16 204 -3 75 -10 126 -20 146 -9 16 -66 85 -129 154 -112 122 -248 283 -248 291 0 3 19 10 43 17 67 20 164 70 180 94 28 44 28 83 1 123 -33 47 -58 69 -113 95 -56 26 -104 22 -231 -20 -50 -17 -95 -31 -100 -31 -17 0 -91 159 -111 238 -11 43 -19 110 -19 156 -1 142 -18 309 -40 378 -55 179 -200 303 -459 392 -116 40 -146 40 -55 0 205 -91 265 -125 338 -194 80 -77 127 -152 146 -240 7 -30 16 -149 20 -265 6 -171 11 -220 28 -265 26 -75 59 -137 94 -182 l28 -36 -162 -80 c-266 -129 -614 -336 -778 -462 -19 -15 -48 -35 -63 -45 l-29 -18 7 194 c4 107 9 212 11 234 12 131 15 629 5 761 -37 466 -69 573 -214 717 -74 73 -168 140 -290 207 -64 35 -89 43 -140 46 -34 1 -71 1 -82 -2z m-872 -2774 c14 -41 76 -185 137 -319 611 -241 111 -244 92 -263 -19 -19 -20 -18 -75 129 -67 176 -175 476 -188 517 -18 59 9 9 34 -64z"/>
          <path d="M5282 3060 c0 -14 2 -19 5 -12 2 6 2 18 0 25 -3 6 -5 1 -5 -13z"/>
          <path d="M5322 2580 c0 -14 2 -19 5 -12 2 6 2 18 0 25 -3 6 -5 1 -5 -13z"/>
          <path d="M5332 2470 c0 -14 2 -19 5 -12 2 6 2 18 0 25 -3 6 -5 1 -5 -13z"/>
          <path d="M4065 2325 c34 -109 49 -199 48 -300 0 -121 -10 -161 -70 -280 -74 -145 -132 -212 -472 -535 -278 -265 -438 -470 -570 -729 -64 -126 -85 -192 -26 -82 75 140 317 425 460 544 143 94 445 399 506 466 214 233 287 499 205 745 -22 66 -98 227 -81 171z"/>
          <path d="M5350 2278 c-1 -36 57 -172 166 -393 139 -283 166 -354 265 -720 98 -357 171 -607 176 -601 5 8 -219 891 -258 1004 -23 64 -70 176 -105 247 -126 258 -243 480 -244 463z" />
        </g>
      </svg>
    </div>
    <div class="text-center">
      <div class="bg-white/30 backdrop-blur-md p-4 rounded-xl inline-block">
        <p class="text-stone-700 font-semibold text-lg mb-1">Ваше лучшее фото</p>
        <div class="text-sm max-w-xs mx-auto mb-3 text-stone-500 text-left px-2 sm:px-0">
          <p class="font-semibold text-stone-600 mb-2">Чтобы сэкономить кредиты, используйте качественное фото:</p>
          <ul class="list-disc list-inside space-y-1 text-stone-600">
            <li>хорошее освещение, лицо в фокусе;</li>
            <li>без других людей в кадре;</li>
            <li class="font-semibold text-red-500">поясной портрет до бедер, как на рисунке.</li>
          </ul>
        </div>
        <div class="p-2 bg-stone-100/50 border border-stone-300/80 rounded-lg transition-colors duration-200 inline-block">
          <p class="text-stone-700 text-xs font-medium">Нажмите или перетащите файл</p>
          <p class="text-xs text-stone-400 mt-1">PNG, JPG, WEBP</p>
        </div>
      </div>
    </div>
  </div>`;
}

async function fetchCurrentUser() {
    try {
        const response = await fetch('/api/user/me');
        if (!response.ok) {
            updateUser(null);
            return;
        }
        const data = await response.json();
        updateUser(data.user);
    } catch (error) {
        console.error('Failed to fetch user:', error);
        updateUser(null);
    }
}

function setupPromoCodeHandler() {
    const promoInput = document.getElementById('promo-code-input') as HTMLInputElement;
    const promoButton = document.getElementById('apply-promo-button') as HTMLButtonElement;

    if (!promoInput || !promoButton) return;

    promoButton.addEventListener('click', async () => {
        const code = promoInput.value.trim();
        if (!code) {
            showStatusError('Пожалуйста, введите промокод.');
            return;
        }

        const originalButtonText = promoButton.textContent;
        promoButton.disabled = true;
        promoButton.textContent = '...';
        statusEl.innerText = 'Применение промокода...';

        try {
            const response = await fetch('/api/redeem-promo', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ promoCode: code }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Ошибка ${response.status}`);
            }
            
            statusEl.innerText = data.message;
            promoInput.value = '';
            if (currentUser && data.newCreditCount !== undefined) {
                updateUser({ ...currentUser, credits: data.newCreditCount });
            }

        } catch (error) {
            const message = error instanceof Error ? error.message : 'Неизвестная ошибка';
            showStatusError(`Ошибка: ${message}`);
        } finally {
            promoButton.disabled = false;
            promoButton.textContent = originalButtonText;
        }
    });
}

/**
 * Checks for a 'login_error' URL parameter and displays a helpful message
 * to the user, guiding them to fix the Google Console configuration.
 */
function displayLoginError() {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('login_error')) {
        const errorContainer = document.getElementById('login-error-container');
        if (errorContainer) {
            const googleConsoleUrl = "https://console.cloud.google.com/apis/credentials";
            errorContainer.innerHTML = `
                <h3 class="text-lg font-bold text-red-300 mb-2">Ошибка входа через Google</h3>
                <p class="text-red-400 text-sm">
                    После выбора аккаунта Google не смог вернуть вас на сайт. Это почти всегда означает ошибку в настройках.
                </p>
                <p class="text-gray-300 text-sm mt-3">
                    <b>Что делать:</b> Убедитесь, что в настройках <a href="${googleConsoleUrl}" target="_blank" rel="noopener noreferrer" class="font-bold underline hover:text-white">Google Cloud Console</a> в разделе "Authorized redirect URIs" указан правильный адрес обратного вызова, и вы нажали кнопку "Save".
                </p>
            `;
            errorContainer.classList.remove('hidden');
            // Remove the parameter from the URL to avoid showing the message on refresh
            window.history.replaceState({}, document.title, "/");
        }
    }
}


// --- MAIN APP INITIALIZATION ---
document.addEventListener('DOMContentLoaded', async () => {
  // --- Register Service Worker for PWA functionality ---
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then(registration => {
        console.log('ServiceWorker registration successful with scope: ', registration.scope);
      }, err => {
        console.log('ServiceWorker registration failed: ', err);
      });
    });
  }

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
  userAreaEl = document.querySelector('#user-area')!;

  try {
    
    // Check for login errors right at the start
    displayLoginError();
    await fetchCurrentUser(); // Fetch user status on load

    const response = await fetch('/prompts.json');
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    prompts = await response.json();
    
    // --- Initial UI Setup & Event Listeners ---
    const placeholderHtml = getUploaderPlaceholderHtml();
    document.getElementById('page1-upload-placeholder')!.innerHTML = placeholderHtml;
    uploadPlaceholder.innerHTML = '<p class="text-gray-400">Нажмите, чтобы загрузить референс</p><p class="text-xs text-gray-500 mt-1">PNG, JPG, WEBP</p>';


    setupNavigation();
    initializePage1Wizard();
    setupPromoCodeHandler();
    
    selectPlan(selectedPlan);
    initializePoseSequences();

    // --- Attach all event listeners now that elements are guaranteed to exist ---
    lightboxOverlay.addEventListener('click', (e) => {
        if (e.target === lightboxOverlay) hideLightbox();
    });
    lightboxCloseButton.addEventListener('click', hideLightbox);

    generateButton.addEventListener('click', generate);
    resetButton.addEventListener('click', resetApp);
    
    referenceDownloadButton.addEventListener('click', e => e.stopPropagation());
    
    planButtonsContainer.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-plan]');
      if (button?.dataset.plan) selectPlan(button.dataset.plan);
    });

    const handlePage2Upload = (file: File) => {
      if (!file || !file.type.startsWith('image/')) { showStatusError('Пожалуйста, выберите файл изображения.'); return; }
      const reader = new FileReader();
      reader.onload = async (e) => {
        const dataUrl = e.target?.result as string;
        if (dataUrl) {
          const [header, base64] = dataUrl.split(',');
          const mimeType = header.match(/:(.*?);/)?.[1] || 'image/png';
          const originalImageState = { base64, mimeType };
          
          const overlay = document.createElement('div');
          overlay.className = 'analysis-overlay';
          overlay.innerHTML = `<div class="loading-spinner"></div><p class="mt-2 text-sm text-center">Оптимизация изображения...</p>`;
          uploadContainer.appendChild(overlay);
          setControlsDisabled(true);
          setWizardStep('NONE');

          try {
            const imageState = await resizeImage(originalImageState);
            const resizedDataUrl = `data:${imageState.mimeType};base64,${imageState.base64}`;

            referenceImage = imageState;
            referenceImagePreview.src = resizedDataUrl;
            referenceImagePreview.classList.remove('hidden');
            referenceDownloadButton.href = resizedDataUrl;
            referenceDownloadButton.download = `reference-${Date.now()}.png`;
            referenceDownloadButton.classList.remove('hidden');
            uploadPlaceholder.classList.add('hidden');
            uploadContainer.classList.remove('aspect-square');
            outputGallery.innerHTML = '';
            
            const overlayText = overlay.querySelector('p');
            if (overlayText) overlayText.textContent = 'Анализ фото...';

            statusEl.innerText = 'Анализ фото, чтобы подобрать лучшие позы...';
            
            const { category, smile } = await checkImageSubject(imageState);
            detectedSubjectCategory = category;
            detectedSmileType = smile;
            initializePoseSequences();
            if (category === 'other') { showStatusError('На фото не обнаружен человек. Попробуйте другое изображение.'); resetApp(); return; }
            const subjectMap = { woman: 'женщина', man: 'мужчина', teenager: 'подросток', elderly_woman: 'пожилая женщина', elderly_man: 'пожилой мужчина', child: 'ребенок' };
            statusEl.innerText = `Изображение загружено. Обнаружен: ${subjectMap[category] || 'человек'}. Готово к генерации.`;
            setWizardStep('PAGE2_PLAN');

          } catch (e) { 
            showStatusError(e instanceof Error ? e.message : 'Неизвестная ошибка анализа или оптимизации.'); 
            resetApp();
          }
          finally { 
              overlay.remove();
              setControlsDisabled(false); 
          }
        }
      };
      reader.readAsDataURL(file);
    };
    
    imageUpload.addEventListener('change', (event) => { if ((event.target as HTMLInputElement).files?.[0]) handlePage2Upload((event.target as HTMLInputElement).files[0]); });
    
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
        if (eventName === 'drop' && (e as DragEvent).dataTransfer?.files?.[0]) {
            imageUpload.files = (e as DragEvent).dataTransfer.files;
            imageUpload.dispatchEvent(new Event('change'));
        }
    }));

    (window as any).navigateToPage('page1');
    updateAllGenerateButtons();
    updatePage1WizardState();

  } catch (error) {
    console.error("Fatal Error: Could not load prompts configuration.", error);
    document.body.innerHTML = `<div class="w-screen h-screen flex items-center justify-center bg-gray-900 text-white"><div class="text-center p-8 bg-gray-800 rounded-lg shadow-lg"><h1 class="text-2xl font-bold text-red-500 mb-4">Ошибка загрузки приложения</h1><p>Не удалось загрузить необходимые данные (prompts.json).</p><p>Пожалуйста, проверьте консоль и перезагрузите страницу.</p></div></div>`;
  }
});
