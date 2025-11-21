function signOut() {
    localStorage.removeItem('idToken');
    window.location.reload();
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