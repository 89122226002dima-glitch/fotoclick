

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
type WizardStep = 'CREDITS' | 'AUTH' | 'NONE';

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
    paymentModalOverlay: HTMLDivElement, paymentConfirmButton: HTMLButtonElement,
    paymentCloseButton: HTMLButtonElement, creditCounterEl: HTMLDivElement, promoCodeInput: HTMLInputElement,
    applyPromoButton: HTMLButtonElement, authContainer: HTMLDivElement, googleSignInContainer: HTMLDivElement,
    userProfileContainer: HTMLDivElement, userProfileImage: HTMLImageElement, userProfileName: HTMLSpanElement,
    paymentQrView: HTMLDivElement, paymentQrImage: HTMLImageElement, paymentBackButton: HTMLButtonElement,
    planSmallCard: HTMLDivElement, planLargeCard: HTMLDivElement;


// --- State Variables ---
let selectedPaymentPlan: 'small' | 'large' = 'small';
let generationCredits = 0; 
let isLoggedIn = false;
let userProfile: UserProfile | null = null;
let idToken: string | null = null;
const GOOGLE_CLIENT_ID = '455886432948-lk8a1e745cq41jujsqtccq182e5lf9dh.apps.googleusercontent.com';
let db: IDBPDatabase<PhotoClickDB>;

// --- Business Page State ---
let businessProductImage: ImageState | null = null;
let businessRefImage1: ImageState | null = null;
let businessRefImage2: ImageState | null = null;

const MAX_DIMENSION = 1024;
const MAX_PRE_RESIZE_DIMENSION = 2048;
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
}

async function addToHistory(images: ImageState[]) {
    if (!db) return;
    try {
        const tx = db.transaction('historyImages', 'readwrite');
        const store = tx.objectStore('historyImages');
        for (const image of images) {
            await store.add({ image, timestamp: Date.now() });
        }
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
 */
function setWizardStep(step: WizardStep) {
    const targets = {
        credits: document.getElementById('credit-counter'),
        auth: document.getElementById('google-signin-container'),
    };

    Object.values(targets).forEach(el => el?.classList.remove('highlight-step'));

    switch (step) {
        case 'CREDITS': targets.credits?.classList.add('highlight-step'); break;
        case 'AUTH': targets.auth?.classList.add('highlight-step'); break;
        case 'NONE': break;
    }
}

async function preResizeImage(file: File): Promise<ImageState> {
    return new Promise((resolve, reject) => {
        if (file.size > 50 * 1024 * 1024) {
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
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Не удалось получить 2D контекст холста.'));
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const [header, base64] = dataUrl.split(',');
            resolve({ base64, mimeType: 'image/jpeg' });
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Не удалось загрузить файл изображения.'));
        };
        img.src = objectUrl;
    });
}

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
            canvas.width = width; canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return reject(new Error('Не удалось получить 2D контекст.'));
            ctx.drawImage(img, 0, 0, width, height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
            const [header, base64] = dataUrl.split(',');
            resolve({ base64, mimeType: 'image/jpeg' });
        };
        img.onerror = () => reject(new Error('Не удалось загрузить изображение.'));
        img.src = `data:${imageState.mimeType};base64,${imageState.base64}`;
    });
}

async function sliceGridImage(gridBase64: string, gridMimeType: string): Promise<string[]> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const w = img.width; const h = img.height;
            const halfW = Math.floor(w / 2); const halfH = Math.floor(h / 2);
            const imageUrls: string[] = [];
            const positions = [{ x: 0, y: 0 }, { x: halfW, y: 0 }, { x: 0, y: halfH }, { x: halfW, y: halfH }];
            positions.forEach(pos => {
                const canvas = document.createElement('canvas');
                canvas.width = halfW; canvas.height = halfH;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.drawImage(img, pos.x, pos.y, halfW, halfH, 0, 0, halfW, halfH);
                    imageUrls.push(canvas.toDataURL('image/png'));
                }
            });
            resolve(imageUrls);
        };
        img.onerror = () => reject(new Error("Failed to load grid image"));
        img.src = `data:${gridMimeType};base64,${gridBase64}`;
    });
}

function signOut() {
    isLoggedIn = false; userProfile = null; idToken = null; generationCredits = 0;
    localStorage.removeItem('idToken'); localStorage.removeItem('userProfile');
    if (userProfileContainer) userProfileContainer.classList.add('hidden');
    if (googleSignInContainer) googleSignInContainer.classList.remove('hidden');
    updateCreditCounterUI();
    updateAllGenerateButtons();
}

async function callApi(endpoint: string, body: object) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 180000);
    const headers: HeadersInit = { 'Content-Type': 'application/json' };
    const currentToken = localStorage.getItem('idToken');
    if (currentToken) headers['Authorization'] = `Bearer ${currentToken}`;
    let response;
    try {
        response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
    } catch (error) {
        if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Не удалось связаться с сервером.');
        throw error;
    } finally { clearTimeout(timeoutId); }
    const responseText = await response.text();
    let responseData;
    try { responseData = JSON.parse(responseText); } catch (e) { throw new Error(`Сервер вернул неожиданный ответ.`); }
    if (!response.ok) {
        if (response.status === 401) { signOut(); throw new Error("Ваша сессия истекла."); }
        throw new Error(responseData.error || `Произошла ошибка.`);
    }
    return responseData;
}

function hideLightbox() {
    if (lightboxOverlay) {
      lightboxOverlay.classList.add('opacity-0', 'pointer-events-none');
      setTimeout(() => { if (lightboxImage) lightboxImage.src = ''; }, 300);
    }
}

function openLightbox(imageUrl: string) {
    if (lightboxImage && lightboxOverlay) {
        lightboxImage.src = imageUrl;
        lightboxOverlay.classList.remove('opacity-0', 'pointer-events-none');
    }
}

function updateCreditCounterUI() {
    if (creditCounterEl) {
        creditCounterEl.innerHTML = `
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-yellow-400 shrink-0" viewBox="0 0 20 20" fill="currentColor"><path d="M8.433 7.418c.158-.103.346-.196.567-.267v1.698a2.5 2.5 0 00-.567-.267C8.07 8.488 8 8.731 8 9c0 .269.07.512.433.582.221.07.41.164.567.267v1.698c-.22.071-.409.164-.567-.267C8.07 11.512 8 11.731 8 12c0 .269.07.512.433.582.221.07.41.164.567.267v1.698c-1.135-.285-2-1.201-2-2.423 0-1.209.865-2.138 2-2.423v-1.698c.221.07.41.164.567.267C11.93 8.488 12 8.731 12 9c0 .269-.07-.512-.433-.582-.221-.07-.41-.164-.567-.267V7.862c1.135.285 2 1.201 2 1.22-.865-2.138-2 2.423v1.698a2.5 2.5 0 00.567-.267c.364-.24.433-.482.433-.582 0-.269-.07-.512-.433-.582-.221-.07-.41-.164-.567-.267V12.14c1.135-.285 2-1.201 2-2.423s-.865-2.138-2-2.423V5.577c1.135.285 2 1.201 2 2.423 0 .269.07.512.433.582.221.07.409.164.567.267V7.862a2.5 2.5 0 00-.567-.267C11.93 7.512 12 7.269 12 7c0-1.22-.865-2.138-2-2.423V3a1 1 0 00-2 0v1.577C6.865 4.862 6 5.78 6 7c0 .269.07.512.433.582.221.07.41.164.567.267V6.14a2.5 2.5 0 00-.567-.267C5.07 5.512 5 5.269 5 5c0-1.22.865-2.138 2-2.423V1a1 1 0 10-2 0v1.577c-1.135-.285-2 1.201-2 2.423s.865 2.138 2 2.423v1.698c-.221-.07-.41-.164-.567-.267C4.07 8.488 4 8.731 4 9s.07.512.433.582c.221.07.41.164.567.267v1.698a2.5 2.5 0 00.567.267C4.07 11.512 4 11.731 4 12s.07.512.433.582c.221.07.41.164.567.267v1.698c-.221-.07-.409-.164-.567-.267C4.07 13.512 4 13.731 4 14c0 1.22.865 2.138 2 2.423v1.577a1 1 0 102 0v-1.577c1.135-.285-2 1.201-2 2.423s-.865-2.138-2-2.423v-1.698c.221.07.41.164.567.267.364.24.433.482.433.582s-.07.512-.433-.582c-.221-.07-.41-.164-.567-.267v1.698a2.5 2.5 0 00.567.267c.364.24.433.482.433.582s-.07.512-.433-.582c-.221-.07-.41-.164-.567-.267V13.86c-1.135-.285-2-1.201-2-2.423s.865-2.138 2-2.423V7.862c-.221-.07-.41-.164-.567-.267C8.07 7.512 8 7.269 8 7c0-.269.07.512.433-.582z" /></svg>
            <span class="credit-value">${generationCredits}</span>
            <span class="hidden sm:inline credit-label">кредитов</span>
        `;
    }
}

function showStatusError(message: string) { statusEl.innerHTML = `<span class="text-red-400">${message}</span>`; }

function displayErrorInContainer(container: HTMLElement, message: string, clearContainer = true) {
  if (clearContainer) container.innerHTML = '';
  const errorContainer = document.createElement('div');
  errorContainer.className = 'bg-red-900/20 border border-red-500/50 rounded-lg p-6 text-center flex flex-col items-center justify-center w-full';
  errorContainer.innerHTML = `<p class="text-red-300 text-lg">${message}</p>`;
  if (clearContainer) container.appendChild(errorContainer); else container.prepend(errorContainer);
}

function updateAllGenerateButtons() {
    // Logic previously tied to Page 1 photoshoot button state
}

async function renderHistoryPage() {
    const historyGallery = document.getElementById('history-gallery');
    if (!historyGallery || !db) return;
    historyGallery.innerHTML = `<div class="loading-spinner col-span-full mx-auto"></div>`;
    try {
        const images = await db.getAll('historyImages');
        images.sort((a, b) => b.timestamp - a.timestamp);
        if (images.length === 0) { historyGallery.innerHTML = `<p class="text-center col-span-full mt-8">История пуста.</p>`; return; }
        historyGallery.innerHTML = '';
        images.forEach(historyItem => {
            const imageUrl = `data:${historyItem.image.mimeType};base64,${historyItem.image.base64}`;
            const imgContainer = document.createElement('div');
            imgContainer.className = 'cursor-pointer gallery-item';
            const img = document.createElement('img'); img.src = imageUrl; img.className = 'w-full h-full object-cover block rounded-lg';
            imgContainer.appendChild(img);
            imgContainer.innerHTML += `<a href="${imageUrl}" download class="absolute bottom-2 right-2 bg-black bg-opacity-50 text-white p-2 rounded-full z-20"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" /></svg></a>`;
            imgContainer.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('a')) openLightbox(img.src); });
            historyGallery.appendChild(imgContainer);
        });
    } catch (error) { displayErrorInContainer(historyGallery, "Ошибка загрузки истории."); }
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
        if (pageId === 'page3') renderHistoryPage();
        else if (pageId === 'page-business') updateAllGenerateButtons();
    };
    navContainer.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-page]');
        if (button?.dataset.page) navigateToPage(button.dataset.page);
    });
    (window as any).navigateToPage = navigateToPage;
}

function setupUploader(containerId: string, inputId: string, previewId: string, placeholderId: string, clearButtonId: string, onStateChange: (state: ImageState | null, originalState?: ImageState | null) => Promise<void>) {
    const container = document.getElementById(containerId) as HTMLDivElement;
    const input = document.getElementById(inputId) as HTMLInputElement;
    const preview = document.getElementById(previewId) as HTMLImageElement;
    const placeholder = document.getElementById(placeholderId) as HTMLDivElement;
    const clearBtn = document.getElementById(clearButtonId) as HTMLButtonElement;
    if(!container) return;
    const handleFile = async (file: File) => {
        if (!file || !file.type.startsWith('image/')) return;
        try {
            const preResizedState = await preResizeImage(file);
            preview.src = `data:${preResizedState.mimeType};base64,${preResizedState.base64}`;
            preview.classList.remove('hidden'); placeholder.classList.add('hidden'); clearBtn.classList.remove('hidden');
            const finalResizedState = await resizeImage(preResizedState);
            preview.src = `data:${finalResizedState.mimeType};base64,${finalResizedState.base64}`;
            await onStateChange(finalResizedState, preResizedState);
        } catch (err) { showStatusError(err.message); input.value = ''; preview.src = ''; preview.classList.add('hidden'); placeholder.classList.remove('hidden'); clearBtn.classList.add('hidden'); }
    };
    container.addEventListener('click', (e) => { if (!(e.target as HTMLElement).closest(`#${clearButtonId}`)) input.click(); });
    input.addEventListener('change', () => { if (input.files?.[0]) handleFile(input.files[0]); });
    clearBtn.addEventListener('click', async () => { await onStateChange(null, null); input.value = ''; preview.src = ''; preview.classList.add('hidden'); placeholder.classList.remove('hidden'); clearBtn.classList.add('hidden'); });
}

const paymentSelectionView = document.querySelector('#payment-selection-view') as HTMLDivElement;
const paymentProcessingView = document.querySelector('#payment-processing-view') as HTMLDivElement;
const paymentProceedButton = document.querySelector('#payment-proceed-button') as HTMLButtonElement;

function showPaymentModal() {
    if (paymentModalOverlay) {
        paymentSelectionView.classList.remove('hidden');
        paymentProcessingView.classList.add('hidden');
        paymentModalOverlay.classList.remove('hidden');
    }
}

function hidePaymentModal() {
    paymentModalOverlay?.classList.add('hidden');
}

async function handlePayment() {
    if (paymentProceedButton.disabled) return;
    paymentProceedButton.disabled = true;
    paymentSelectionView.classList.add('hidden'); paymentProcessingView.classList.remove('hidden');
    try {
        const response = await callApi('/api/create-payment', { plan: selectedPaymentPlan });
        if (response.confirmationUrl) window.location.href = response.confirmationUrl;
    } catch (error) { showStatusError(error.message); paymentProcessingView.classList.add('hidden'); paymentSelectionView.classList.remove('hidden'); paymentProceedButton.disabled = false; }
}

function initializeBusinessPage() {
    const generateBtn = document.getElementById('generate-business-button') as HTMLButtonElement;
    const promptInput = document.getElementById('business-prompt-input') as HTMLTextAreaElement;
    const output = document.getElementById('business-output-gallery') as HTMLDivElement;
    const checkReady = () => {
        if (!generateBtn) return;
        const isReady = !!businessProductImage;
        if (generationCredits >= 4) {
            generateBtn.disabled = !isReady; generateBtn.innerHTML = `Создать (4 кр.) - Осталось: ${generationCredits}`;
        } else {
            generateBtn.disabled = false; generateBtn.innerHTML = isLoggedIn ? `Пополнить` : `Войти`;
        }
    };
    setupUploader('business-upload-product', 'business-input-product', 'business-preview-product', 'business-placeholder-product', 'business-clear-product', async (s) => { businessProductImage = s; checkReady(); });
    setupUploader('business-upload-ref1', 'business-input-ref1', 'business-preview-ref1', 'business-placeholder-ref1', 'business-clear-ref1', async (s) => { businessRefImage1 = s; });
    setupUploader('business-upload-ref2', 'business-input-ref2', 'business-preview-ref2', 'business-placeholder-ref2', 'business-clear-ref2', async (s) => { businessRefImage2 = s; });

    generateBtn.addEventListener('click', async () => {
        if (!isLoggedIn) { setWizardStep('AUTH'); return; }
        if (generationCredits < 4) { showPaymentModal(); return; }
        generateBtn.disabled = true; output.innerHTML = '<div class="loading-spinner mx-auto"></div>';
        try {
            const res = await callApi('/api/generateBusinessCard', { image: businessProductImage, refImages: [businessRefImage1, businessRefImage2].filter(Boolean), prompt: promptInput.value });
            const urls = await sliceGridImage(res.gridImageUrl.split(',')[1], 'image/png');
            generationCredits = res.newCredits; updateCreditCounterUI(); checkReady();
            output.innerHTML = '';
            urls.forEach(url => {
                const div = document.createElement('div'); div.className = 'gallery-item';
                div.innerHTML = `<img src="${url}" class="rounded-lg"/><a href="${url}" download class="absolute bottom-2 right-2 bg-black/50 p-2 rounded-full"><svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor"><path d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" /></svg></a>`;
                div.addEventListener('click', e => { if(!(e.target as HTMLElement).closest('a')) openLightbox(url); });
                output.appendChild(div);
            });
            await addToHistory(urls.map(url => ({ base64: url.split(',')[1], mimeType: 'image/png' })));
        } catch(e){ displayErrorInContainer(output, e.message); }
        finally { generateBtn.disabled = false; checkReady(); }
    });
    checkReady();
}

async function handleCredentialResponse(response: any) {
    try {
        const { userProfile: profile, credits } = await callApi('/api/login', { token: response.credential });
        localStorage.setItem('idToken', response.credential); idToken = response.credential;
        isLoggedIn = true; userProfile = profile; generationCredits = credits;
        updateAuthUI(); updateCreditCounterUI(); updateAllGenerateButtons();
        if (statusEl) statusEl.innerHTML = `<span class="text-green-400">Привет, ${profile.name}!</span>`;
    } catch (error) { signOut(); }
}

function updateAuthUI() {
    if (isLoggedIn && userProfile) {
        googleSignInContainer.classList.add('hidden'); userProfileContainer.classList.remove('hidden');
        userProfileImage.src = userProfile.picture; userProfileName.textContent = userProfile.name.split(' ')[0];
    } else {
        googleSignInContainer.classList.remove('hidden'); userProfileContainer.classList.add('hidden');
    }
}

async function setupGoogleAuth() {
    if (!googleSignInContainer) return;
    try {
        (window as any).google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: handleCredentialResponse });
        (window as any).google.accounts.id.renderButton(googleSignInContainer, { theme: "outline", size: "large", shape: "pill" });
        const storedToken = localStorage.getItem('idToken');
        if (storedToken) await handleCredentialResponse({ credential: storedToken });
    } catch (error) {}
}

document.addEventListener('DOMContentLoaded', async () => {
  lightboxOverlay = document.querySelector('#lightbox-overlay')!;
  lightboxImage = document.querySelector('#lightbox-image')!;
  lightboxCloseButton = document.querySelector('#lightbox-close-button')!;
  statusEl = document.querySelector('#status')!;
  paymentModalOverlay = document.querySelector('#payment-modal-overlay')!;
  paymentConfirmButton = document.querySelector('#payment-confirm-button')!;
  paymentCloseButton = document.querySelector('#payment-close-button')!;
  creditCounterEl = document.querySelector('#credit-counter')!;
  promoCodeInput = document.querySelector('#promo-code-input')!;
  applyPromoButton = document.querySelector('#apply-promo-button')!;
  googleSignInContainer = document.getElementById('google-signin-container') as HTMLDivElement;
  userProfileContainer = document.getElementById('user-profile-container') as HTMLDivElement;
  userProfileImage = document.getElementById('user-profile-image') as HTMLImageElement;
  userProfileName = document.getElementById('user-profile-name') as HTMLSpanElement;
  planSmallCard = document.getElementById('plan-small') as HTMLDivElement;
  planLargeCard = document.getElementById('plan-large') as HTMLDivElement;

  try {
    await initDB();
    const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true;
    script.onload = setupGoogleAuth; document.body.appendChild(script);
    setupNavigation(); initializeBusinessPage();
    lightboxOverlay.addEventListener('click', e => { if (e.target === lightboxOverlay) hideLightbox(); });
    lightboxCloseButton.addEventListener('click', hideLightbox);
    applyPromoButton.addEventListener('click', async () => {
        const code = promoCodeInput.value.trim(); if(!code) return;
        try {
            const res = await callApi('/api/apply-promo', { code });
            generationCredits = res.newCredits; updateCreditCounterUI(); updateAllGenerateButtons();
            statusEl.innerHTML = `<span class="text-green-400">${res.message}</span>`; promoCodeInput.value = '';
        } catch(e){ showStatusError(e.message); }
    });
    paymentCloseButton.addEventListener('click', hidePaymentModal);
    creditCounterEl.addEventListener('click', showPaymentModal);
    userProfileContainer.addEventListener('click', signOut);
    paymentProceedButton.addEventListener('click', handlePayment);
    planSmallCard.addEventListener('click', () => { selectedPaymentPlan = 'small'; planSmallCard.classList.add('selected'); planLargeCard.classList.remove('selected'); paymentProceedButton.innerText = 'Оплатить 129 ₽'; });
    planLargeCard.addEventListener('click', () => { selectedPaymentPlan = 'large'; planLargeCard.classList.add('selected'); planSmallCard.classList.remove('selected'); paymentProceedButton.innerText = 'Оплатить 500 ₽'; });
    (window as any).navigateToPage('page-business');
  } catch (error) { console.error(error); }
});
