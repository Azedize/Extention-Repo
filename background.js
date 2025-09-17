// ===========================
// 🔑 Constantes principales
// ===========================
const COMBINED_KEYS = `&rep`;
const PBKDF2_ITERATIONS = 100000;
const SALT_LEN = 16;
const IV_LEN = 12;
const KEY_LEN = 256; 

const processingTabs = {}; 


// ===========================
// 🔄 Fonctions utilitaires
// ===========================

// تحويل HEX → Uint8Array
function hexToBytes(hex) {
    console.log("🔹 hexToBytes reçu :", hex);
    if (hex.length % 2 !== 0) console.warn("⚠️ Longueur hex impaire :", hex.length);
    const bytes = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < bytes.length * 2; i += 2) {
        const byte = parseInt(hex.substr(i, 2), 16);
        if (isNaN(byte)) throw new Error("💥 Caractère hex invalide :" + hex.substr(i, 2));
        bytes[i / 2] = byte;
    }
    return bytes;
}




// Uint8Array → String
function bytesToString(bytes) {
    return new TextDecoder().decode(bytes);
}




// توليد المفتاح من كلمة مرور و salt
async function deriveKey(password, saltBytes) {
    const pwKey = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
        {
            name: "PBKDF2",
            hash: "SHA-256",
            salt: saltBytes,
            iterations: PBKDF2_ITERATIONS
        },
        pwKey,
        { name: "AES-GCM", length: KEY_LEN },
        false,
        ["decrypt", "encrypt"]
    );
    return key;
}



// فك تشفير AES-GCM
async function decryptAESGCM(password, hexPayload) {
    const payload = hexToBytes(hexPayload);
    const salt = payload.slice(0, SALT_LEN);
    const iv = payload.slice(SALT_LEN, SALT_LEN + IV_LEN);
    const data = payload.slice(SALT_LEN + IV_LEN); // ciphertext + tag

    const key = await deriveKey(password, salt);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return bytesToString(new Uint8Array(plainBuf));
}



// إرسال الرسائل للـ content script
function sendMessageToContentScript(tabId, message, onSuccess, onError) {
    chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
            if (onError) onError(chrome.runtime.lastError);
        } else {
            if (onSuccess) onSuccess(response);
        }
    });
}





// ===========================
// 🔍 Extraction des données depuis URL
// ===========================

async function extractProxyFromUrl(url, tabId, sendNow = true) {
    try {
        console.log("🔹 Début extractProxyFromUrl pour tabId:", tabId, "URL brute:", url);

        if (!url.startsWith("https://")) {
            console.log("⚠️ URL ne commence pas par https://, arrêt.");
            return null;
        }

        const decodedUrl = decodeURIComponent(url);
        console.log("🔹 URL après decodeURIComponent:", decodedUrl);

        let clean = decodedUrl.replace("https://", "").replace(".com", "").replace(/\//g, "");
        console.log("🧹 URL nettoyée:", clean);

        const keys = clean.match(/&[A-Za-z0-9]+/g) || [];
        console.log("🔑 Clés détectées:", keys);

        if (!keys.includes("&log")) {
            console.log("❌ Clé &Log non trouvée dans URL, arrêt du traitement");
            return null;
        }

        let hexPayload = clean;
        keys.forEach(k => { hexPayload = hexPayload.replace(k, ""); });
        console.log("🔐 Données chiffrées après retrait des clés:", hexPayload);

        const decrypted = await decryptAESGCM(
            "A9!fP3z$wQ8@rX7kM2#dN6^bH1&yL4t*",
            hexPayload
        );
        console.log("✅ Données déchiffrées:", decrypted);

        const parts = decrypted.split(";");
        console.log("🔹 Parts après split(';'):", parts);
        if (parts.length < 5) return null;

        const extraParts = parts.slice(4);
        if (extraParts.length === 0) return null;

        let dataToSend = {};
        if (extraParts.length === 1) dataToSend = { profile_email: extraParts[0] };
        else if (extraParts.length === 2) dataToSend = { profile_email: extraParts[0], profile_password: extraParts[1] };
        else dataToSend = { profile_email: extraParts[0], profile_password: extraParts[1], recovery_email: extraParts[2] };

        console.log("📤 Données préparées pour content script:", dataToSend);
        // enregistre data vers localStorage


        // ✅ Enregistrer les données dans chrome.storage.local
        await chrome.storage.local.set({ "currentData": dataToSend });
        console.log("💾 Données enregistrées:", dataToSend);

        return dataToSend;


    } catch (err) {
        console.error("💥 Erreur extractProxyFromUrl:", err);
        delete processingTabs[tabId];
        return null;
    }
}




function saveLog(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    const emojis = ["🔔"];
    const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
    chrome.storage.local.get({ logs: [] }, (data) => {
        const updatedLogs = [...(data.logs || []), `${randomEmoji} ${logMessage}`];
        chrome.storage.local.set({ logs: updatedLogs });
    });
}





chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    if (
        changeInfo.status === "complete" &&
        tab.url === "https://www.youtube.com/"
    ) {
        // saveLog("👺👺👺👺👺 [background] Changement détecté dans un onglet YouTube :", tabId);

        // 🔐 Lecture du local storage
        const { sentMessages } = await chrome.storage.local.get("sentMessages");

        if (sentMessages && sentMessages.length > 0) {
            // saveLog("📦👺 [background] Données 'sentMessages' trouvées :", sentMessages);
            await sleep(5000)

            // Ici vous pouvez faire des vérifications supplémentaires comme :
            const isMonitoredTab = sentMessages.some(item => item.TabId === tabId);

            if (isMonitoredTab) {
                // saveLog("✅👺 [background] L'onglet correspond à un ID enregistré. Exécution des actions...");

                // Exemple : fermeture de l'onglet, suppression du stockage, etc.
                try {
                    await chrome.tabs.remove(tabId);
                    // saveLog("🛑👺 Onglet fermé :", tabId);

                    await chrome.storage.local.remove("sentMessages");
                    // saveLog("🧼👺 Clé 'sentMessages' supprimée.");

                    if (callerTabId_CheckLoginYoutube) {
                        await chrome.tabs.sendMessage(callerTabId_CheckLoginYoutube, {
                            action: "Closed_tab_Finished_CheckLoginYoutube"
                        });
                        // saveLog("📨👺 Message envoyé à l'onglet d'origine.");
                    }

                    // Réinitialisation
                    currentMapTabId_CheckLoginYoutube = null;
                    callerTabId_CheckLoginYoutube = null;
                    originalTabIds_CheckLoginYoutube = [];

                    // saveLog("♻️👺 Variables réinitialisées.");

                } catch (err) {
                    saveLog("❌👺 Erreur lors de la fermeture ou du nettoyage :", err);
                }
            } else {
                saveLog("⚠️👺 [background] L'onglet ne correspond pas à ceux surveillés.");
            }
        } else {
            saveLog("📭👺 [background] Aucun 'sentMessages' trouvé dans le stockage local.");
        }
    }
});







chrome.tabs.onCreated.addListener(async (tab) => {

    const url = tab.pendingUrl || tab.url;

    // إذا كان هناك تاب قيد المعالجة بالفعل، تجاهله
    if (processingTabs[tab.id]) return;

    processingTabs[tab.id] = true;
    console.log("🚀 Nouvel onglet détecté pour traitement:", tab.id);

    // استخراج البيانات بدون إرسال
    const dataToSend = await extractProxyFromUrl(url, tab.id, false);
    if (!dataToSend) {
        delete processingTabs[tab.id];
        return;
    }

    console.log("✅ URL valide détectée, إيقاف مراقبة التابات الأخرى مؤقتاً");

    // إيقاف أي مراقبة مستقبلية للتابات الأخرى
    chrome.tabs.onCreated.hasListener && chrome.tabs.onCreated.removeListener();

    // فتح تاب جديد على Google Accounts
    chrome.tabs.create({ url: "https://accounts.google.com/" }, (newTab) => {
        console.log("📂 Nouveau tab créé:", newTab.id);

        // إغلاق جميع التابات القديمة باستثناء التاب الجديد
        chrome.tabs.query({}, (tabs) => {
            tabs.forEach(t => {
                if (t.id !== newTab.id) {
                    chrome.tabs.remove(t.id, () => {
                        console.log("🗑️ Tab fermé:", t.id);
                    });
                }
            });
        });

        // انتظار تحميل التاب الجديد ثم إرسال البيانات
        chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
            if (tabId === newTab.id && changeInfo.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                console.log("✅ Tab nouveau complètement chargé:", newTab.id);

                sendMessageToContentScript(newTab.id, { action: "startProcess", ...dataToSend },
                    () => {
                        console.log("📩 Données envoyées au content script:", newTab.id);
                        delete processingTabs[newTab.id];
                    },
                    (err) => {
                        console.error("❌ Erreur en envoyant les données:", newTab.id, err);
                        delete processingTabs[newTab.id];
                    }
                );
            }
        });
    });
});




// chrome.runtime.onInstalled.addListener(() => {
//     setTimeout(() => {
//         chrome.tabs.create({ url: "https://accounts.google.com/" });
//     }, 4000); // تأخير 4 ثواني
// });


// chrome.runtime.onInstalled.addListener(() => {
//     chrome.tabs.query({ url: "*://mail.google.com/*" }, (tabs) => {
//         tabs.forEach((tab) => {
//             chrome.tabs.reload(tab.id);
//         });
//     });
// });









// let oldTab = null;

// function createNewTab(url, onComplete) {
    
//     chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
//         if (tabs.length > 0) {
//             oldTab = tabs[0];
//         }
//     });

//     chrome.tabs.create({ url }, (tab) => {

//         chrome.tabs.onUpdated.addListener(function listener(tabId, changeInfo) {
//             if (tabId === tab.id && changeInfo.status === "complete") {
//                 chrome.tabs.onUpdated.removeListener(listener);
//                 onComplete(tab); 
//             }
//         });
//     });
// }






// chrome.webNavigation.onCompleted.addListener((details) => {
//     console.log("➡️ Navigation completed:", details);

//     // 1️⃣ استخراج الرابط
//     const url = details.url; // ✅ نستعمل فقط details.url
//     if (!url) {
//         console.log("⚠️ Aucun URL détecté.");
//         return;
//     }


//     // 3️⃣ الروابط المستبعدة (Ignorés)
//     const ignoredUrls = [
//         "https://contacts.google.com",
//         "https://www.google.com/maps",
//         "https://trends.google.com/trends/"
//     ];

//     if (ignoredUrls.some(prefix => url.startsWith(prefix))) {
//         console.log("🚫 URL ignorée (commence par un prefix exclu):", url);
//         return;
//     }

  
//     const monitoredPatterns = [
//         "https://mail.google.com/mail",
//         "https://workspace.google.com/",
//         "https://accounts.google.com/",
//         "https://accounts.google.com/signin/v2/",
//         "https://myaccount.google.com/security",
//         "https://gds.google.com/",
//         "https://myaccount.google.com/interstitials/birthday",
//         "https://gds.google.com/web/recoveryoptions",
//         "https://gds.google.com/web/homeaddress"
//     ];

//     const shouldProcess = (
//         monitoredPatterns.some(part => url.includes(part)) ||
//         url === "chrome://newtab/"
//     );

//     // 5️⃣ إذا الرابط يطابق النمط المطلوب
//     if (shouldProcess) {
//         console.log("✅ URL correspond au modèle surveillé:", url);

//         // 6️⃣ التحقق إذا كان التاب قيد المعالجة
//         if (processingTabs[details.tabId]) {
//             console.log("⏳ Onglet déjà en cours de traitement, skip:", details.tabId);
//             return;
//         }

//         console.log("🚀 Démarrage du processus pour le tab:", details.tabId);
//         processingTabs[details.tabId] = true;

//         // 7️⃣ إرسال رسالة إلى content script
//         sendMessageToContentScript(
//             details.tabId,
//             { action: "startProcess" },
//             (response) => {
//                 console.log("📩 Réponse reçue du content script pour tab:", details.tabId, "➡️", response);

//                 // 🧹 تنظيف بعد المعالجة
//                 setTimeout(() => {
//                     console.log("🧹 Nettoyage du tab:", details.tabId);
//                     delete processingTabs[details.tabId];
//                 }, 5000);
//             },
//             (error) => {
//                 console.log("❌ Erreur pendant traitement tab:", details.tabId, "⚡", error);

//                 // 🧹 تنظيف في حالة خطأ
//                 delete processingTabs[details.tabId];
//             }
//         );

//     } else {
//         console.log("🔍 URL ne correspond à aucun modèle surveillé:", url);
//     }
// });





chrome.webNavigation.onCompleted.addListener(async (details) => {

    console.log("➡️ Navigation completed pour tabId:",  details.tabId, "URL:", details.url);

    const ignoredUrls = [
        "https://contacts.google.com",
        "https://www.google.com/maps",
        "https://trends.google.com/trends/"
    ];

    const monitoredPatterns = [
        "https://mail.google.com/mail",
        "https://workspace.google.com/",
        "https://accounts.google.com/",
        "https://accounts.google.com/signin/v2/",
        "https://myaccount.google.com/security",
        "https://gds.google.com/",
        "https://myaccount.google.com/interstitials/birthday",
        "https://gds.google.com/web/recoveryoptions",
        "https://gds.google.com/web/homeaddress"
    ];

    if (ignoredUrls.some(prefix => details.url.startsWith(prefix))) {
        console.log("🚫 URL ignored (startsWith match):", details.url);
        return;
    }

    // Récupérer les données depuis localStorage en utilisant la clé constante
    const storedDataJson = await chrome.storage.local.get("currentData");
    const dataToSend = storedDataJson["currentData"];

    if (!dataToSend) {
        console.warn("⚠️ Pas de données stockées, contenu actuel du storage:", storedDataJson);
        return;
    }

    // Vérifier que l'URL est surveillée
    let shouldProcess = false;
    for (const part of monitoredPatterns) {
        console.log(`🔹 Vérification pattern: "${part}" avec URL: "${details.url}"`);
        if (details.url.includes(part) || details.url.startsWith(part)) {
            console.log(`✅ URL matched pour le pattern: "${part}"`);
            shouldProcess = true;
            break;
        }
    }
    if (details.url === "chrome://newtab/") {
        shouldProcess = true;
        console.log("✅ URL is a new tab");
    }

    if (!shouldProcess) {
        console.log("⚠️ URL did not match any monitored pattern:", details.url);
        return;
    }

    // Avoid processing same tab twice
    if (processingTabs[details.tabId]) {
        console.log("⚠️ Tab already being processed, skipping:", details.tabId);
        return;
    }

    processingTabs[details.tabId] = true;

    sendMessageToContentScript(
        details.tabId,
        { action: "startProcess", ...dataToSend },
        (response) => {
            console.log("📩 Process response received for tab:", details.tabId, "Response:", response);
            delete processingTabs[details.tabId];
        },
        (error) => {
            console.error("❌ Error during processing tab:", details.tabId, "Error:", error);
            delete processingTabs[details.tabId];
        }
    );

    // Async sleep example
    await new Promise(resolve => setTimeout(resolve, 5000));
});






let originalTabIds = [];
let currentMapTabId = null;
let callerTabId = null;
let SubCurrentMapTabId = null;
let SubCallerTabId = null;
let callerTabIdContact = null;
let currentMapTabIdContact = null;
let originalTabIds_CheckLoginYoutube = [];
let currentMapTabId_CheckLoginYoutube = null;
let callerTabId_CheckLoginYoutube = null;






chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {



        if (message.action === "Open_tab_CheckLoginYoutube") {
            const senderTabId = sender.tab ? sender.tab.id : null;

            chrome.tabs.query({}, (tabs_CheckLoginYoutube) => {

                originalTabIds_CheckLoginYoutube = tabs_CheckLoginYoutube.map(tab => tab.id);
                // saveLog("📌 Identifiants originaux des onglets sauvegardés :", originalTabIds_CheckLoginYoutube);

                callerTabId_CheckLoginYoutube = senderTabId;

                chrome.tabs.create({ url: message.url }, (newTab_CheckLoginYoutube) => {
                    currentMapTabId_CheckLoginYoutube = newTab_CheckLoginYoutube.id;
                    // saveLog("🗺️ [background] Google Maps ouvert dans l’onglet :", currentMapTabId_CheckLoginYoutube);

                    setTimeout(() => {
                        chrome.scripting.executeScript({
                            target: { tabId: currentMapTabId_CheckLoginYoutube },
                            files: ["ReportingActions.js"]
                        }, async () => {
                            // saveLog("📤 [background] Script 'ReportingActions.js' injecté.");

                            const tabFermer = {
                                TabId: currentMapTabId_CheckLoginYoutube
                            };

                            chrome.storage.local.get("sentMessages", (result) => {
                                const existingLogs = result.sentMessages || [];
                                existingLogs.push(tabFermer);

                                chrome.storage.local.set({ sentMessages: existingLogs }, () => {
                                    chrome.tabs.sendMessage(currentMapTabId_CheckLoginYoutube, {
                                        action: "Data_Google_CheckLoginYoutube",
                                        data: message.saveLocationData
                                    }, (response) => {
                                        if (chrome.runtime.lastError) {
                                            // saveLog("⚠️🤡 [étape 8] Log d’erreur enregistré dans le stockage local.");
                                            saveLog("❌ [background] Erreur lors de l’envoi :", chrome.runtime.lastError.message);
                                        } else {
                                            // saveLog("✅ [background] Données envoyées à ReportingActions.js :", response);
                                            console.log("")
                                        }
                                    });
                                });
                            });
                        });
                    }, 3000);
                });
            });
        }



        if (message.action ===  "Closed_tab_CheckLoginYoutube"){
            setTimeout(() => {
                if (currentMapTabId_CheckLoginYoutube !== null) {

                    if (callerTabId_CheckLoginYoutube !== null) {
                        chrome.tabs.sendMessage(callerTabId_CheckLoginYoutube, { action: "Closed_tab_Finished_CheckLoginYoutube" }, (response) => {
                            if (chrome.runtime.lastError) {
                                saveLog(`❌ [background] Échec de l'envoi de Closed_tab_Finished_CheckLoginYoutube :`, chrome.runtime.lastError.message);
                            } else {
                                // saveLog(`📤 [background] Message Closed_tab_Finished_CheckLoginYoutube envoyé à l'onglet ${callerTabId_CheckLoginYoutube} avec succès.`);
                                console.log("")
                            }
                        });
                    } else {
                        saveLog("⚠️ [background] Aucun onglet appelant trouvé pour envoyer le message.");
                    }

                    chrome.tabs.remove(currentMapTabId_CheckLoginYoutube, () => {
                        if (chrome.runtime.lastError) {
                            saveLog("❌ Erreur lors de la fermeture de l’onglet Youtube :", chrome.runtime.lastError.message);
                            return;
                        }

                        // saveLog(`🛑 Onglet Youtube fermé (ID=${currentMapTabId_CheckLoginYoutube})`);
                        currentMapTabId_CheckLoginYoutube = null;
                        callerTabId_CheckLoginYoutube = null;

                        // Nettoyage des onglets nouveaux
                        chrome.tabs.query({}, (tabsNow) => {
                            const currentIds = tabsNow.map(t => t.id);
                            const newTabs = currentIds.filter(id => !originalTabIds_CheckLoginYoutube.includes(id));

                            // saveLog("🧹 Fermeture des onglets nouveaux :", newTabs);

                            newTabs.forEach((tabId) => {
                                chrome.tabs.remove(tabId, () => {
                                    if (chrome.runtime.lastError) {
                                        saveLog(`⚠️ Échec fermeture onglet ID=${tabId} :`, chrome.runtime.lastError.message);
                                    } else {
                                        // saveLog(`✅ Onglet fermé ID=${tabId}`);
                                        console.log("")

                                    }
                                });
                            });

                            // Vider la liste des onglets originaux
                            originalTabIds_CheckLoginYoutube = [];
                        });
                    });

                } else {
                    saveLog("⚠️ [background] Onglet Youtube non défini.");
                }
            }, 3000);

        }




        if (message.action === "Open_tab") {

            chrome.tabs.query({}, function(tabs) {
                originalTabIds = tabs.map(tab => tab.id);  // ✅ هذا السطر يجب أن يكون هنا داخل هذه الدالة
                console.log("📌 تم حفظ المعرفات الأصلية للتابات:", originalTabIds);

                // الآن يمكنك تنفيذ باقي الكود مثل فتح التاب الجديد
            });
            console.log("📌 Tab IDs enregistrés avant l'ouverture :", originalTabIds);

            callerTabId = sender.tab ? sender.tab.id : null;

            chrome.tabs.create({ url:  message.url}, (tab) => {
                currentMapTabId = tab.id;
                console.log("🗺️ [background] Google Maps a été ouvert dans l’onglet :", tab.id);

                setTimeout(() => {
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ["ReportingActions.js"]
                    }, () => {
                        console.log("📤 [background] Le script 'ReportingActions.js' a été injecté dans l’onglet.");

                        // ✅ بعد الحقن، نرسل البيانات إلى هذا التاب
                        chrome.tabs.sendMessage(tab.id, {
                            action: "Data_Google",
                            data: message.saveLocationData
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                saveLog("❌ [background] Erreur lors de l’envoi du message à ReportingActions.js :", chrome.runtime.lastError.message);
                            } else {
                                console.log("✅ [background] Les données ont été envoyées à ReportingActions.js :", response);
                                console.log("")
                            }
                        });
                    });
                }, 1000);
            });
        }





        if (message.action === "Sub_Open_tab") {
            // saveLog("🧡​🧡​🧡​🧡​ [background] Sub_Open_tab action received with URL:", message.url);

            // chrome.tabs.query({}, function(tabs) {
            //     originalTabIds = tabs.map(tab => tab.id);  // ✅ هذا السطر يجب أن يكون هنا داخل هذه الدالة
            //     saveLog("📌 تم حفظ المعرفات الأصلية للتابات:", originalTabIds);

            //     // الآن يمكنك تنفيذ باقي الكود مثل فتح التاب الجديد
            // });
            // saveLog("📌 Tab IDs enregistrés avant l'ouverture :", originalTabIds);

            SubCallerTabId = sender.tab ? sender.tab.id : null;

            chrome.tabs.create({ url:  message.url}, (tab) => {
                SubCurrentMapTabId = tab.id;
                // saveLog("🗺️ [background] Youtube a été ouvert dans l’onglet :", tab.id);

                setTimeout(() => {
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ["ReportingActions.js"]
                    }, () => {
                        // saveLog("📤 [background] Le script 'ReportingActions.js' a été injecté dans l’onglet.");

                        // ✅ بعد الحقن، نرسل البيانات إلى هذا التاب
                        chrome.tabs.sendMessage(tab.id, {
                            action: "Sub_Data_Google",
                            data: message.saveLocationData
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                saveLog("❌ [background] Erreur lors de l’envoi du message à ReportingActions.js :", chrome.runtime.lastError.message);
                            } else {
                                // saveLog("✅ [background] Les données ont été envoyées à ReportingActions.js :", response);
                                console.log("")

                            }
                        });
                    });
                }, 1000);
            });
        }





        if (message.action === "Closed_tab") {
            // نفس الانتظار 8 ثواني كما قبل
            setTimeout(() => {
                if (currentMapTabId !== null) {
                    // أرسل الرسالة إلى التاب القديم فقط
                    if (callerTabId !== null) {
                        chrome.tabs.sendMessage(callerTabId, { action: "Closed_tab_Finished" }, (response) => {
                            if (chrome.runtime.lastError) {
                                saveLog(`❌ [background] فشل إرسال Closed_tab_Finished إلى التاب القديم:`, chrome.runtime.lastError.message);
                            } else {
                                console.log(`📤 [background] تم إرسال Closed_tab_Finished إلى التاب القديم بنجاح`);
                                // console.log("")

                            }
                            // بعد الإرسال، أغلق تاب Google Maps
                            chrome.tabs.remove(currentMapTabId, () => {
                                console.log(`🛑 تم إغلاق تاب Google Maps (ID=${currentMapTabId})`);
                                currentMapTabId = null;
                                callerTabId = null; // إعادة تعيين
                                chrome.tabs.query({}, function(tabsNow) {
                                        const currentIds = tabsNow.map(t => t.id);
                                        const newTabs = currentIds.filter(id => !originalTabIds.includes(id));

                                        console.log("🧹 سيتم إغلاق التابات الجديدة:", newTabs);

                                        // إغلاق كل تاب جديد
                                        newTabs.forEach(tabId => {
                                            chrome.tabs.remove(tabId, () => {
                                                console.log(`✅ تم إغلاق التاب الجديد ID=${tabId}`);
                                                // console.log("")

                                            });
                                        });

                                        originalTabIds = []; // نعيد التهيئة
                                });
                            });

                        });

                    } else {
                        saveLog("⚠️ [background] لا يوجد تبويب قديم لإرسال رسالة له");
                        // حتى لو لم يكن هناك تاب قديم، أغلق تاب Google Maps
                        chrome.tabs.remove(currentMapTabId, () => {
                            console.log(`🛑 تم إغلاق تاب Google Maps (ID=${currentMapTabId})`);
                            currentMapTabId = null;
                        });
                

                    }
                } else {
                    console.log("⚠️ [background] التاب Google Maps غير موجود");
                }
            }, 4000);

            return true;
        }





        if (message.action === "Sub_Closed_tab") {
            // نفس الانتظار 8 ثواني كما قبل
            setTimeout(() => {
                if (SubCurrentMapTabId !== null) {
                    // أرسل الرسالة إلى التاب القديم فقط
                    if (SubCallerTabId !== null) {
                        chrome.tabs.sendMessage(SubCallerTabId, { action: "Sub_Closed_tab_Finished" }, (response) => {
                            if (chrome.runtime.lastError) {
                                saveLog(`❌ [background] فشل إرسال Sub_Closed_tab_Finished إلى التاب القديم:`, chrome.runtime.lastError.message);
                            } else {
                                // saveLog(`📤 [background] تم إرسال Sub_Closed_tab_Finished إلى التاب القديم بنجاح`);
                                console.log("")

                            }
                            // بعد الإرسال، أغلق تاب Google Maps
                            chrome.tabs.remove(SubCurrentMapTabId, () => {
                                // saveLog(`🛑 تم إغلاق تاب Youtube (ID=${SubCurrentMapTabId})`);
                                SubCurrentMapTabId = null;
                                SubCallerTabId = null; // إعادة تعيين
                            //     chrome.tabs.query({}, function(tabsNow) {
                            //             const currentIds = tabsNow.map(t => t.id);
                            //             const newTabs = currentIds.filter(id => !originalTabIds.includes(id));
                            //             saveLog("🧹 سيتم إغلاق التابات الجديدة:", newTabs);
                            //             // إغلاق كل تاب جديد
                            //             newTabs.forEach(tabId => {
                            //                 chrome.tabs.remove(tabId, () => {
                            //                     saveLog(`✅ تم إغلاق التاب الجديد ID=${tabId}`);
                            //                 });
                            //             });

                            //             originalTabIds = []; // نعيد التهيئة
                            //     });
                            });

                        });

                    } else {
                        // saveLog("⚠️ [background] لا يوجد تبويب قديم لإرسال رسالة له");
                        // حتى لو لم يكن هناك تاب قديم، أغلق تاب Google Maps
                        chrome.tabs.remove(SubCurrentMapTabId, () => {
                            // saveLog(`🛑 تم إغلاق تاب Youtube (ID=${SubCurrentMapTabId})`);
                            SubCurrentMapTabId = null;
                        });
                

                    }
                } else {
                    saveLog("⚠️ [background] التاب Youtube غير موجود");
                }
            }, 3000);

            return true;
        }






        if (message.action === "Open_tab_Add_Contact") {

            callerTabIdContact = sender.tab ? sender.tab.id : null;

            chrome.tabs.create({ url: message.url }, (tab) => {
                currentMapTabIdContact = tab.id;
                // saveLog("🗺️ [background] Google Contacts a été ouvert dans l’onglet :", tab.id);

                setTimeout(() => {
                    chrome.scripting.executeScript({
                        target: { tabId: tab.id },
                        files: ["ReportingActions.js"]
                    }, () => {
                        // saveLog("📤 [background] Le script 'ReportingActions.js' a été injecté dans l’onglet.");

                        // ✅ Envoi des données après injection
                        chrome.tabs.sendMessage(tab.id, {
                            action: "Data_Google_Add_Contact",
                            data: message.saveLocationData,
                            email: message.email
                        }, (response) => {
                            if (chrome.runtime.lastError) {
                                saveLog("❌ [background] Erreur lors de l’envoi du message à ReportingActions.js :", chrome.runtime.lastError.message);
                            } else {
                                // saveLog("✅ [background] Les données ont été envoyées à ReportingActions.js :", response);
                                console.log("")

                            }
                        });
                    });
                }, 1000);
            });
        }




        if (message.action === "Closed_tab_Add_Contact") {
            // تأخير مثل العادة (مثلاً للانتظار بعد العمليات)
            setTimeout(() => {
                if (currentMapTabIdContact !== null) {
                    // أرسل رسالة إلى التاب القديم إذا موجود
                    if (callerTabIdContact !== null) {
                        chrome.tabs.sendMessage(callerTabIdContact, { action: "Closed_tab_Finished_Add_Contact" }, (response) => {
                            if (chrome.runtime.lastError) {
                                saveLog(`❌ [background] فشل إرسال Closed_tab_Finished_Add_Contact إلى التاب القديم:`, chrome.runtime.lastError.message);
                            } else {
                                // saveLog(`📤 [background] تم إرسال Closed_tab_Finished_Add_Contact إلى التاب القديم بنجاح`);
                                console.log("")

                            }

                            // بعد الإرسال، نغلق تاب Google Contacts فقط (بدون أي تنظيف إضافي)
                            chrome.tabs.remove(currentMapTabIdContact, () => {
                                // saveLog(`🛑 تم إغلاق تاب Google Contacts (ID=${currentMapTabIdContact})`);
                                console.log("")
                                currentMapTabIdContact = null;
                                callerTabIdContact = null; // إعادة تعيين
                            });

                        });

                    } else {
                        // saveLog("⚠️ [background] لا يوجد تبويب قديم لإرسال رسالة له");
                        // نغلق التاب مباشرة
                        chrome.tabs.remove(currentMapTabIdContact, () => {
                            // saveLog(`🛑 تم إغلاق تاب Google Contacts (ID=${currentMapTabIdContact})`);
                            console.log("")
                            currentMapTabIdContact = null;
                        });
                    }

                } else {
                    saveLog("⚠️ [background] التاب Google Contacts غير موجود");
                }
            }, 3000);

            return true;
        }



});










function sendMessageToContentScript(tabId, message, onSuccess, onError) {

    chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
            if (onError) onError(chrome.runtime.lastError);
        } else {
            if (onSuccess) onSuccess(response);
        }
    });
}







// function configureProxyDirectly(host, port, user, pass) {

//     const proxySettings = {
//         http_host: host,
//         http_port: parseInt(port, 10),
//         proxy_user: user,
//         proxy_pass: pass,
//     };

//     chrome.storage.local.set({ proxySetting: proxySettings }, () => {        
//         applyProxySettings(proxySettings);
//     });

// }





// function applyProxySettings(proxySetting) {
//     // تغيير bypassList لاستثناء الطلبات المحلية
//     chrome.proxy.settings.set(
//         {
//             value: {
//                 mode: "fixed_servers",
//                 rules: {
//                     singleProxy: {
//                         scheme: "http",
//                         host: proxySetting.http_host,
//                         port: proxySetting.http_port
//                     },
//                     bypassList: ["<local>"] // تم التغيير هنا
//                 }
//             },
//             scope: "regular"
//         },
//         () => {
//             // saveLog("Proxy applied");
//             console.log("")

//         }
//     );

//     // إعادة كتابة onAuthRequired للتأكد من استدعاء callback بشكل فوري
//     chrome.webRequest.onAuthRequired.addListener(
//         function (details, callback) {
//             saveLog("Auth required – responding with credentials");
//             // استدعاء callback على الفور مع بيانات الاعتماد
//             callback({
//                 authCredentials: {
//                     username: proxySetting.proxy_user,
//                     password: proxySetting.proxy_pass
//                 }
//             });
//         },
//         { urls: ["<all_urls>"] },
//         ["asyncBlocking"]
//     );
// }





    

let badProxyFileDownloaded = false; 





// chrome.webRequest.onErrorOccurred.addListener(
//     (details) => {
//         saveLog("▶ حدث onErrorOccurred");
//         saveLog("تفاصيل الخطأ:", details);

//         if (
//             details.error.includes("ERR_PROXY_CONNECTION_FAILED") || 
//             details.error.includes("ERR_TUNNEL_CONNECTION_FAILED") ||
//             details.error.includes("ERR_TOO_MANY_RETRIES")
//         ) {
//             saveLog("⚠ تم الكشف عن خطأ متعلق بالبروكسي:", details.error);
            
//             if (!badProxyFileDownloaded) {
//                 saveLog("ℹ لم يتم تنزيل ملف البروكسي السيئ بعد، سيتم الآن استدعاء الدالة openNewTabAndDownloadFile");
//                 openNewTabAndDownloadFile("bad_proxy");
//                 badProxyFileDownloaded = true; 
//                 saveLog("✔ تم تعيين متغير badProxyFileDownloaded إلى true");
//             } else {
//                 saveLog("ℹ تم تنزيل ملف البروكسي السيئ مسبقًا، لن يتم استدعاء openNewTabAndDownloadFile مرة أخرى");
//             }
//         } else {
//             saveLog("ℹ الخطأ المبلغ عنه لا يتطابق مع أخطاء البروكسي المحددة:", details.error);
//         }
//     },
//     { urls: ["<all_urls>"] }
// );

chrome.webRequest.onErrorOccurred.addListener(
    (details) => {
        saveLog("▶ Événement onErrorOccurred détecté");
        saveLog("📌 Détails de l'erreur :", details);

        // Vérification des erreurs liées au proxy ou à la connexion
        if (
            details.error.includes("ERR_PROXY_CONNECTION_FAILED") ||  // Le proxy n’est pas accessible ou l'adresse est invalide
            details.error.includes("ERR_TUNNEL_CONNECTION_FAILED") || // Impossible d'établir un tunnel HTTPS via le proxy
            details.error.includes("ERR_PROXY_AUTH_FAILED") ||        // Échec d'authentification (mauvais identifiant/mot de passe) avec le proxy
            details.error.includes("ERR_TOO_MANY_RETRIES") ||         // Trop de tentatives de connexion via le proxy, sans succès
            details.error.includes("ERR_CONNECTION_RESET") ||         // La connexion a été réinitialisée (coupée brutalement) par le proxy ou le serveur
            details.error.includes("ERR_CONNECTION_REFUSED") ||       // Le proxy ou le serveur refuse la connexion
            details.error.includes("ERR_TIMED_OUT") ||                // Temps d’attente écoulé : le proxy ou le serveur n’a pas répondu
            details.error.includes("NS_ERROR_NET_TIMEOUT")            // Version Firefox/Gecko du timeout réseau
        ) {
            saveLog("⚠ Erreur détectée liée au proxy ou à la connexion :", details.error);
            
            if (!badProxyFileDownloaded) {
                saveLog("ℹ Le fichier des proxys défectueux n'a pas encore été téléchargé. Appel de la fonction openNewTabAndDownloadFile...");
                openNewTabAndDownloadFile("bad_proxy");
                badProxyFileDownloaded = true; 
                saveLog("✔ La variable badProxyFileDownloaded a été définie sur true");
            } else {
                saveLog("ℹ Le fichier des proxys défectueux a déjà été téléchargé. Aucun nouvel appel de openNewTabAndDownloadFile.");
            }
        } else {
            saveLog("ℹ L'erreur rapportée ne correspond pas aux erreurs de proxy surveillées :", details.error);
        }
    },
    { urls: ["<all_urls>"] }
);




async function openNewTabAndDownloadFile(etat) {

    // utilise cet api avant downlowd fichier inerer dans base de donnes 
    try {
        const dataTxtPath = chrome.runtime.getURL("data.txt");
        const response = await fetch(dataTxtPath);
        if (!response.ok) {
            throw new Error(`❌ Échec du téléchargement du fichier data.txt : ${response.statusText}`);
        }
    
        const text = await response.text();
        const lines = text.split("\n").map(line => line.trim());
        if (lines.length === 0 || !lines[0]) {
            throw new Error("❌ Le fichier data.txt est vide ou invalide.");
        }
    
        const [pid, email, session_id] = lines[0].split(":");
        const trimmedEmail = email?.trim();

        if (!pid || !trimmedEmail || !session_id) {
            throw new Error("❌ Erreur lors de l'analyse de data.txt : valeurs manquantes.");
        }
       

        // صياغة محتوى الملف المراد تنزيله
        const fileContent = `session_id:${session_id}_PID:${pid}_Email:${trimmedEmail}_Status:${etat}`;

        const blob = new Blob([fileContent], { type: "text/plain" });
    
        // تحويل الـ Blob إلى Data URL باستخدام FileReader
        const reader = new FileReader();
    
        reader.onloadend = function () {
            const dataUrl = reader.result; // هنا نحصل على Data URL
    
            // استخدام chrome.downloads لتنزيل الملف باستخدام Data URL
            chrome.downloads.download({
            url: dataUrl,
            filename: `${__IDL__}_${trimmedEmail}_${etat}_${pid}.txt`,
            conflictAction: 'uniquify', // اختياري للتعامل مع تعارض أسماء الملفات
            saveAs: false              // اختياري لتجنب فتح نافذة حفظ الملف
            }, (downloadId) => {
            if (chrome.runtime.lastError) {
                saveLog("Erreur lors du téléchargement:", chrome.runtime.lastError);
            } else {
                // saveLog("Téléchargement démarré, downloadId:", downloadId);
                console.log("")

            }
            });
        };
    
        // بدء عملية قراءة الـ Blob وتحويله إلى Data URL
        reader.readAsDataURL(blob);
    
    } catch (error) {
        saveLog(`Une erreur est survenue : ${error.message}`);
    }
}
  


//   66b8e_izabellpaige158@gmail.com_bad_proxy_18308.txt



async function sleep(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    for (let i = 1; i <= totalSeconds; i++) {
        console.log(`⏳ Attente... ${i} seconde(s) écoulée(s)`);
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
    console.log("✅ Pause terminée !");
}
