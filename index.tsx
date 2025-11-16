// Fix: Declare google property on window to fix TypeScript errors
declare global {
    interface Window {
        google: any;
    }
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { openDB, IDBPDatabase } from 'idb';

// --- IndexedDB Configuration ---
const DB_NAME = 'FotoClickDB';
const DB_VERSION = 1;
const HISTORY_STORE = 'generationHistory';

const initDB = (): Promise<IDBPDatabase> => {
    return openDB(DB_NAME, DB_VERSION, {
        upgrade(db) {
            if (!db.objectStoreNames.contains(HISTORY_STORE)) {
                db.createObjectStore(HISTORY_STORE, { keyPath: 'id', autoIncrement: true });
            }
        },
    });
};


// Helper function to convert file to base64
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => {
            if (typeof reader.result === 'string') {
                resolve(reader.result.split(',')[1]);
            } else {
                reject(new Error('Error reading file as data URL.'));
            }
        };
        reader.onerror = (error) => reject(error);
    });
};

const App = () => {
    // App State
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    const [userProfile, setUserProfile] = useState(null);
    const [credits, setCredits] = useState(0);
    const [currentPage, setCurrentPage] = useState('photoshoot');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [successMessage, setSuccessMessage] = useState('');

    // --- Photoshoot State (Page 1) ---
    const [step, setStep] = useState(1);
    const [personImage, setPersonImage] = useState(null);
    const [clothingImage, setClothingImage] = useState(null);
    const [locationImage, setLocationImage] = useState(null);
    const [clothingText, setClothingText] = useState('');
    const [locationText, setLocationText] = useState('');
    const [photoshootResult, setPhotoshootResult] = useState(null);

    // --- Variations State (Page 2) ---
    const [referenceImage, setReferenceImage] = useState(null);
    const [variations, setVariations] = useState([]);

    // --- New Feature States ---
    const [history, setHistory] = useState([]);
    const [promoCode, setPromoCode] = useState('');
    const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
    const [lightboxImage, setLightboxImage] = useState<string | null>(null);


    const googleSignInContainerRef = useRef(null);
    
    // Function to clear messages after a delay
    const clearMessages = () => {
        setTimeout(() => {
            setError('');
            setSuccessMessage('');
        }, 4000);
    };

    // Cache Clearing Logic
    useEffect(() => {
        const clearCacheAndReload = async () => {
            try {
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    if (registrations.length > 0) {
                        console.log('Found active service workers, unregistering...');
                        for (const registration of registrations) {
                            await registration.unregister();
                        }
                    }
                }
                if (window.caches) {
                    const keys = await window.caches.keys();
                     if (keys.length > 0) {
                        console.log('Found caches, clearing...');
                        await Promise.all(keys.map(key => window.caches.delete(key)));
                    }
                }
            } catch (e) {
                console.error('Error during cache clearing:', e);
            }
        };
        clearCacheAndReload();
    }, []);
    
    // --- History DB Logic ---
    const saveToHistory = async (imageUrl: string, type: 'photoshoot' | 'variation') => {
        try {
            const db = await initDB();
            await db.add(HISTORY_STORE, { url: imageUrl, type, timestamp: new Date() });
            loadHistory(); // Refresh history state after saving
        } catch (dbError) {
            console.error('Failed to save to history:', dbError);
        }
    };

    const loadHistory = useCallback(async () => {
        try {
            const db = await initDB();
            const items = await db.getAll(HISTORY_STORE);
            setHistory(items.reverse().slice(0, 50)); // Get latest 50
        } catch (dbError) {
            console.error('Failed to load history:', dbError);
        }
    }, []);

    useEffect(() => {
        if (isLoggedIn) {
            loadHistory();
        }
    }, [isLoggedIn, loadHistory]);


    const handleCredentialResponse = async (response) => {
        setIsLoading(true);
        setError('');
        setSuccessMessage('');
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: response.credential }),
            });
            if (!res.ok) throw new Error(await res.json().then(e => e.error || 'Ошибка входа'));
            const data = await res.json();
            setUserProfile(data.userProfile);
            setCredits(data.credits);
            setIsLoggedIn(true);
            localStorage.setItem('google_id_token', response.credential);
        } catch (err) {
            setError(err.message);
            clearMessages();
        } finally {
            setIsLoading(false);
        }
    };
    
     useEffect(() => {
        const initializeGoogleSignIn = () => {
            if (window.google && googleSignInContainerRef.current) {
                window.google.accounts.id.initialize({
                    client_id: '455886432948-lk8a4f8922qikg1q8h3o76b0n6fpt3qa.apps.googleusercontent.com',
                    callback: handleCredentialResponse,
                });
                window.google.accounts.id.renderButton(
                    googleSignInContainerRef.current,
                    { theme: 'outline', size: 'large', type: 'standard', text: 'signin_with' }
                );
            }
        };

        if (document.getElementById('google-signin-script')) return;

        const script = document.createElement('script');
        script.id = 'google-signin-script';
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = initializeGoogleSignIn;
        document.body.appendChild(script);

        return () => {
            const scriptTag = document.getElementById('google-signin-script');
            if (scriptTag) {
                document.body.removeChild(scriptTag);
            }
        };
    }, []);

    const handleLogout = () => {
        setIsLoggedIn(false);
        setUserProfile(null);
        setCredits(0);
        setHistory([]);
        localStorage.removeItem('google_id_token');
        if (window.google) {
            window.google.accounts.id.disableAutoSelect();
        }
    };

    const handleImageUpload = (file: File, setImageFunc: (image: any) => void) => {
        if (!file) return;
        const reader = new FileReader();
        reader.onloadend = () => {
            if (typeof reader.result === 'string') {
                setImageFunc({
                    url: reader.result,
                    base64: reader.result.split(',')[1],
                    mimeType: file.type,
                    file: file
                });
            }
        };
        reader.readAsDataURL(file);
    };

    const handleApplyPromo = async () => {
        if (!promoCode.trim()) {
            setError('Введите промокод.');
            clearMessages();
            return;
        }
        setIsLoading(true);
        setError('');
        setSuccessMessage('');
        try {
            const token = localStorage.getItem('google_id_token');
            const res = await fetch('/api/apply-promo', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ code: promoCode }),
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Не удалось применить промокод.');
            }
            setCredits(data.newCredits);
            setSuccessMessage(data.message);
            setPromoCode('');
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
            clearMessages();
        }
    };

    const handleCreatePayment = async () => {
        setIsLoading(true);
        setError('');
        setSuccessMessage('');
        try {
            const token = localStorage.getItem('google_id_token');
            const res = await fetch('/api/create-payment', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Не удалось создать платеж.');
            }
            if (data.confirmationUrl) {
                window.location.href = data.confirmationUrl;
            }
        } catch (err) {
            setError(err.message);
            setIsLoading(false); // Only stop loading on error, success redirects
            clearMessages();
        }
    };


    const generateFourVariations = async () => {
        if (!referenceImage) {
            setError('Пожалуйста, загрузите референсное изображение.');
            clearMessages();
            return;
        }
        setIsLoading(true);
        setError('');
        setSuccessMessage('');
        setVariations([]);
        try {
            const prompts = await fetch('/prompts.json').then(res => res.json());
            let posePrompts;
            // Dummy logic for prompt selection
            posePrompts = prompts.femalePosePrompts;

            const selectedPrompts = [...posePrompts].sort(() => 0.5 - Math.random()).slice(0, 4);
            
            const token = localStorage.getItem('google_id_token');
            const res = await fetch('/api/generateFourVariations', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ prompts: selectedPrompts, image: { base64: referenceImage.base64, mimeType: referenceImage.mimeType } }),
            });

             const data = await res.json();
             if (!res.ok) {
                 throw new Error(data.error || 'Не удалось сгенерировать вариации.');
            }

            setVariations(data.imageUrls);
            setCredits(data.newCredits);
            for (const url of data.imageUrls) {
                await saveToHistory(url, 'variation');
            }
        } catch (err) {
            setError(err.message);
            clearMessages();
        } finally {
            setIsLoading(false);
        }
    };
    
    const generatePhotoshoot = async () => {
        if (!personImage) {
             setError('Пожалуйста, загрузите ваше фото.');
             clearMessages();
             return;
        }
         if (!clothingImage && !clothingText) {
             setError('Пожалуйста, загрузите фото одежды или опишите ее.');
             clearMessages();
             return;
        }
        if (!locationImage && !locationText) {
             setError('Пожалуйста, загрузите фото локации или опишите ее.');
             clearMessages();
             return;
        }
        
        setIsLoading(true);
        setError('');
        setSuccessMessage('');
        setPhotoshootResult(null);

        try {
            const token = localStorage.getItem('google_id_token');
            const parts = [];

            parts.push({ inlineData: { data: personImage.base64, mimeType: personImage.mimeType } });

            if(clothingText) parts.push({ text: `Одежда: ${clothingText}` });
            if(clothingImage) parts.push({ inlineData: { data: clothingImage.base64, mimeType: clothingImage.mimeType } });
            
            if(locationText) parts.push({ text: `Локация: ${locationText}` });
            if(locationImage) parts.push({ inlineData: { data: locationImage.base64, mimeType: locationImage.mimeType } });

            const res = await fetch('/api/generatePhotoshoot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ parts }),
            });
            
             const data = await res.json();
             if (!res.ok) {
                 throw new Error(data.error || 'Не удалось сгенерировать фотосессию.');
            }

            setPhotoshootResult(data.resultUrl);
            setCredits(data.newCredits);
            await saveToHistory(data.resultUrl, 'photoshoot');
            setStep(4);

        } catch (err) {
            setError(err.message);
            clearMessages();
        } finally {
            setIsLoading(false);
        }
    };

    const renderPage = () => {
        if (currentPage === 'photoshoot') return renderPhotoshootPage();
        if (currentPage === 'variations') return renderVariationsPage();
        if (currentPage === 'history') return renderHistoryPage();
    };
    
    const renderPhotoshootPage = () => (
      <div className="page-content">
        <h1 className="app-title">Фото-Клик: Фотосессия</h1>
        {step === 1 && (
          <div className="step-container">
            <h2>Шаг 1: Загрузите ваше фото</h2>
            <div className="uploader-box">
              <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files?.[0], setPersonImage)} />
              {personImage && <img src={personImage.url} alt="Person" style={{width: 100}}/>}
            </div>
            <button className="btn-primary" onClick={() => setStep(2)} disabled={!personImage}>Далее</button>
          </div>
        )}
        {step === 2 && (
          <div className="step-container">
            <h2>Шаг 2: Опишите или загрузите одежду</h2>
            <input type="text" value={clothingText} onChange={e => setClothingText(e.target.value)} placeholder="Например, элегантное черное платье" />
             <div className="uploader-box">
              <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files?.[0], setClothingImage)} />
              {clothingImage && <img src={clothingImage.url} alt="Clothing" style={{width: 100}}/>}
            </div>
            <button className="btn-primary" onClick={() => setStep(3)} disabled={!clothingImage && !clothingText}>Далее</button>
          </div>
        )}
        {step === 3 && (
          <div className="step-container">
            <h2>Шаг 3: Опишите или загрузите локацию</h2>
             <input type="text" value={locationText} onChange={e => setLocationText(e.target.value)} placeholder="Например, ночной город с неоновыми огнями" />
             <div className="uploader-box">
              <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files?.[0], setLocationImage)} />
              {locationImage && <img src={locationImage.url} alt="Location" style={{width: 100}}/>}
            </div>
            <button className="btn-primary" onClick={generatePhotoshoot} disabled={!locationImage && !locationText || isLoading}>
              {isLoading ? 'Генерация...' : `Создать фотосессию (${1} кредит)`}
            </button>
          </div>
        )}
        {step === 4 && photoshootResult && (
             <div className="step-container">
                <h2>Ваша фотосессия готова!</h2>
                <img src={photoshootResult} alt="Photoshoot Result" className="result-image" style={{maxWidth: '100%', borderRadius: '8px', cursor: 'pointer'}} onClick={() => setLightboxImage(photoshootResult)}/>
                <button className="btn-secondary" onClick={() => { setStep(1); setPhotoshootResult(null); }}>Начать заново</button>
            </div>
        )}
      </div>
    );
    
    const renderVariationsPage = () => (
         <div className="page-content">
            <h1 className="app-title">Фото-Клик: 4 Вариации</h1>
             <div className="step-container">
                <h2>Загрузите референсное изображение</h2>
                <div className="uploader-box">
                  <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files?.[0], setReferenceImage)} />
                  {referenceImage && <img src={referenceImage.url} alt="Reference" style={{width: 100}}/>}
                </div>
                <button className="btn-primary" onClick={generateFourVariations} disabled={!referenceImage || isLoading}>
                    {isLoading ? 'Генерация...' : `Создать 4 вариации (${4} кредита)`}
                </button>
             </div>
             {variations.length > 0 && (
                <div className="gallery">
                    <h2>Результаты</h2>
                    <div className="gallery-grid">
                       {variations.map((url, index) => <img key={index} src={url} alt={`Variation ${index+1}`} className="gallery-item" onClick={() => setLightboxImage(url)} />)}
                    </div>
                </div>
            )}
        </div>
    );

    const renderHistoryPage = () => (
        <div className="page-content">
            <h1 className="app-title">История Генераций</h1>
            <p style={{color: 'var(--font-color-dark)', marginBottom: '2rem'}}>Здесь хранятся 50 ваших последних генераций.</p>
            {history.length > 0 ? (
                <div className="gallery-grid" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))'}}>
                    {history.map((item: any) => (
                        <img key={item.id} src={item.url} alt="Generated image" className="gallery-item" onClick={() => setLightboxImage(item.url)} />
                    ))}
                </div>
            ) : (
                <p>Ваша история пока пуста. Создайте что-нибудь!</p>
            )}
        </div>
    );

    return (
        <div className="app-container">
            <header className="app-header">
                <div className="logo">Фото-Клик</div>
                <nav>
                    <button onClick={() => setCurrentPage('photoshoot')} className={`nav-button ${currentPage === 'photoshoot' ? 'active' : ''}`}>Фотосессия</button>
                    <button onClick={() => setCurrentPage('variations')} className={`nav-button ${currentPage === 'variations' ? 'active' : ''}`}>4 Вариации</button>
                    <button onClick={() => setCurrentPage('history')} className={`nav-button ${currentPage === 'history' ? 'active' : ''}`}>История</button>
                </nav>
                <div className="auth-controls">
                    {isLoggedIn && userProfile ? (
                        <div className="user-profile">
                            <div className="promo-container">
                                <input type="text" placeholder="Промокод" value={promoCode} onChange={e => setPromoCode(e.target.value)} className="promo-input" />
                                <button onClick={handleApplyPromo} className="promo-button">ОК</button>
                            </div>
                            <button id="credit-counter" title="Пополнить кредиты" onClick={() => setIsPaymentModalOpen(true)}>Кредиты: {credits}</button>
                            <img src={userProfile.picture} alt={userProfile.name} title={userProfile.name} />
                            <button onClick={handleLogout} className="btn-secondary">Выйти</button>
                        </div>
                    ) : (
                       <div id="google-signin-container" ref={googleSignInContainerRef}></div>
                    )}
                </div>
            </header>
            <main>
                {isLoading && <div className="loading-spinner"></div>}
                {error && <div className="message error-message">{error}</div>}
                {successMessage && <div className="message success-message">{successMessage}</div>}

                {!isLoggedIn ? (
                    <div className="login-prompt">
                        <h2>Добро пожаловать!</h2>
                        <p>Пожалуйста, войдите, чтобы начать создавать магию.</p>
                    </div>
                ) : renderPage()}
            </main>
             <footer className="app-footer">
                <p>Самозанятый: Кайгородов Дмитрий Николаевич | ИНН: 666002617267</p>
                <p>Для связи: WhatsApp +79292216920</p>
            </footer>

            {isPaymentModalOpen && (
                <div className="modal-overlay" onClick={() => setIsPaymentModalOpen(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <button onClick={() => setIsPaymentModalOpen(false)} className="modal-close-button">&times;</button>
                        <h2>Пополнить баланс</h2>
                        <p>Чтобы получить <strong>пакет '12 фотографий'</strong>, пожалуйста, произведите оплату.</p>
                        <div className="payment-box">
                            <p>Сумма к оплате</p>
                            <p className="price">79 ₽</p>
                        </div>
                        <button className="btn-primary" style={{width: '100%', marginTop: '1rem'}} onClick={handleCreatePayment} disabled={isLoading}>
                            {isLoading ? 'Перенаправляем...' : 'Перейти к оплате'}
                        </button>
                    </div>
                </div>
            )}

            {lightboxImage && (
                <div className="modal-overlay" onClick={() => setLightboxImage(null)}>
                    <div className="lightbox-content">
                        <img src={lightboxImage} alt="Увеличенное изображение" />
                    </div>
                     <button onClick={() => setLightboxImage(null)} className="modal-close-button lightbox-close">&times;</button>
                </div>
            )}
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);