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
type WizardStep = 'PAGE1_PHOTO' | 'PAGE1_CLOTHING' | 'PAGE1_LOCATION' | 'PAGE1_GENERATE' | 'PAGE2_PLAN' | 'PAGE2_GENERATE' | 'CREDITS' | 'AUTH' | 'NONE';

// --- DOM Element Variables (will be assigned on DOMContentLoaded) ---
let lightboxOverlay: HTMLDivElement, lightboxImage: HTMLImageElement, lightboxCloseButton: HTMLButtonElement, statusEl: HTMLDivElement,
    planButtonsContainer: HTMLDivElement, generateButton: HTMLButtonElement, resetButton: HTMLButtonElement,
    outputGallery: HTMLDivElement, uploadContainer: HTMLDivElement, imageUpload: HTMLInputElement,
    referenceImagePreview: HTMLImageElement, uploadPlaceholder: HTMLDivElement, customPromptInput: HTMLInputElement,
    referenceDownloadButton: HTMLAnchorElement, paymentModalOverlay: HTMLDivElement, paymentConfirmButton: HTMLButtonElement,
    paymentCloseButton: HTMLButtonElement, creditCounterEl: HTMLDivElement, promoCodeInput: HTMLInputElement,
    applyPromoButton: HTMLButtonElement, authContainer: HTMLDivElement, googleSignInContainer: HTMLDivElement,
    userProfileContainer: HTMLDivElement, userProfileImage: HTMLImageElement, userProfileName: HTMLSpanElement;

// --- State Variables ---
let selectedPlan = 'close_up';
let referenceImage: ImageState | null = null;
let faceReferenceImage: ImageState | null = null;
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
        credits: document.getElementById('credit-counter'),
        auth: document.getElementById('auth-container'),
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
        case 'AUTH': targets.auth?.classList.add('highlight-step'); break;
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
                originalWidth, newHeight,   // Source width, height
                0, 0,                       // Destination x, y
                originalWidth, newHeight);  // Destination width, height

            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const [, base64] = dataUrl.split(',');
            resolve({ base64, mimeType: 'image/jpeg' });
        };
        img.onerror = () => reject(new Error('Не удалось загрузить изображение для обрезки.'));
        img.src = `data:${imageState.mimeType};base64,${imageState.base64}`;
    });
}

/**
 * Crops an image based on a normalized bounding box and resizes it to a target square dimension.
 * Used for creating a high-detail face reference.
 * @param imageState The original image.
 * @param box The normalized bounding box coordinates.
 * @returns A promise that resolves with the cropped and resized image state.
 */
async function cropImageWithBoundingBox(imageState: ImageState, box: { x_min: number, y_min: number, x_max: number, y_max: number }): Promise<ImageState> {
    const FACE_TARGET_DIMENSION = 1024;
    const PADDING_PERCENT = 0.35; // 35% padding around the narrowest dimension

    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const { width: originalWidth, height: originalHeight } = img;

            // Denormalize coordinates
            const boxWidth = (box.x_max - box.x_min) * originalWidth;
            const boxHeight = (box.y_max - box.y_min) * originalHeight;
            const x = box.x_min * originalWidth;
            const y = box.y_min * originalHeight;

            // Add padding based on the smaller dimension to ensure we get a good crop
            const padding = Math.min(boxWidth, boxHeight) * PADDING_PERCENT;
            const sx = Math.max(0, x - padding);
            const sy = Math.max(0, y - padding);
            const sWidth = Math.min(originalWidth - sx, boxWidth + padding * 2);
            const sHeight = Math.min(originalHeight - sy, boxHeight + padding * 2);


            const canvas = document.createElement('canvas');
            canvas.width = FACE_TARGET_DIMENSION;
            canvas.height = FACE_TARGET_DIMENSION;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return reject(new Error('Не удалось получить 2D контекст холста для обрезки лица.'));
            }
            
            ctx.fillStyle = '#cccccc'; // A neutral gray background
            ctx.fillRect(0, 0, FACE_TARGET_DIMENSION, FACE_TARGET_DIMENSION);

            // Draw the cropped part of the image onto the square canvas, this will stretch it to fit.
            ctx.drawImage(img, sx, sy, sWidth, sHeight, 0, 0, FACE_TARGET_DIMENSION, FACE_TARGET_DIMENSION);
            
            const dataUrl = canvas.toDataURL('image/jpeg', 0.95); // High quality for face reference
            const [, base64] = dataUrl.split(',');
            resolve({ base64, mimeType: 'image/jpeg' });
        };
        img.onerror = (err) => {
            console.error("Ошибка при загрузке изображения для обрезки:", err);
            reject(new Error('Не удалось загрузить изображение для обрезки.'));
        };
        img.src = `data:${imageState.mimeType};base64,${imageState.base64}`;
    });
}

/**
 * Analyzes an image to find a person, crops their face, and stores it as a face reference.
 * @param sourceImage The image to analyze.
 * @param previewElement The image element where the overlay should be shown.
 */
async function createFaceReference(sourceImage: ImageState, previewElement: HTMLImageElement) {
    const parent = previewElement.parentElement;
    if (!parent || !isLoggedIn) return; // Don't run analysis if not logged in

    const overlay = document.createElement('div');
    overlay.className = 'analysis-overlay';
    overlay.innerHTML = `
        <div class="flex flex-col items-center gap-2">
            <div class="loading-spinner"></div>
            <p class="text-sm font-semibold">Анализ лица...</p>
        </div>`;
    parent.appendChild(overlay);

    try {
        const response = await fetch('/api/detectPersonBoundingBox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({ image: sourceImage })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка при определении лица.');
        }

        const { boundingBox } = await response.json();
        if (boundingBox) {
            const croppedFace = await cropImageWithBoundingBox(sourceImage, boundingBox);
            faceReferenceImage = croppedFace;
            console.log("Создан референс лица.");
        } else {
            throw new Error("API не вернул координаты рамки.");
        }
    } catch (error) {
        console.error("Не удалось создать референс лица:", error);
        faceReferenceImage = null; // Ensure it's cleared on error
    } finally {
        if (parent.contains(overlay)) {
            parent.removeChild(overlay);
        }
    }
}


/**
 * Sets the status message and handles different message types.
 * @param text The message to display.
 * @param type The type of message ('error', 'success', 'loading', 'info').
 * @param duration The duration in ms to show the message. 0 for indefinite.
 */
function setStatus(text: string, type: 'error' | 'success' | 'loading' | 'info' = 'info', duration: number = 0) {
    if (!statusEl) return;
    statusEl.textContent = text;
    statusEl.className = 'text-center min-h-[24px] mt-2'; // Reset classes

    switch (type) {
        case 'error':
            statusEl.classList.add('text-red-400');
            break;
        case 'success':
            statusEl.classList.add('text-green-400');
            break;
        case 'loading':
            statusEl.classList.add('text-blue-400');
            break;
        case 'info':
        default:
             statusEl.classList.add('text-gray-400');
            break;
    }

    if (duration > 0) {
        setTimeout(() => {
            if (statusEl.textContent === text) {
                statusEl.textContent = '';
                statusEl.className = 'text-center min-h-[24px] mt-2';
            }
        }, duration);
    }
}

/**
 * Handles the generation of 4 image variations.
 */
async function generateVariations() {
    if (!referenceImage) {
        setStatus('Пожалуйста, загрузите референсное изображение.', 'error', 3000);
        setWizardStep('PAGE2_PLAN'); // Guide user back to upload
        return;
    }
    if (!isLoggedIn) {
        setStatus('Пожалуйста, войдите, чтобы начать генерацию.', 'error', 4000);
        setWizardStep('AUTH');
        return;
    }
    if (generationCredits < 4) {
        setStatus(`Недостаточно кредитов. Требуется 4, у вас ${generationCredits}.`, 'error', 4000);
        showPaymentModal();
        return;
    }

    generateButton.disabled = true;
    resetButton.disabled = true;
    outputGallery.innerHTML = ''; // Clear previous results
    
    // Create placeholder shimmer elements
    for (let i = 0; i < 4; i++) {
        const placeholder = document.createElement('div');
        placeholder.className = 'aspect-square bg-gray-700/50 rounded-lg placeholder-shimmer';
        outputGallery.appendChild(placeholder);
    }
    
    const progressContainer = document.getElementById('progress-container')!;
    const progressBar = document.getElementById('progress-bar')!;
    const progressText = document.getElementById('progress-text')!;

    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressText.textContent = 'Подготовка... 0%';

    let completedCount = 0;
    const totalCount = 4;
    const updateProgress = () => {
        completedCount++;
        const percentage = Math.round((completedCount / totalCount) * 100);
        progressBar.style.width = `${percentage}%`;
        progressText.textContent = `Генерация... ${percentage}%`;
        if (completedCount === totalCount) {
             setTimeout(() => progressContainer.classList.add('hidden'), 1000);
        }
    };
    
    setStatus('');

    const basePrompt = customPromptInput.value.trim();
    const planText = planButtonsContainer.querySelector('.selected')?.textContent || 'Крупный план';
    const promptsToGenerate: string[] = [];

    // Generate 4 unique prompts
    for (let i = 0; i < 4; i++) {
        let posePrompts: string[] = [];
        let anglePrompts: string[] = [];

        switch (detectedSubjectCategory) {
            case 'man':
            case 'teenager': // Assuming teenager males use male prompts
                 posePrompts = selectedPlan === 'close_up' ? (poseSequences.maleCloseUp.length > 0 ? poseSequences.maleCloseUp : prompts!.maleCloseUpPosePrompts) : (poseSequences.male.length > 0 ? poseSequences.male : prompts!.malePosePrompts);
                 anglePrompts = prompts!.maleCameraAnglePrompts;
                 break;
            case 'elderly_man':
                 posePrompts = selectedPlan === 'close_up' ? (poseSequences.elderlyMaleCloseUp.length > 0 ? poseSequences.elderlyMaleCloseUp : prompts!.elderlyMaleCloseUpPosePrompts) : (poseSequences.elderlyMale.length > 0 ? poseSequences.elderlyMale : prompts!.elderlyMalePosePrompts);
                 anglePrompts = prompts!.maleCameraAnglePrompts; // Can reuse
                 break;
            case 'elderly_woman':
                 posePrompts = selectedPlan === 'close_up' ? (poseSequences.elderlyFemaleCloseUp.length > 0 ? poseSequences.elderlyFemaleCloseUp : prompts!.elderlyFemaleCloseUpPosePrompts) : (poseSequences.elderlyFemale.length > 0 ? poseSequences.elderlyFemale : prompts!.elderlyFemalePosePrompts);
                 anglePrompts = prompts!.femaleCameraAnglePrompts; // Can reuse
                 break;
            case 'woman':
            default: // Default to female prompts
                if (detectedSmileType === 'teeth' || detectedSmileType === 'closed') { // Glamour for smiling subjects
                     posePrompts = selectedPlan === 'close_up' ? (poseSequences.femaleCloseUp.length > 0 ? poseSequences.femaleCloseUp : prompts!.femaleCloseUpPosePrompts) : (poseSequences.femaleGlamour.length > 0 ? poseSequences.femaleGlamour : prompts!.femaleGlamourPosePrompts);
                } else {
                     posePrompts = selectedPlan === 'close_up' ? (poseSequences.femaleCloseUp.length > 0 ? poseSequences.femaleCloseUp : prompts!.femaleCloseUpPosePrompts) : (poseSequences.female.length > 0 ? poseSequences.female : prompts!.femalePosePrompts);
                }
                anglePrompts = prompts!.femaleCameraAnglePrompts;
                break;
        }

        const posePrompt = posePrompts[i % posePrompts.length];
        const anglePrompt = anglePrompts[Math.floor(Math.random() * anglePrompts.length)];

        let variationPrompt: string;

        if (faceReferenceImage) {
            variationPrompt = `Критически важно: возьми уникальные черты лица (форма носа, глаз, губ), цвет кожи и выражение лица АБСОЛЮТНО ТОЧНО с ПЕРВОГО фото (лицевой референс). Сгенерированный человек должен быть на 100% узнаваем и похож на оригинал, а не быть другим человеком. Со ВТОРОГО фото (основной референс) возьми одежду, прическу, стиль и атмосферу фона. план: ${planText}. ${posePrompt}. ${anglePrompt}. ${basePrompt}. Стиль: кинематографичная фотография, гиперреализм, высочайшая детализация, профессиональное освещение. Не добавляй текст, логотипы или водяные знаки.`;
        } else {
            variationPrompt = `сохрани черты лица, одежду, прическу и фон с референсного фото. план: ${planText}. ${posePrompt}. ${anglePrompt}. ${basePrompt}. Стиль: кинематографичная фотография, гиперреализм, высочайшая детализация, профессиональное освещение. Не добавляй текст, логотипы или водяные знаки.`;
        }

        promptsToGenerate.push(variationPrompt.trim().replace(/\s+/g, ' '));
    }
    
    // Deduct credits before starting the generation
    updateCreditCounter(-4);

    const generationPromises = promptsToGenerate.map(async (finalPrompt, index) => {
        try {
            const body = {
                prompt: finalPrompt,
                mainImage: referenceImage,
                faceImage: faceReferenceImage // This will be null if it doesn't exist, which is fine
            };
            const response = await fetch('/api/generateVariation', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${idToken}`
                },
                body: JSON.stringify(body)
            });

            if (!response.ok) {
                const errorData = await response.json();
                // Refund the credit for this specific failed generation
                updateCreditCounter(1); 
                throw new Error(errorData.error || 'Ошибка сети');
            }
            const data = await response.json();
            return { imageUrl: data.imageUrl, index };
        } catch (error) {
            console.error(`Ошибка генерации для промпта ${index}:`, error);
            return { error: (error as Error).message, index };
        } finally {
            updateProgress();
        }
    });

    const results = await Promise.all(generationPromises);

    // Replace placeholders with actual results or error messages
    outputGallery.innerHTML = ''; // Clear placeholders before adding results
    const sortedResults = results.sort((a, b) => a.index - b.index);

    sortedResults.forEach(result => {
        const resultContainer = document.createElement('div');
        resultContainer.className = 'gallery-item aspect-square rounded-lg overflow-hidden relative cursor-pointer group transition-transform duration-300 hover:scale-105';
        
        if (result.imageUrl) {
            const img = document.createElement('img');
            img.src = result.imageUrl;
            img.alt = `Сгенерированная вариация ${result.index + 1}`;
            img.className = 'w-full h-full object-cover';
            img.loading = 'lazy';
            resultContainer.appendChild(img);

            const overlay = document.createElement('div');
            overlay.className = 'absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300';
            overlay.innerHTML = `<p class="text-white text-sm font-semibold text-center p-2">Сделать референсом</p>`;
            resultContainer.appendChild(overlay);

            resultContainer.addEventListener('click', () => handleNewReference(result.imageUrl));
            
        } else {
            resultContainer.classList.add('bg-red-900/50', 'flex', 'items-center', 'justify-center', 'p-4', 'text-center');
            const errorText = document.createElement('p');
            errorText.className = 'text-white text-sm';
            errorText.textContent = `Ошибка: ${result.error || 'Неизвестная ошибка'}`;
            resultContainer.appendChild(errorText);
        }
        outputGallery.appendChild(resultContainer);
    });

    generateButton.disabled = false;
    resetButton.disabled = false;
}

/**
 * Handles setting a newly generated image as the reference.
 * @param imageUrl The data URL of the new reference image.
 */
async function handleNewReference(imageUrl: string) {
    if (!imageUrl.startsWith('data:image')) return;

    // Remove existing reference indicator
    document.querySelectorAll('.gallery-item.is-reference').forEach(el => el.classList.remove('is-reference'));

    // Find the clicked image and mark it as the new reference
    const allImages = Array.from(outputGallery.querySelectorAll('img'));
    const clickedImgElement = allImages.find(img => img.src === imageUrl);
    if (clickedImgElement && clickedImgElement.parentElement) {
        clickedImgElement.parentElement.classList.add('is-reference');
    }

    const [header, base64] = imageUrl.split(',');
    const mimeType = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
    
    const newReference: ImageState = { base64, mimeType };
    
    // Resize the new reference and update the main preview
    const resizedImage = await resizeImage(newReference);
    referenceImage = resizedImage;
    referenceImagePreview.src = `data:${resizedImage.mimeType};base64,${resizedImage.base64}`;
    referenceDownloadButton.href = `data:${resizedImage.mimeType};base64,${resizedImage.base64}`;
    referenceDownloadButton.download = `reference_${Date.now()}.jpg`;

    // CRITICAL: Create a NEW face reference from this new image
    // This allows for iterative improvements if the user likes a face from a generation.
    createFaceReference(resizedImage, referenceImagePreview).catch(err => {
        console.error("Фоновая задача создания референса лица провалена:", err);
    });

    setStatus('Новый референс установлен. Готовы к следующей генерации!', 'success', 4000);
}


/**
 * Handles the file upload process for the main variation generator.
 * @param file The file to be uploaded.
 */
async function handleImageUpload(file: File) {
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = (e.target?.result as string).split(',')[1];
        if (!base64) {
            setStatus('Не удалось прочитать файл изображения.', 'error', 3000);
            return;
        }

        const initialImageState: ImageState = { base64, mimeType: file.type };
        setStatus('Изображение загружается и обрабатывается...', 'loading');
        uploadPlaceholder.classList.add('hidden');
        referenceImagePreview.classList.add('hidden');

        try {
            // Resize first to work with a smaller image
            const resizedImage = await resizeImage(initialImageState);
            referenceImage = resizedImage;

            referenceImagePreview.src = `data:${resizedImage.mimeType};base64,${resizedImage.base64}`;
            referenceImagePreview.classList.remove('hidden');
            uploadContainer.classList.remove('uploader-box');
            referenceDownloadButton.href = `data:${resizedImage.mimeType};base64,${resizedImage.base64}`;
            referenceDownloadButton.download = `reference_${Date.now()}.jpg`;
            referenceDownloadButton.classList.remove('hidden');

            // Then check the subject to tailor prompts
            await checkImageSubject(resizedImage);
            
            // AND create the face reference in the background
            createFaceReference(resizedImage, referenceImagePreview).catch(err => {
                console.error("Фоновая задача создания референса лица провалена:", err);
            });

            setStatus('Изображение готово. Выберите план и начинайте!', 'success', 3000);
            if(isLoggedIn && generationCredits > 0) {
                 setWizardStep('PAGE2_PLAN');
            } else if (!isLoggedIn) {
                 setWizardStep('AUTH');
            } else {
                 setWizardStep('CREDITS');
            }
           

        } catch (error) {
            setStatus(`Ошибка обработки изображения: ${(error as Error).message}`, 'error', 5000);
            resetState(false); // Reset without clearing gallery
        }
    };
    reader.readAsDataURL(file);
}

/**
 * Sends an image to the backend to determine the subject's category and smile type.
 * @param imageState The image to analyze.
 */
async function checkImageSubject(imageState: ImageState) {
    if (!isLoggedIn) {
        detectedSubjectCategory = 'woman'; // Default for non-logged-in users
        detectedSmileType = 'none';
        return;
    }
    try {
        const response = await fetch('/api/checkImageSubject', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            },
            body: JSON.stringify({ image: imageState }),
        });

        if (!response.ok) {
            console.error('Ошибка ответа сервера при проверке объекта.');
            detectedSubjectCategory = 'woman'; // Fallback
            detectedSmileType = 'none';
            return;
        }

        const data = await response.json();
        const { category, smile } = data.subjectDetails as SubjectDetails;
        
        detectedSubjectCategory = category;
        detectedSmileType = smile;
        
        console.log(`Обнаружен объект: ${category}, Улыбка: ${smile}`);
        shufflePoseSequences(); // Shuffle poses based on the new category

    } catch (error) {
        console.error('Ошибка при отправке изображения для анализа:', error);
        detectedSubjectCategory = 'woman'; // Fallback on error
        detectedSmileType = 'none';
    }
}


/**
 * Resets the entire application state.
 * @param fullReset If true, clears the output gallery as well.
 */
function resetState(fullReset: boolean) {
    selectedPlan = 'close_up';
    referenceImage = null;
    faceReferenceImage = null;
    detectedSubjectCategory = null;
    detectedSmileType = null;
    customPromptInput.value = '';
    
    // Reset plan buttons
    document.querySelectorAll('.plan-button').forEach(btn => {
        btn.classList.remove('selected');
        if (btn.getAttribute('data-plan') === 'close_up') {
            btn.classList.add('selected');
        }
    });

    // Reset uploader
    imageUpload.value = '';
    uploadPlaceholder.classList.remove('hidden');
    referenceImagePreview.classList.add('hidden');
    referenceImagePreview.src = '';
    uploadContainer.classList.add('uploader-box');
    referenceDownloadButton.classList.add('hidden');
    referenceDownloadButton.href = '#';


    if (fullReset) {
        outputGallery.innerHTML = '';
        setStatus('Все сброшено. Загрузите новое изображение для начала.', 'info', 3000);
        setWizardStep('PAGE2_PLAN'); // Guide back to the start
    }
}

/**
 * Shuffles an array in place.
 * @param array The array to shuffle.
 */
function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

/**
 * Shuffles all pose sequences to ensure variety in each generation.
 */
function shufflePoseSequences() {
    if (!prompts) return;
    poseSequences = {
        female: shuffleArray(prompts.femalePosePrompts),
        femaleGlamour: shuffleArray(prompts.femaleGlamourPosePrompts),
        male: shuffleArray(prompts.malePosePrompts),
        femaleCloseUp: shuffleArray(prompts.femaleCloseUpPosePrompts),
        maleCloseUp: shuffleArray(prompts.maleCloseUpPosePrompts),
        elderlyFemale: shuffleArray(prompts.elderlyFemalePosePrompts),
        elderlyFemaleCloseUp: shuffleArray(prompts.elderlyFemaleCloseUpPosePrompts),
        elderlyMale: shuffleArray(prompts.elderlyMalePosePrompts),
        elderlyMaleCloseUp: shuffleArray(prompts.elderlyMaleCloseUpPosePrompts),
    };
     console.log('Последовательности поз перемешаны.');
}


// --- Authentication and Credit Management ---

/**
 * Updates the credit counter display and state.
 * @param change The amount to change the credits by (can be negative).
 */
function updateCreditCounter(change: number) {
    generationCredits += change;
    if (generationCredits < 0) generationCredits = 0; // Prevent negative credits

    creditCounterEl.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-[var(--primary-color)]" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.414-1.414L11 10.586V6z" />
        </svg>
        <span class="credit-value">${generationCredits}</span>
        <span class="credit-label">кредитов</span>
    `;
    
    // Add a glow effect on credit change
    creditCounterEl.classList.add('credit-counter-glow');
    setTimeout(() => creditCounterEl.classList.remove('credit-counter-glow'), 500);
}

/**
 * Handles the Google Sign-In response.
 * @param response The response object from Google.
 */
async function handleCredentialResponse(response: any) {
    idToken = response.credential;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token: idToken })
        });
        if (!res.ok) {
            throw new Error('Не удалось войти.');
        }
        const data = await res.json();
        userProfile = data.userProfile;
        isLoggedIn = true;
        updateCreditCounter(data.credits); // Set initial credits from server
        updateUIForLogin();
        
        setStatus(`Добро пожаловать, ${userProfile!.name.split(' ')[0]}!`, 'success', 4000);
        // If an image is already uploaded, re-check it with auth
        if (referenceImage) {
            checkImageSubject(referenceImage);
        }
        
        // Guide user to next logical step
        if (referenceImage) {
            setWizardStep('PAGE2_PLAN');
        } else if (page1State.person.base64) {
            setWizardStep('PAGE1_CLOTHING');
        } else {
            // No image yet, prompt for either page
        }


    } catch (error) {
        console.error('Ошибка входа:', error);
        setStatus('Ошибка входа. Попробуйте снова.', 'error', 4000);
        handleLogout(); // Clear any partial login state
    }
}

/**
 * Updates the UI to reflect the logged-in state.
 */
function updateUIForLogin() {
    googleSignInContainer.classList.add('hidden');
    userProfileContainer.classList.remove('hidden');
    userProfileImage.src = userProfile!.picture;
    userProfileName.textContent = userProfile!.name;
    // Fix: Cast to HTMLInputElement as TypeScript linter incorrectly infers a base HTMLElement type.
    (promoCodeInput as HTMLInputElement).disabled = true;
    // Fix: Cast to HTMLButtonElement to resolve TypeScript "Property 'disabled' does not exist on type 'HTMLElement'" error.
    (applyPromoButton as HTMLButtonElement).disabled = true;
    applyPromoButton.textContent = "✓";
    (document.getElementById('promo-code-container') as HTMLDivElement).style.opacity = '0.6';
}

/**
 * Handles user logout.
 */
function handleLogout() {
    idToken = null;
    userProfile = null;
    isLoggedIn = false;
    generationCredits = 0; // Reset credits on logout
    updateCreditCounter(0);

    googleSignInContainer.classList.remove('hidden');
    userProfileContainer.classList.add('hidden');
    userProfileImage.src = '';
    userProfileName.textContent = '';
    
    // Re-enable promo code section
    // Fix: Cast to HTMLInputElement as TypeScript linter incorrectly infers a base HTMLElement type.
    (promoCodeInput as HTMLInputElement).disabled = false;
    promoCodeInput.value = '';
    // Fix: Cast to HTMLButtonElement to resolve TypeScript "Property 'disabled' does not exist on type 'HTMLElement'" error.
    (applyPromoButton as HTMLButtonElement).disabled = false;
    applyPromoButton.textContent = "Применить";
    (document.getElementById('promo-code-container') as HTMLDivElement).style.opacity = '1';
    
    setStatus('Вы вышли из системы.', 'info', 3000);
    setWizardStep('AUTH');
}


/**
 * Initializes the Google Sign-In button.
 */
// Fix: Declare the 'google' object from the Google Identity Services library to resolve TypeScript "Cannot find name" errors.
declare const google: any;
function initializeGoogleSignIn() {
    if (typeof google === 'undefined') {
        console.error("Google's GSI library not loaded.");
        return;
    }
    google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: handleCredentialResponse
    });
    google.accounts.id.renderButton(
        googleSignInContainer,
        { theme: "outline", size: "large", text: "signin_with", shape: "pill", width: "200px" }
    );
    google.accounts.id.prompt();
}

/**
 * Shows the payment modal.
 */
function showPaymentModal() {
    paymentModalOverlay.classList.remove('hidden');
    document.getElementById('payment-selection-view')?.classList.remove('hidden');
    document.getElementById('payment-processing-view')?.classList.add('hidden');
    document.getElementById('payment-final-view')?.classList.add('hidden');
}

/**
 * Hides the payment modal.
 */
function hidePaymentModal() {
    paymentModalOverlay.classList.add('hidden');
}

/**
 * Simulates the payment process and adds credits.
 */
async function handleConfirmPayment() {
    const finalView = document.getElementById('payment-final-view')!;
    const confirmButton = document.getElementById('payment-confirm-button')!;
    
    confirmButton.disabled = true;
    confirmButton.innerHTML = `<div class="loading-spinner mx-auto" style="width: 1.5rem; height: 1.5rem; border-width: 2px;"></div>`;

    try {
        const response = await fetch('/api/addCredits', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
            }
        });
        if (!response.ok) {
            throw new Error('Не удалось пополнить кредиты.');
        }
        const data = await response.json();
        // Update credits with the new value from the server
        generationCredits = 0; // Reset local to server value
        updateCreditCounter(data.newCredits);
        
        setStatus('Оплата прошла успешно! 12 кредитов добавлено.', 'success', 5000);
        hidePaymentModal();

    } catch (error) {
        setStatus(`Ошибка оплаты: ${(error as Error).message}`, 'error', 5000);
    } finally {
        confirmButton.disabled = false;
        confirmButton.innerHTML = 'Оплатить 199 ₽';
    }
}

/**
 * Applies a promo code.
 */
function applyPromoCode() {
    const code = promoCodeInput.value.trim().toUpperCase();
    const promo = PROMO_CODES[code];

    if (!promo) {
        setStatus('Неверный промокод.', 'error', 3000);
        return;
    }
    
    if (promo.type === 'credits') {
        updateCreditCounter(promo.value);
        setStatus(promo.message, 'success', 4000);
        promoCodeInput.value = '';
        promoCodeInput.disabled = true;
        applyPromoButton.disabled = true;
        applyPromoButton.textContent = "✓";
         (document.getElementById('promo-code-container') as HTMLDivElement).style.opacity = '0.6';

    }
}


// --- PAGE 1 ("Photoshoot") State and Logic ---

let page1State = {
    person: { base64: '', mimeType: '' },
    clothingText: '',
    clothingImage: { base64: '', mimeType: '' },
    locationText: '',
    locationImage: { base64: '', mimeType: '' },
    isGenerating: false,
    generatedResult: { base64: '', mimeType: '' },
};

// DOM Elements for Page 1
let page1: HTMLDivElement, page2: HTMLDivElement;
let page1ImageUpload: HTMLInputElement, page1ImagePreview: HTMLImageElement, page1UploadPlaceholder: HTMLDivElement, page1ClearButton: HTMLButtonElement;
let clothingLocationContainer: HTMLDivElement;
let clothingPrompt: HTMLInputElement, clothingSuggestionsContainer: HTMLDivElement, clothingUploadContainer: HTMLDivElement, clothingImagePreview: HTMLImageElement, clothingImageUpload: HTMLInputElement, clothingClearButton: HTMLButtonElement, refreshClothingSuggestions: HTMLButtonElement;
let locationPrompt: HTMLInputElement, locationSuggestionsContainer: HTMLDivElement, locationUploadContainer: HTMLDivElement, locationImagePreview: HTMLImageElement, locationImageUpload: HTMLInputElement, locationClearButton: HTMLButtonElement, refreshLocationSuggestions: HTMLButtonElement;
let generatePhotoshootButton: HTMLButtonElement, photoshootResultContainer: HTMLDivElement, page1Subtitle: HTMLParagraphElement;

function setupPage1DOM() {
    page1 = document.getElementById('page1') as HTMLDivElement;
    page2 = document.getElementById('page2') as HTMLDivElement;
    page1ImageUpload = document.getElementById('page1-image-upload') as HTMLInputElement;
    page1ImagePreview = document.getElementById('page1-image-preview') as HTMLImageElement;
    page1UploadPlaceholder = document.getElementById('page1-upload-placeholder') as HTMLDivElement;
    page1ClearButton = document.getElementById('page1-clear-button') as HTMLButtonElement;
    clothingLocationContainer = document.getElementById('clothing-location-container') as HTMLDivElement;
    clothingPrompt = document.getElementById('clothing-prompt') as HTMLInputElement;
    clothingSuggestionsContainer = document.getElementById('clothing-suggestions-container') as HTMLDivElement;
    clothingUploadContainer = document.getElementById('clothing-upload-container') as HTMLDivElement;
    clothingImagePreview = document.getElementById('clothing-image-preview') as HTMLImageElement;
    clothingImageUpload = document.getElementById('clothing-image-upload') as HTMLInputElement;
    clothingClearButton = document.getElementById('clothing-clear-button') as HTMLButtonElement;
    refreshClothingSuggestions = document.getElementById('refresh-clothing-suggestions') as HTMLButtonElement;
    locationPrompt = document.getElementById('location-prompt') as HTMLInputElement;
    locationSuggestionsContainer = document.getElementById('location-suggestions-container') as HTMLDivElement;
    locationUploadContainer = document.getElementById('location-upload-container') as HTMLDivElement;
    locationImagePreview = document.getElementById('location-image-preview') as HTMLImageElement;
    locationImageUpload = document.getElementById('location-image-upload') as HTMLInputElement;
    locationClearButton = document.getElementById('location-clear-button') as HTMLButtonElement;
    refreshLocationSuggestions = document.getElementById('refresh-location-suggestions') as HTMLButtonElement;
    generatePhotoshootButton = document.getElementById('generate-photoshoot-button') as HTMLButtonElement;
    photoshootResultContainer = document.getElementById('photoshoot-result-container') as HTMLDivElement;
    page1Subtitle = document.getElementById('page1-subtitle') as HTMLParagraphElement;

    // Setup Event Listeners
    (document.getElementById('page1-upload-container') as HTMLDivElement).addEventListener('click', () => page1ImageUpload.click());
    page1ImageUpload.addEventListener('change', (e) => handlePage1ImageUpload((e.target as HTMLInputElement).files?.[0]));
    page1ClearButton.addEventListener('click', (e) => {
        e.stopPropagation();
        resetPage1();
    });
    
    // Drag and Drop for Main Photo
    setupDragAndDrop(document.getElementById('page1-upload-container')!, handlePage1ImageUpload);

    // Clothing listeners
    clothingUploadContainer.addEventListener('click', () => clothingImageUpload.click());
    clothingImageUpload.addEventListener('change', (e) => handlePage1SubImageUpload((e.target as HTMLInputElement).files?.[0], 'clothing'));
    clothingClearButton.addEventListener('click', (e) => {
        e.stopPropagation();
        clearPage1SubImage('clothing');
    });
    refreshClothingSuggestions.addEventListener('click', () => populateSuggestions('clothing'));
    clothingPrompt.addEventListener('input', () => { page1State.clothingText = clothingPrompt.value; updatePage1UI(); });
    setupDragAndDrop(clothingUploadContainer, (file) => handlePage1SubImageUpload(file, 'clothing'));

    // Location listeners
    locationUploadContainer.addEventListener('click', () => locationImageUpload.click());
    locationImageUpload.addEventListener('change', (e) => handlePage1SubImageUpload((e.target as HTMLInputElement).files?.[0], 'location'));
    locationClearButton.addEventListener('click', (e) => {
        e.stopPropagation();
        clearPage1SubImage('location');
    });
    refreshLocationSuggestions.addEventListener('click', () => populateSuggestions('location'));
    locationPrompt.addEventListener('input', () => { page1State.locationText = locationPrompt.value; updatePage1UI(); });
    setupDragAndDrop(locationUploadContainer, (file) => handlePage1SubImageUpload(file, 'location'));
    
    locationPrompt.addEventListener('paste', handleLocationPaste);


    generatePhotoshootButton.addEventListener('click', handleGeneratePhotoshoot);
    
    setupNavigation();
    updatePage1UI();
}

async function handleLocationPaste(event: ClipboardEvent) {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
            const file = items[i].getAsFile();
            if (file) {
                 event.preventDefault(); // Prevent pasting text representation
                 setStatus("Анализирую фото из буфера...", "loading");
                 await handlePage1SubImageUpload(file, 'location', true);
                 setStatus("Локация описана по фото из буфера!", "success", 4000);
                 break;
            }
        }
    }
}


function setupNavigation() {
    const navButtons = document.querySelectorAll('.nav-button');
    navButtons.forEach(button => {
        button.addEventListener('click', () => {
            const page = button.getAttribute('data-page');
            
            navButtons.forEach(btn => btn.classList.remove('active'));
            button.classList.add('active');

            if (page === 'page1') {
                page1.classList.remove('hidden');
                page2.classList.add('hidden');
            } else {
                page1.classList.add('hidden');
                page2.classList.remove('hidden');
            }
        });
    });
}

function updatePage1UI() {
    // Main Photo
    if (page1State.person.base64) {
        page1ImagePreview.src = `data:${page1State.person.mimeType};base64,${page1State.person.base64}`;
        page1ImagePreview.classList.remove('hidden');
        page1UploadPlaceholder.classList.add('hidden');
        page1ClearButton.classList.remove('hidden');
        clothingLocationContainer.classList.remove('hidden');
        page1Subtitle.textContent = 'Шаг 2: Опишите одежду и локацию';
    } else {
        page1ImagePreview.classList.add('hidden');
        page1UploadPlaceholder.classList.remove('hidden');
        page1ClearButton.classList.add('hidden');
        clothingLocationContainer.classList.add('hidden');
        photoshootResultContainer.classList.add('hidden');
        page1Subtitle.textContent = 'Шаг 1: Загрузите ваше фото для начала';
    }

    // Clothing
    if (page1State.clothingImage.base64) {
        clothingImagePreview.src = `data:${page1State.clothingImage.mimeType};base64,${page1State.clothingImage.base64}`;
        clothingImagePreview.classList.remove('hidden');
        (clothingUploadContainer.querySelector('#clothing-upload-placeholder') as HTMLDivElement).classList.add('hidden');
        clothingClearButton.classList.remove('hidden');
    } else {
        clothingImagePreview.classList.add('hidden');
        (clothingUploadContainer.querySelector('#clothing-upload-placeholder') as HTMLDivElement).classList.remove('hidden');
        clothingClearButton.classList.add('hidden');
    }

    // Location
    if (page1State.locationImage.base64) {
        locationImagePreview.src = `data:${page1State.locationImage.mimeType};base64,${page1State.locationImage.base64}`;
        locationImagePreview.classList.remove('hidden');
        (locationUploadContainer.querySelector('#location-upload-placeholder') as HTMLDivElement).classList.add('hidden');
        locationClearButton.classList.remove('hidden');
    } else {
        locationImagePreview.classList.add('hidden');
        (locationUploadContainer.querySelector('#location-upload-placeholder') as HTMLDivElement).classList.remove('hidden');
        locationClearButton.classList.add('hidden');
    }
    
    // Generate Button State
    const canGenerate = page1State.person.base64 && (page1State.clothingText || page1State.clothingImage.base64) && (page1State.locationText || page1State.locationImage.base64);
    generatePhotoshootButton.disabled = !canGenerate || page1State.isGenerating;

    if (page1State.person.base64 && !canGenerate) {
        if (!page1State.clothingText && !page1State.clothingImage.base64) {
             setWizardStep('PAGE1_CLOTHING');
        } else if (!page1State.locationText && !page1State.locationImage.base64) {
             setWizardStep('PAGE1_LOCATION');
        }
    } else if (canGenerate) {
        setWizardStep('PAGE1_GENERATE');
    }
}

function resetPage1() {
    page1State = {
        person: { base64: '', mimeType: '' },
        clothingText: '',
        clothingImage: { base64: '', mimeType: '' },
        locationText: '',
        locationImage: { base64: '', mimeType: '' },
        isGenerating: false,
        generatedResult: { base64: '', mimeType: '' },
    };
    page1ImageUpload.value = '';
    clothingImageUpload.value = '';
    locationImageUpload.value = '';
    clothingPrompt.value = '';
    locationPrompt.value = '';
    photoshootResultContainer.innerHTML = '';
    photoshootResultContainer.classList.add('hidden');
    setWizardStep('PAGE1_PHOTO');
    updatePage1UI();
}

function clearPage1SubImage(type: 'clothing' | 'location') {
    if (type === 'clothing') {
        page1State.clothingImage = { base64: '', mimeType: '' };
        clothingImageUpload.value = '';
    } else {
        page1State.locationImage = { base64: '', mimeType: '' };
        locationImageUpload.value = '';
    }
    updatePage1UI();
}

async function handlePage1ImageUpload(file: File | undefined | null) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = (e.target?.result as string)?.split(',')[1];
        if (!base64) return;

        const initialState: ImageState = { base64, mimeType: file.type };
        setStatus('Обработка вашего фото...', 'loading');
        try {
            const resized = await resizeImage(initialState);
            page1State.person = resized;
            
            // This is a critical step: check the subject to tailor suggestions
            await checkImageSubject(resized);

            // Also create a face reference for later use in variations
            createFaceReference(resized, page1ImagePreview).catch(err => {
                 console.error("Фоновая задача создания референса лица провалена:", err);
            });

            populateSuggestions('clothing');
            populateSuggestions('location');
            setStatus('Фото загружено! Теперь добавьте детали.', 'success', 3000);
            updatePage1UI();

        } catch (error) {
            setStatus(`Ошибка: ${(error as Error).message}`, 'error', 4000);
        }
    };
    reader.readAsDataURL(file);
}

async function handlePage1SubImageUpload(file: File | undefined | null, type: 'clothing' | 'location', shouldAnalyzeForText = false) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = (e.target?.result as string)?.split(',')[1];
        if (!base64) return;

        let imageState: ImageState = { base64, mimeType: file.type };
        setStatus(`Обработка фото ${type === 'clothing' ? 'одежды' : 'локации'}...`, 'loading');

        try {
            // Screenshots of clothing can be very tall, so crop them.
            if (type === 'clothing') {
                imageState = await cropImage(imageState);
            }
            const resized = await resizeImage(imageState);
            
            if (type === 'clothing') {
                page1State.clothingImage = resized;
            } else {
                page1State.locationImage = resized;
                 if (shouldAnalyzeForText) {
                    await analyzeImageForText(resized);
                }
            }
            setStatus(`Фото ${type === 'clothing' ? 'одежды' : 'локации'} загружено.`, 'success', 3000);
            updatePage1UI();

        } catch (error) {
             setStatus(`Ошибка: ${(error as Error).message}`, 'error', 4000);
        }
    };
    reader.readAsDataURL(file);
}

/**
 * Analyzes location image and fills the text prompt with the description.
 * @param imageState The location image to analyze.
 */
async function analyzeImageForText(imageState: ImageState) {
    if (!isLoggedIn) {
        setStatus("Войдите, чтобы использовать анализ фото локации.", "info", 4000);
        return;
    }
    
    setStatus("Анализирую фото локации...", 'loading');
    
    const analysisPrompt = "Опиши это место одним коротким, но емким и вдохновляющим предложением для фотосессии. Например: 'в роскошном гостиничном номере с панорамными окнами' или 'на крыше с видом на европейский город'. Говори так, будто это часть итогового промпта. Не используй кавычки.";

    try {
        const response = await fetch('/api/analyzeImageForText', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({ image: imageState, analysisPrompt })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Ошибка анализа изображения.');
        }

        const data = await response.json();
        locationPrompt.value = data.text;
        page1State.locationText = data.text;
        setStatus("Локация успешно описана!", 'success', 3000);
        updatePage1UI();

    } catch (error) {
        setStatus(`Ошибка анализа: ${(error as Error).message}`, 'error', 5000);
    }
}


function getSuggestionPrompts(type: 'clothing' | 'location'): string[] {
    if (!prompts) return [];
    if (type === 'clothing') {
        switch (detectedSubjectCategory) {
            case 'man': return prompts.maleClothingSuggestions;
            case 'woman': return prompts.femaleClothingSuggestions;
            case 'teenager': return prompts.teenClothingSuggestions;
            case 'elderly_man': return prompts.elderlyMaleClothingSuggestions;
            case 'elderly_woman': return prompts.elderlyFemaleClothingSuggestions;
            case 'child': return prompts.childClothingSuggestions;
            default: return prompts.femaleClothingSuggestions;
        }
    } else { // location
        switch (detectedSubjectCategory) {
            case 'child': return prompts.childLocationSuggestions;
            case 'teenager': return prompts.teenLocationSuggestions;
            default: return prompts.locationSuggestions;
        }
    }
}

function populateSuggestions(type: 'clothing' | 'location') {
    const container = type === 'clothing' ? clothingSuggestionsContainer : locationSuggestionsContainer;
    const promptInput = type === 'clothing' ? clothingPrompt : locationPrompt;
    
    const suggestionPrompts = getSuggestionPrompts(type);
    const shuffled = shuffleArray(suggestionPrompts);
    const suggestionsToShow = shuffled.slice(0, 5);
    
    container.innerHTML = '';
    container.classList.remove('visible');

    setTimeout(() => {
        suggestionsToShow.forEach(suggestion => {
            const item = document.createElement('button');
            item.className = 'suggestion-item';
            item.textContent = suggestion;
            item.onclick = () => {
                promptInput.value = suggestion;
                if (type === 'clothing') page1State.clothingText = suggestion;
                else page1State.locationText = suggestion;
                updatePage1UI();
            };
            container.appendChild(item);
        });
        container.classList.add('visible');
    }, 50);
}


async function handleGeneratePhotoshoot() {
    if (!isLoggedIn) {
        setStatus('Пожалуйста, войдите, чтобы начать фотосессию.', 'error', 4000);
        setWizardStep('AUTH');
        return;
    }
    if (generationCredits < 1) {
        setStatus('Недостаточно кредитов для фотосессии.', 'error', 4000);
        showPaymentModal();
        return;
    }

    page1State.isGenerating = true;
    updatePage1UI();

    photoshootResultContainer.classList.remove('hidden');
    photoshootResultContainer.innerHTML = `
        <div class="flex flex-col items-center gap-4 text-center">
          <div class="loading-spinner large"></div>
          <p id="photoshoot-loading-text" class="font-semibold">Создаем ваш уникальный образ...</p>
          <p class="text-xs text-gray-400">Это может занять до минуты. Пожалуйста, не закрывайте вкладку.</p>
        </div>
    `;

    try {
        updateCreditCounter(-1);

        const parts = [];
        // 1. Person Image
        parts.push({ inlineData: { data: page1State.person.base64, mimeType: page1State.person.mimeType } });

        // 2. Clothing (Image or Text)
        if (page1State.clothingImage.base64) {
            parts.push({ inlineData: { data: page1State.clothingImage.base64, mimeType: page1State.clothingImage.mimeType } });
            if (page1State.clothingText) {
                parts.push({ text: `Стиль одежды: ${page1State.clothingText}.` });
            }
        } else {
            parts.push({ text: `Наденьте на человека: ${page1State.clothingText}.` });
        }
        
        // 3. Location (Image or Text)
        if (page1State.locationImage.base64) {
            parts.push({ inlineData: { data: page1State.locationImage.base64, mimeType: page1State.locationImage.mimeType } });
             if (page1State.locationText) {
                parts.push({ text: `Используй эту локацию как фон: ${page1State.locationText}.` });
            }
        } else {
             parts.push({ text: `Поместите человека в эту локацию: ${page1State.locationText}.` });
        }
        
        // 4. Final Instruction
        parts.push({ text: "Создай реалистичное фото, где человек с первого фото органично вписан в одежду и локацию. Сохрани черты лица, но адаптируй позу и освещение для максимальной фотореалистичности." });
        
        const response = await fetch('/api/generatePhotoshoot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${idToken}` },
            body: JSON.stringify({ parts })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            updateCreditCounter(1); // Refund credit on failure
            throw new Error(errorData.error || 'Ошибка генерации фотосессии.');
        }

        const data = await response.json();
        page1State.generatedResult = data.generatedPhotoshootResult;
        displayPhotoshootResult(data.resultUrl);

    } catch (error) {
        photoshootResultContainer.innerHTML = `<p class="text-red-400 text-center">Ошибка: ${(error as Error).message}</p>`;
    } finally {
        page1State.isGenerating = false;
        updatePage1UI();
    }
}

function displayPhotoshootResult(resultUrl: string) {
    photoshootResultContainer.innerHTML = `
        <div class="generated-photoshoot-wrapper w-full max-w-lg mx-auto">
            <img src="${resultUrl}" alt="Результат фотосессии" class="w-full h-full object-contain rounded-lg shadow-lg">
            <div class="result-actions">
                <button id="regenerate-photoshoot-button" class="result-action-button" title="Пересоздать (1 кредит)">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 110 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
                    </svg>
                </button>
                <button id="send-to-variations-button" class="result-action-button" title="Отправить в '4 Вариации'">
                     <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10.894 2.553a1 1 0 00-1.788 0l-7 14a1 1 0 001.169 1.409l5-1.429A1 1 0 009 15.571V11a1 1 0 112 0v4.571a1 1 0 00.725.962l5 1.428a1 1 0 001.17-1.408l-7-14z" /></svg>
                </button>
            </div>
        </div>
    `;
    document.getElementById('regenerate-photoshoot-button')?.addEventListener('click', handleGeneratePhotoshoot);
    document.getElementById('send-to-variations-button')?.addEventListener('click', handleSendToVariations);
}

function handleSendToVariations() {
    if (!page1State.generatedResult.base64) return;
    
    // Switch to page 2
    (document.querySelector('.nav-button[data-page="page2"]') as HTMLButtonElement).click();

    // Set the generated image as the new reference on page 2
    referenceImage = page1State.generatedResult;
    referenceImagePreview.src = `data:${referenceImage.mimeType};base64,${referenceImage.base64}`;
    referenceImagePreview.classList.remove('hidden');
    uploadPlaceholder.classList.add('hidden');
    uploadContainer.classList.remove('uploader-box');
    referenceDownloadButton.href = `data:${referenceImage.mimeType};base64,${referenceImage.base64}`;
    referenceDownloadButton.download = `reference_${Date.now()}.jpg`;
    referenceDownloadButton.classList.remove('hidden');

    // IMPORTANT: The faceReferenceImage from the original upload on Page 1 is already in the global state
    // and will be used automatically. We don't need to do anything here.
    
    // Clear the page 2 gallery
    outputGallery.innerHTML = '';
    
    setStatus("Изображение из фотосессии установлено как референс!", "success", 4000);
    setWizardStep('PAGE2_PLAN');
}


// --- Main Initialization ---

async function main() {
    // --- Assign DOM Elements ---
    lightboxOverlay = document.getElementById('lightbox-overlay') as HTMLDivElement;
    lightboxImage = document.getElementById('lightbox-image') as HTMLImageElement;
    lightboxCloseButton = document.getElementById('lightbox-close-button') as HTMLButtonElement;
    statusEl = document.getElementById('status') as HTMLDivElement;
    planButtonsContainer = document.getElementById('plan-buttons') as HTMLDivElement;
    generateButton = document.getElementById('generate-button') as HTMLButtonElement;
    resetButton = document.getElementById('reset-button') as HTMLButtonElement;
    outputGallery = document.getElementById('output-gallery') as HTMLDivElement;
    uploadContainer = document.getElementById('upload-container') as HTMLDivElement;
    imageUpload = document.getElementById('image-upload') as HTMLInputElement;
    referenceImagePreview = document.getElementById('reference-image-preview') as HTMLImageElement;
    uploadPlaceholder = document.getElementById('upload-placeholder') as HTMLDivElement;
    customPromptInput = document.getElementById('custom-prompt-input') as HTMLInputElement;
    referenceDownloadButton = document.getElementById('reference-download-button') as HTMLAnchorElement;
    paymentModalOverlay = document.getElementById('payment-modal-overlay') as HTMLDivElement;
    paymentConfirmButton = document.getElementById('payment-confirm-button') as HTMLButtonElement;
    paymentCloseButton = document.getElementById('payment-close-button') as HTMLButtonElement;
    creditCounterEl = document.getElementById('credit-counter') as HTMLDivElement;
    promoCodeInput = document.getElementById('promo-code-input') as HTMLInputElement;
    applyPromoButton = document.getElementById('apply-promo-button') as HTMLButtonElement;
    authContainer = document.getElementById('auth-container') as HTMLDivElement;
    googleSignInContainer = document.getElementById('google-signin-container') as HTMLDivElement;
    userProfileContainer = document.getElementById('user-profile-container') as HTMLDivElement;
    userProfileImage = document.getElementById('user-profile-image') as HTMLImageElement;
    userProfileName = document.getElementById('user-profile-name') as HTMLSpanElement;

    // --- Setup Page 1 ---
    setupPage1DOM();
    const page1UploadPlaceholderContent = `
        <div class="flex flex-col items-center justify-center text-center p-4 h-full">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-16 w-16 text-gray-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
            </svg>
            <h3 class="text-xl font-semibold mb-2 text-gray-200">Загрузите ваше лучшее фото</h3>
            <p class="text-gray-400 max-w-xs">Для наилучшего результата используйте качественное фото, где хорошо видно ваше лицо.</p>
        </div>`;
    page1UploadPlaceholder.innerHTML = page1UploadPlaceholderContent;


    // --- Load Prompts ---
    try {
        const response = await fetch('/prompts.json');
        prompts = await response.json();
        shufflePoseSequences();
    } catch (error) {
        console.error('Не удалось загрузить промпты:', error);
        setStatus('Критическая ошибка: не удалось загрузить файл промптов.', 'error');
        return;
    }

    // --- Event Listeners ---
    generateButton.addEventListener('click', generateVariations);
    resetButton.addEventListener('click', () => resetState(true));
    uploadContainer.addEventListener('click', () => imageUpload.click());
    imageUpload.addEventListener('change', (e) => handleImageUpload((e.target as HTMLInputElement).files![0]));

    // Drag and Drop for Page 2
    setupDragAndDrop(uploadContainer, handleImageUpload);

    planButtonsContainer.addEventListener('click', (e) => {
        const target = e.target as HTMLButtonElement;
        if (target.matches('.plan-button')) {
            document.querySelectorAll('.plan-button').forEach(btn => btn.classList.remove('selected'));
            target.classList.add('selected');
            selectedPlan = target.dataset.plan!;
        }
    });
    
    // Lightbox Listeners
    outputGallery.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        const galleryItem = target.closest('.gallery-item');
        if (galleryItem && !galleryItem.querySelector('p')) { // Ensure it's not an error message
            const img = galleryItem.querySelector('img');
            if (img) {
                lightboxImage.src = img.src;
                lightboxOverlay.classList.remove('opacity-0', 'pointer-events-none');
            }
        }
    });
    lightboxCloseButton.addEventListener('click', () => lightboxOverlay.classList.add('opacity-0', 'pointer-events-none'));
    lightboxOverlay.addEventListener('click', (e) => {
        if (e.target === lightboxOverlay) {
            lightboxOverlay.classList.add('opacity-0', 'pointer-events-none');
        }
    });

    // Payment Modal Listeners
    creditCounterEl.addEventListener('click', showPaymentModal);
    paymentCloseButton.addEventListener('click', hidePaymentModal);
    paymentModalOverlay.addEventListener('click', (e) => {
      if (e.target === paymentModalOverlay) hidePaymentModal();
    });
    paymentConfirmButton.addEventListener('click', handleConfirmPayment);
    document.getElementById('payment-proceed-button')?.addEventListener('click', () => {
        document.getElementById('payment-selection-view')?.classList.add('hidden');
        const processingView = document.getElementById('payment-processing-view')!;
        processingView.classList.remove('hidden');
        setTimeout(() => {
            processingView.classList.add('hidden');
            document.getElementById('payment-final-view')?.classList.remove('hidden');
        }, 1500);
    });
    document.querySelectorAll('.payment-method').forEach(method => {
        method.addEventListener('click', () => {
            document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('selected'));
            method.classList.add('selected');
        });
    });

    // Auth Listeners
    applyPromoButton.addEventListener('click', applyPromoCode);
    userProfileContainer.addEventListener('click', handleLogout);

    // --- Initial State ---
    document.querySelector('.plan-button[data-plan="close_up"]')?.classList.add('selected');
    updateCreditCounter(0); // Initialize display with 0
    initializeGoogleSignIn();
    resetState(true);
    setWizardStep('PAGE1_PHOTO');
}

/**
 * Sets up drag and drop functionality for a given container.
 * @param container The element to attach listeners to.
 * @param handleFile The function to call with the dropped file.
 */
function setupDragAndDrop(container: HTMLElement, handleFile: (file: File) => void) {
    container.addEventListener('dragover', (e) => {
        e.preventDefault();
        container.classList.add('drag-over');
    });
    container.addEventListener('dragleave', () => {
        container.classList.remove('drag-over');
    });
    container.addEventListener('drop', (e) => {
        e.preventDefault();
        container.classList.remove('drag-over');
        if (e.dataTransfer?.files[0]) {
            handleFile(e.dataTransfer.files[0]);
        }
    });
}


/**
 * Aggressive Cache and Service Worker Cleaning
 * This ensures users always get the latest version of the app upon reload.
 */
async function clearCacheAndServiceWorkers() {
    console.log("Запуск агрессивной очистки кэша и Service Worker...");
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            if (registrations.length > 0) {
                for (const registration of registrations) {
                    await registration.unregister();
                    console.log(`Service Worker с областью ${registration.scope} удален.`);
                }
            } else {
                 console.log("Активные Service Worker не найдены.");
            }
        }

        if ('caches' in window) {
            const keys = await caches.keys();
            if (keys.length > 0) {
                await Promise.all(keys.map(key => caches.delete(key)));
                console.log("Все кэши успешно очищены.");
            } else {
                 console.log("Кэши для очистки не найдены.");
            }
           
        }
    } catch (error) {
        console.error('Ошибка во время очистки кэша или Service Worker:', error);
    }
     console.log("Очистка завершена.");
}


// --- Entry Point ---
window.addEventListener('DOMContentLoaded', () => {
    clearCacheAndServiceWorkers().then(() => {
        main();
    });
});