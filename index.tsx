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
                 posePrompts = selectedPlan