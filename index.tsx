// Fix: Declare google property on window to fix TypeScript errors
declare global {
    interface Window {
        google: any;
    }
}

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom/client';
import { openDB } from 'idb';

// Helper function to convert file to base64
// Fix: Added a type check for reader.result before calling .split() to handle cases where it might not be a string.
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
    const [plan, setPlan] = useState('medium');

    const googleSignInContainerRef = useRef(null);

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
    

    const handleCredentialResponse = async (response) => {
        setIsLoading(true);
        setError('');
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

        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = initializeGoogleSignIn;
        document.body.appendChild(script);

        return () => {
            document.body.removeChild(script);
        };
    }, []);

    const handleLogout = () => {
        setIsLoggedIn(false);
        setUserProfile(null);
        setCredits(0);
        localStorage.removeItem('google_id_token');
        if (window.google) {
            window.google.accounts.id.disableAutoSelect();
        }
    };

    // Fix: Added a type check for reader.result before calling .split() to handle cases where it might not be a string.
    const handleImageUpload = (file: File, setImageFunc: (image: any) => void) => {
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

    const generateFourVariations = async () => {
        if (!referenceImage) {
            setError('Пожалуйста, загрузите референсное изображение.');
            return;
        }
        setIsLoading(true);
        setError('');
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

            if (!res.ok) {
                 const errorData = await res.json();
                 throw new Error(errorData.error || 'Не удалось сгенерировать вариации.');
            }

            const data = await res.json();
            setVariations(data.imageUrls);
            setCredits(data.newCredits);
        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };
    
    const generatePhotoshoot = async () => {
        if (!personImage) {
             setError('Пожалуйста, загрузите ваше фото.');
             return;
        }
         if (!clothingImage && !clothingText) {
             setError('Пожалуйста, загрузите фото одежды или опишите ее.');
             return;
        }
        if (!locationImage && !locationText) {
             setError('Пожалуйста, загрузите фото локации или опишите ее.');
             return;
        }
        
        setIsLoading(true);
        setError('');
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
            
             if (!res.ok) {
                 const errorData = await res.json();
                 throw new Error(errorData.error || 'Не удалось сгенерировать фотосессию.');
            }

            const data = await res.json();
            setPhotoshootResult(data.resultUrl);
            setCredits(data.newCredits);
            setStep(4);

        } catch (err) {
            setError(err.message);
        } finally {
            setIsLoading(false);
        }
    };

    const renderPage = () => {
        if (currentPage === 'photoshoot') {
            return renderPhotoshootPage();
        }
        if (currentPage === 'variations') {
            return renderVariationsPage();
        }
        // ... add history page later
    };
    
    // Simplified render functions for brevity
    const renderPhotoshootPage = () => (
      <div className="page-content">
        <h1 className="app-title">Фото-Клик: Фотосессия</h1>
        {/* Step 1: Upload Person */}
        {step === 1 && (
          <div className="step-container">
            <h2>Шаг 1: Загрузите ваше фото</h2>
            <div className="uploader-box">
              <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0], setPersonImage)} />
              {personImage && <img src={personImage.url} alt="Person" style={{width: 100}}/>}
            </div>
            <button className="btn-primary" onClick={() => setStep(2)} disabled={!personImage}>Далее</button>
          </div>
        )}
        {/* Step 2: Clothing */}
        {step === 2 && (
          <div className="step-container">
            <h2>Шаг 2: Опишите или загрузите одежду</h2>
            <input type="text" value={clothingText} onChange={e => setClothingText(e.target.value)} placeholder="Например, элегантное черное платье" />
             <div className="uploader-box">
              <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0], setClothingImage)} />
              {clothingImage && <img src={clothingImage.url} alt="Clothing" style={{width: 100}}/>}
            </div>
            <button className="btn-primary" onClick={() => setStep(3)} disabled={!clothingImage && !clothingText}>Далее</button>
          </div>
        )}
        {/* Step 3: Location */}
        {step === 3 && (
          <div className="step-container">
            <h2>Шаг 3: Опишите или загрузите локацию</h2>
             <input type="text" value={locationText} onChange={e => setLocationText(e.target.value)} placeholder="Например, ночной город с неоновыми огнями" />
             <div className="uploader-box">
              <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0], setLocationImage)} />
              {locationImage && <img src={locationImage.url} alt="Location" style={{width: 100}}/>}
            </div>
            <button className="btn-primary" onClick={generatePhotoshoot} disabled={!locationImage && !locationText || isLoading}>
              {isLoading ? 'Генерация...' : `Создать фотосессию (${1} кредит)`}
            </button>
          </div>
        )}
        {/* Step 4: Result */}
        {step === 4 && photoshootResult && (
             <div className="step-container">
                <h2>Ваша фотосессия готова!</h2>
                <img src={photoshootResult} alt="Photoshoot Result" className="result-image" style={{maxWidth: '100%', borderRadius: '8px'}}/>
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
                  <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e.target.files[0], setReferenceImage)} />
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
                       {variations.map((url, index) => <img key={index} src={url} alt={`Variation ${index+1}`} className="gallery-item" />)}
                    </div>
                </div>
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
                </nav>
                <div className="auth-controls">
                    {isLoggedIn && userProfile ? (
                        <div className="user-profile">
                            <span id="credit-counter">Кредиты: {credits}</span>
                            <img src={userProfile.picture} alt={userProfile.name} />
                            <button onClick={handleLogout} className="btn-secondary">Выйти</button>
                        </div>
                    ) : (
                       <div id="google-signin-container" ref={googleSignInContainerRef}></div>
                    )}
                </div>
            </header>
            <main>
                {isLoading && <div className="loading-spinner"></div>}
                {error && <div className="error-message">{error}</div>}
                {!isLoggedIn ? (
                    <div className="login-prompt">
                        <h2>Добро пожаловать!</h2>
                        <p>Пожалуйста, войдите, чтобы начать создавать магию.</p>
                    </div>
                ) : renderPage()}
            </main>
        </div>
    );
};

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);