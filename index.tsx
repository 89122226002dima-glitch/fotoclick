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

// --- Wizard State ---
type WizardStep = 'PAGE1_PHOTO' | 'PAGE1_CLOTHING' | 'PAGE1_LOCATION' | 'PAGE1_GENERATE' | 'PAGE2_PLAN' | 'PAGE2_GENERATE' | 'CREDITS' | 'NONE';

// --- DOM Element Variables (will be assigned on DOMContentLoaded) ---
let lightboxOverlay: HTMLDivElement, lightboxImage: HTMLImageElement, lightboxCloseButton: HTMLButtonElement, statusEl: HTMLDivElement,
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
let generationCredits = 0; // Default value, will be overwritten from localStorage
const PROMO_CODES: { [key: string]: { type: string; value: number; message: string } } = {
    "GEMINI_10": { type: 'credits', value: 10, message: "Вам начислено 10 кредитов!" },
    "FREE_SHOOT": { type: 'credits', value: 999, message: "Вы получили бесплатный доступ на эту сессию!" },
    "BONUS_5": { type: 'credits', value: 5, message: "Бонус! 5 кредитов добавлено." }
};

let poseSequences: {
    female: string[]; femaleGlamour: string[]; male: string[]; femaleCloseUp: string[]; maleCloseUp: string[];
    elderlyFemale: string[]; elderlyFemaleCloseUp: string[]; elderlyMale: string[];