/// <reference types="vite/client" />

// Fix for TypeScript errors related to Vite's environment variables.
// This manually defines the types for `import.meta.env` when `vite/client` types are not automatically resolved.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

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

// --- API Request Function ---
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

async function apiRequest(action: string, payload: object): Promise<any> {
    if (!API_BASE_URL) {
      throw new Error("VITE_API_BASE_URL is not defined. Please set it in your Vercel environment variables.");
    }
    const fullUrl = `${API_BASE_URL.replace(/\/$/, '')}/${action}`;
    
    const response = await fetch(fullUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    });
    
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || `Ошибка сервера: ${response.statusText}`);
    }
    return data;
}


// --- DOM Element Variables (will be assigned on DOMContentLoaded) ---
let lightboxOverlay: HTMLDivElement, lightboxImage: HTMLImageElement, statusEl: HTMLDivElement,
    planButtonsContainer: HTMLDivElement, generateButton: HTMLButtonElement, resetButton: HTMLButtonElement,
    outputGallery: HTMLDivElement, uploadContainer: HTMLDivElement, imageUpload: HTMLInputElement,
    referenceImagePreview: HTMLImageElement, uploadPlaceholder: HTMLDivElement, customPromptInput: HTMLInputElement,
    referenceDownloadButton: HTMLAnchorElement, paymentModalOverlay: HTMLDivElement, paymentConfirmButton: HTMLButtonElement,
    paymentCloseButton: HTMLButtonElement, creditCounterEl: HTMLDivElement, promoCodeInput: HTMLInputElement,
    applyPromoButton: HTMLButtonElement;


// --- State Variables ---
let selectedPlan = 'close_up';
let referenceImage: ImageState | null = null;
let detectedSubjectCategory: SubjectCategory | null = null;
let detectedSmileType: SmileType | null = null;
let malePoseIndex = 0;
let femalePoseIndex = 0;
let femaleGlamourPoseIndex = 0;
let prompts: Prompts | null = null;
let generationCredits = 1;
let hasPaid = false;
const PROMO_CODES: { [key: string]: { type: string; value: number; message: string } } = {
    "GEMINI_10": { type: 'credits', value: 10, message: "Вам начислено 10 кредитов!" },
    "FREE_SHOOT": { type: 'credits', value: 999, message: "Вы получили бесплатный доступ на эту сессию!" },
    "BONUS_5": { type: 'credits', value: 5, message: "Бонус! 5 кредитов добавлено." }
};

let poseSequences: {
    female: string[]; femaleGlamour: string[]; male: string[]; femaleCloseUp: string[]; maleCloseUp: string[];
    elderlyFemale: string[]; elderlyFemaleCloseUp: string[]; elderlyMale: string[]; elderlyMaleCloseUp: string[];
} = {
    female: [], femaleGlamour: [], male: [], femaleCloseUp: [], maleCloseUp: [],
    elderlyFemale: [], elderlyFemaleCloseUp: [], elderlyMale: [], elderlyMaleCloseUp: [],
};

// --- Core Functions (defined globally, but depend on state) ---
function openLightbox(imageUrl: string) {
    if (lightboxImage && lightboxOverlay) {
        lightboxImage.src = imageUrl;
        lightboxOverlay.classList.remove('opacity-0', 'pointer-events-none');
    }
}

async function generateVariation(prompt: string, image: ImageState): Promise<string> {
   try {
        const data = await apiRequest('generateVariation', { prompt, image });
        if (!data.imageUrl) {
            throw new Error('Бэкенд не вернул изображение.');
        }
        return data.imageUrl;
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

function updateCreditCounterUI() {
    if (creditCounterEl) {
        creditCounterEl.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-yellow-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M8.433 7.418c.158-.103.346-.196.567-.267v1.698a2.5 2.5 0 00-.567-.267C8.07 8.488 8 8.731 8 9c0 .269.07.512.433.582.221.07.41.164.567.267v1.698c-.22.071-.409.164-.567-.267C8.07 11.512 8 11.731 8 12c0 .269.07.512.433.582.221.07.41.164.567.267v1.698c-1.135-.285-2-1.201-2-2.423 0-1.22.865-2.138 2-2.423v-1.698c.221.07.41.164.567.267C11.93 8.488 12 8.731 12 9c0 .269-.07-.512-.433-.582-.221-.07-.41-.164-.567-.267V7.862c1.135.285 2 1.201 2 2.423 0 1.22-.865-2.138-2 2.423v1.698a2.5 2.5 0 00.567-.267c.364-.24.433-.482.433-.582 0-.269-.07-.512-.433-.582-.221-.07-.41-.164-.567-.267V12.14c1.135-.285 2-1.201 2-2.423s-.865-2.138-2-2.423V5.577c1.135.285 2 1.201 2 2.423 0 .269.07.512.433.582.221.07.409.164.567.267V7.862a2.5 2.5 0 00-.567-.267C11.93 7.512 12 7.269 12 7c0-1.22-.865-2.138-2-2.423V3a1 1 0 00-2 0v1.577C6.865 4.862 6 5.78 6 7c0 .269.07.512.433.582.221.07.41.164.567.267V6.14a2.5 2.5 0 00-.567-.267C5.07 5.512 5 5.269 5 5c0-1.22.865-2.138 2-2.423V1a1 1 0 10-2 0v1.577c-1.135-.285-2 1.201-2 2.423s.865 2.138 2 2.423v1.698c-.221-.07-.41-.164-.567-.267C4.07 8.488 4 8.731 4 9s.07.512.433.582c.221.07.41.164.567.267v1.698a2.5 2.5 0 00.567.267C4.07 11.512 4 11.731 4 12s.07.512.433.582c.221.07.41.164.567.267v1.698c-.221-.07-.409-.164-.567-.267C4.07 13.512 4 13.731 4 14c0 1.22.865 2.138 2 2.423v1.577a1 1 0 102 0v-1.577c1.135-.285 2-1.201 2-2.423s-.865-2.138-2-2.423v-1.698c.221.07.41.164.567.267.364.24.433.482.433.582s-.07.512-.433.582c-.221-.07-.41-.164-.567-.267v1.698a2.5 2.5 0 00.567.267c.364.24.433.482.433.582s-.07.512-.433.582c-.221-.07-.41-.164-.567-.267V13.86c-1.135-.285-2-1.201-2-2.423s.865-2.138 2-2.423V7.862c-.221-.07-.41-.164-.567-.267C8.07 7.512 8 7.269 8 7c0-.269.07.512.433-.582z" /></svg>
            <span class="text-white">${generationCredits}</span>
            <span class="hidden sm:inline text-gray-400">кредитов</span>
        `;
    }
}

function selectPlan(plan: string) {
  selectedPlan = plan;
  const buttons = planButtonsContainer.querySelectorAll<HTMLButtonElement>('.plan-button');
  buttons.forEach((btn) => btn.classList.remove('selected'));
  const buttonToSelect = planButtonsContainer.querySelector(`button[data-plan="${plan}"]`) as HTMLButtonElement;
  if (buttonToSelect) buttonToSelect.classList.add('selected');
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
  updateGenerateButtonCredits();
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
    updateGenerateButtonCredits();
  }
}

function displayErrorInContainer(container: HTMLElement, message: string, clearContainer = true) {
  if (clearContainer) container.innerHTML = '';
  const errorContainer = document.createElement('div');
  errorContainer.className = 'bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center flex flex-col items-center justify-center w-full';
  if (container.id === 'output-gallery') errorContainer.classList.add('col-span-2');
  errorContainer.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 text-red-400 mb-4" viewBox="0 0 20 20" fill="currentColor">
      <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
    </svg>
    <p class="text-red-300 text-lg">${message}</p>
    <p class="text-gray-400 text-sm mt-4">Попробуйте выполнить действие еще раз. Если ошибка повторяется, попробуйте изменить запрос или обновить страницу.</p>
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
    const data = await apiRequest('checkImageSubject', { image });
    const result: { category: string; smile: string } = data.subjectDetails;

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

function updateGenerateButtonCredits() {
  if (!generateButton) return;
  if (hasPaid) {
    generateButton.innerHTML = `Создать 4 фотографии (Осталось: ${generationCredits})`;
    generateButton.disabled = generationCredits < 4;
  } else {
    generateButton.innerHTML = 'Создать 4 фотографии';
    generateButton.disabled = false; // Always enabled to trigger modal
  }
  updateCreditCounterUI();
}

async function generate() {
  if (!referenceImage || !detectedSubjectCategory || !prompts) {
    showStatusError('Пожалуйста, загрузите изображение-референс человека.');
    return;
  }
  
  if (generationCredits < 4) {
      const modalTitle = document.querySelector('#payment-modal-title');
      const modalDescription = document.querySelector('#payment-modal-description');
      if (hasPaid) {
         if (modalTitle) modalTitle.textContent = "Недостаточно кредитов!";
         if (modalDescription) modalDescription.innerHTML = `У вас осталось ${generationCredits} кредитов. Для создания 4 вариаций требуется 4. Чтобы получить <strong>12 дополнительных генераций</strong> за 199 ₽, пожалуйста, произведите оплату.`;
      } else {
         if (modalTitle) modalTitle.textContent = "Разблокируйте больше генераций!";
         if (modalDescription) modalDescription.innerHTML = `Чтобы получить <strong>12 дополнительных генераций</strong> в разделе "4 Вариации" за 199 ₽, пожалуйста, произведите оплату.`;
      }
      showPaymentModal();
      return;
  }

  const progressContainer = document.querySelector('#progress-container') as HTMLDivElement;
  const progressBar = document.querySelector('#progress-bar') as HTMLDivElement;
  const progressText = document.querySelector('#progress-text') as HTMLDivElement;

  statusEl.innerText = 'Генерация вариаций...';
  setControlsDisabled(true);

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
    generationCredits -= 4;
    updateCreditCounterUI();

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

    const shuffledAngles = [...angles].sort(() => 0.5 - Math.random());
    const shuffledDrasticShifts = [...prompts.drasticCameraShiftPrompts].sort(() => 0.5 - Math.random());

    const generationPrompts: string[] = [];
    for (let i = 0; i < 4; i++) {
      const allChanges: string[] = [];
      const planInstruction = getPlanInstruction(selectedPlan);
      if (planInstruction) allChanges.push(planInstruction);

      if (i === 3) allChanges.push(shuffledDrasticShifts[0] ?? shuffledAngles[i] ?? '');
      else allChanges.push(shuffledAngles[i]);

      const customText = customPromptInput.value.trim();
      if (customText) {
        allChanges.push(`дополнительная деталь: ${customText}`);
      } else {
        let currentPose: string;
        if (detectedSubjectCategory === 'woman' && glamourPoses.length > 0 && i < 2) {
            currentPose = glamourPoses[femaleGlamourPoseIndex++ % glamourPoses.length];
        } else if (detectedSubjectCategory === 'man' || detectedSubjectCategory === 'elderly_man') {
            currentPose = poses[malePoseIndex++ % poses.length];
        } else {
            currentPose = poses[femalePoseIndex++ % poses.length];
        }
        allChanges.push(currentPose);
      }
      
      const changesDescription = allChanges.filter(Boolean).join(', ');
      const finalPrompt = `Это референсное фото. Твоя задача — сгенерировать новое фотореалистичное изображение, следуя строгим правилам.\n\nКРИТИЧЕСКИ ВАЖНЫЕ ПРАВИЛА:\n1.  **АБСОЛЮТНАЯ УЗНАВАЕМОСТЬ:** Внешность, уникальные черты лица (форма носа, глаз, губ), цвет кожи, прическа и выражение лица человека должны остаться АБСОЛЮТНО ИДЕНТИЧНЫМИ оригиналу. Это самое важное правило. Не изменяй человека.\n2.  **КОНТЕКСТ ИЗ ОРИГИНАЛА:** Одежда и фон на новом изображении должны быть взяты с референсного фото. Не дорисовывай и не придумывай недостающие части.\n3.  **НОВАЯ КОМПОЗИЦИЯ:** При