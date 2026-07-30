// Obtener el host dinámicamente para soportar acceso desde otros dispositivos en red local
const host = window.location.hostname || 'localhost';
const port = window.location.port ? `:${window.location.port}` : ':8000';
const protocol = window.location.protocol;
const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';

const API_URL = `${protocol}//${host}${port}`;
const WS_URL = `${wsProtocol}//${host}${port}/ws/tracking`;

// Estado global
let token = null;
let userRole = null; // 'CLIENTE' o 'TECNICO'
let currentSolicitudId = 'test-uuid-1234'; // ID Hardcodeado para la demo
let ws = null;
let trackingInterval = null; // Simulación
let watchId = null; // GPS real
let myLat = 40.7128; // Coordenadas del usuario activo
let myLng = -74.0060;
let targetLat = null; // Coordenadas de la contraparte
let targetLng = null;
let currentMaxDist = 30; // Escala dinámica inicial del radar (30 metros)

// Elementos del DOM
const views = {
    login: document.getElementById('view-login'),
    cliente: document.getElementById('view-cliente'),
    tecnico: document.getElementById('view-tecnico')
};

const userInfo = document.getElementById('user-info');
const userRoleBadge = document.getElementById('user-role');

// Utilidades
function showView(viewName) {
    Object.values(views).forEach(v => v.classList.add('hidden'));
    views[viewName].classList.remove('hidden');
    if (viewName !== 'login') userInfo.classList.remove('hidden');
    else userInfo.classList.add('hidden');
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    if (!lat1 || !lon1 || !lat2 || !lon2) return "?";
    const R = 6371e3; // Radio de la Tierra en metros
    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const dp = (lat2-lat1) * Math.PI/180;
    const dl = (lon2-lon1) * Math.PI/180;
    const a = Math.sin(dp/2) * Math.sin(dp/2) + Math.cos(p1) * Math.cos(p2) * Math.sin(dl/2) * Math.sin(dl/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round(R * c);
}

function calculateBearing(lat1, lon1, lat2, lon2) {
    const p1 = lat1 * Math.PI/180;
    const p2 = lat2 * Math.PI/180;
    const dl = (lon2-lon1) * Math.PI/180;
    const y = Math.sin(dl) * Math.cos(p2);
    const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
    const brng = Math.atan2(y, x);
    return (brng * 180 / Math.PI + 360) % 360;
}

function updateTechRadar(distancia, bearing) {
    if (distancia > currentMaxDist) currentMaxDist = distancia;
    let radiusPx = (distancia / currentMaxDist) * 90;
    if (radiusPx > 90) radiusPx = 90;
    
    const angleRad = (bearing - 90) * Math.PI / 180;
    const moveX = radiusPx * Math.cos(angleRad);
    const moveY = radiusPx * Math.sin(angleRad);
    
    const clientMarker = document.getElementById('client-moving-marker');
    clientMarker.style.left = `calc(50% + ${moveX}px)`;
    clientMarker.style.top = `calc(50% + ${moveY}px)`;
}

// Variables para suavizar el GPS (Filtro Pasa Bajos)
let smoothedLat = null;
let smoothedLng = null;

// 1. LOGIN
document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;

    try {
        const res = await fetch(`${API_URL}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        
        if (!res.ok) throw new Error('Credenciales inválidas');
        
        const data = await res.json();
        token = data.access_token;
        
        // Simular rol basado en el email
        if (email.includes('cliente')) {
            userRole = 'CLIENTE';
            userRoleBadge.textContent = 'Cliente';
            showView('cliente');
            fetchBalance();
        } else {
            userRole = 'TECNICO';
            userRoleBadge.textContent = 'Técnico';
            showView('tecnico');
        }
    } catch (err) {
        alert(err.message);
    }
});

async function fetchBalance() {
    try {
        const res = await fetch(`${API_URL}/usuarios/saldo`);
        const data = await res.json();
        document.getElementById('wallet-balance').innerText = data.saldo.toFixed(2);
    } catch (e) {
        console.error('Error al obtener saldo', e);
    }
}

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
    token = null;
    userRole = null;
    if (ws) { ws.close(); ws = null; }
    if (trackingInterval) clearInterval(trackingInterval);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    showView('login');
});

// 2. CLIENTE: Pedir servicio y buscar técnicos
document.getElementById('solicitud-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const oficio = document.getElementById('oficio').value;

    document.getElementById('tracking-info').innerText = "Obteniendo tu ubicación real...";
    
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                myLat = pos.coords.latitude;
                myLng = pos.coords.longitude;
                sendSolicitud(oficio, myLat, myLng);
            },
            (err) => {
                console.warn("GPS bloqueado o sin permiso, usando ubicación de prueba", err);
                sendSolicitud(oficio, myLat, myLng);
            },
            { enableHighAccuracy: true }
        );
    } else {
        sendSolicitud(oficio, myLat, myLng);
    }
});

async function sendSolicitud(oficio, lat, lng) {
    try {
        // Crear solicitud
        const resSol = await fetch(`${API_URL}/solicitudes`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                oficio_requerido: oficio,
                descripcion: "Reparación urgente",
                coordenadas: { lat, lng }
            })
        });
        const dataSol = await resSol.json();
        currentSolicitudId = dataSol.solicitud_id;

        // Buscar técnicos cercanos
        const resTech = await fetch(`${API_URL}/tecnicos/cercanos?oficio=${oficio}&lat=${lat}&lng=${lng}&radio_km=5.0`);
        const tecnicos = await resTech.json();

        // Mostrar lista
        const list = document.getElementById('tecnicos-list');
        list.innerHTML = '';
        tecnicos.forEach(t => {
            const li = document.createElement('li');
            li.innerHTML = `<span><strong>${t.nombre}</strong> (${t.oficio})</span> <span>${t.distancia_metros}m</span>`;
            list.appendChild(li);
        });
        document.getElementById('busqueda-resultados').classList.remove('hidden');

        // Nos conectamos al tracking de inmediato esperando al técnico
        connectWebSocketAsClient();
        
    } catch(err) {
        alert('Error al procesar solicitud');
    }
}

// 3. WEBSOCKET: Cliente escuchando
function connectWebSocketAsClient() {
    document.getElementById('tracking-container').classList.remove('hidden');
    document.getElementById('client-status-title').innerText = "Buscando técnico...";
    document.getElementById('client-pulse').style.backgroundColor = "orange";
    document.getElementById('tracking-info').innerText = "Esperando que un técnico acepte...";
    
    ws = new WebSocket(`${WS_URL}/${currentSolicitudId}`);
    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        if (data.status === 'EN_CAMINO') {
            document.getElementById('client-status-title').innerText = "Técnico en camino";
            document.getElementById('client-pulse').style.backgroundColor = "blue";
        } else if (data.status === 'EN_CURSO') {
            document.getElementById('client-status-title').innerText = "Trabajo en progreso";
            document.getElementById('client-pulse').style.backgroundColor = "green";
            document.getElementById('tracking-info').innerText = "El técnico ha llegado y está trabajando.";
            document.getElementById('map-placeholder').classList.add('hidden');
        } else if (data.status === 'COMPLETADO') {
            document.getElementById('client-status-title').innerText = "Trabajo finalizado";
            document.getElementById('client-pulse').style.backgroundColor = "gray";
            document.getElementById('tracking-info').innerText = "El servicio se ha completado exitosamente.";
            document.getElementById('payment-container').classList.remove('hidden');
            if (ws) ws.close();
        }
        
        if (data.lat && data.lng && data.status !== 'EN_CURSO' && data.status !== 'COMPLETADO') {
            // Suavizado de GPS para evitar saltos locos
            if (!smoothedLat) {
                smoothedLat = data.lat;
                smoothedLng = data.lng;
            } else {
                smoothedLat = smoothedLat * 0.8 + data.lat * 0.2;
                smoothedLng = smoothedLng * 0.8 + data.lng * 0.2;
            }

            const distancia = calculateDistance(myLat, myLng, smoothedLat, smoothedLng);
            document.getElementById('tracking-info').innerHTML = `El técnico está a <strong>${distancia} metros</strong> de distancia.<br><small>GPS Técnico: ${smoothedLat.toFixed(4)}, ${smoothedLng.toFixed(4)}</small>`;
            
            // Actualizar mapa visual
            const bearing = calculateBearing(myLat, myLng, smoothedLat, smoothedLng);
            
            // Auto-escalado del radar: si está muy lejos, expandimos el radar. 
            // Si está cerca, se mantiene la escala mínima (30m) para notar los pasos.
            if (distancia > currentMaxDist) {
                currentMaxDist = distancia; 
            }
            
            let radiusPx = (distancia / currentMaxDist) * 90;
            if (radiusPx > 90) radiusPx = 90; // Mantener dentro del cuadro
            
            const angleRad = (bearing - 90) * Math.PI / 180; // -90 para que 0 grados sea Norte (arriba)
            const moveX = radiusPx * Math.cos(angleRad);
            const moveY = radiusPx * Math.sin(angleRad);
            
            const techMarker = document.getElementById('tech-marker');
            techMarker.style.left = `calc(50% + ${moveX}px)`;
            techMarker.style.top = `calc(50% + ${moveY}px)`;
        }
    };
}

document.getElementById('pay-btn').addEventListener('click', async () => {
    try {
        const res = await fetch(`${API_URL}/pagar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ monto: 50.0 })
        });
        if (res.ok) {
            const data = await res.json();
            document.getElementById('wallet-balance').innerText = data.nuevo_saldo.toFixed(2);
            document.getElementById('payment-container').classList.add('hidden');
            document.getElementById('client-restart-btn').classList.remove('hidden');
            alert('¡Pago realizado con éxito!');
        } else {
            alert('Error al procesar el pago.');
        }
    } catch (e) {
        alert('Error al conectar con el servidor.');
    }
});

document.getElementById('client-restart-btn').addEventListener('click', () => {
    document.getElementById('client-restart-btn').classList.add('hidden');
    document.getElementById('tracking-container').classList.add('hidden');
    document.getElementById('map-placeholder').classList.remove('hidden');
    document.getElementById('busqueda-resultados').classList.add('hidden');
    
    // Reset payment state
    document.getElementById('payment-container').classList.add('hidden');
    document.getElementById('pay-btn').classList.remove('hidden');
    document.getElementById('payment-success-msg').classList.add('hidden');
});

document.getElementById('pay-btn').addEventListener('click', () => {
    document.getElementById('pay-btn').classList.add('hidden');
    document.getElementById('payment-success-msg').classList.remove('hidden');
    
    // Deduct $50 visually
    const walletBalance = document.getElementById('wallet-balance');
    let currentBalance = parseFloat(walletBalance.innerText);
    walletBalance.innerText = (currentBalance - 50).toFixed(2);

    document.getElementById('client-restart-btn').classList.remove('hidden');
});

// 4. TÉCNICO: Flujo completo
document.getElementById('refresh-requests-btn').addEventListener('click', async () => {
    try {
        const res = await fetch(`${API_URL}/solicitudes/pendientes`);
        const solicitudes = await res.json();
        
        const list = document.getElementById('pending-requests-list');
        list.innerHTML = '';
        
        if (solicitudes.length === 0) {
            list.innerHTML = '<li>No hay solicitudes pendientes.</li>';
            return;
        }
        
        solicitudes.forEach(s => {
            const li = document.createElement('li');
            
            let mapHtml = '';
            let clientLat = 'null';
            let clientLng = 'null';
            if (s.coordenadas) {
                clientLat = s.coordenadas.lat;
                clientLng = s.coordenadas.lng;
                const mapLink = `https://www.google.com/maps?q=${s.coordenadas.lat},${s.coordenadas.lng}`;
                mapHtml = `<div class="mt-2"><a href="${mapLink}" target="_blank" style="color: #1A5CFF; text-decoration: underline; font-size: 14px;">📍 Ver ubicación del cliente en el mapa</a></div>`;
            }

            li.innerHTML = `<div style="display: flex; flex-direction: column; width: 100%;">
                <div><strong>${s.oficio_requerido}</strong> - ${s.descripcion}</div>
                ${mapHtml}
                <button class="btn btn-sm btn-primary mt-2 w-full" onclick="acceptRequest('${s.id}', ${clientLat}, ${clientLng})">Atender</button>
            </div>`;
            list.appendChild(li);
        });
    } catch(err) {
        alert('Error al obtener solicitudes');
    }
});

window.acceptRequest = (solicitudId, lat, lng) => {
    currentSolicitudId = solicitudId;
    targetLat = lat;
    targetLng = lng;
    document.getElementById('tech-pending-requests').classList.add('hidden');
    document.getElementById('tech-tracking-controls').classList.remove('hidden');
    document.getElementById('tech-job-title').innerText = `Servicio Activo: ${solicitudId.substring(0, 8)}...`;
    
    // Conectar WebSocket como técnico
    ws = new WebSocket(`${WS_URL}/${currentSolicitudId}`);
};

async function updateRequestStatus(status) {
    await fetch(`${API_URL}/solicitudes/${currentSolicitudId}/estado`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: status })
    });
}

    document.getElementById('start-tracking-btn').addEventListener('click', () => {
    document.getElementById('start-tracking-btn').classList.add('hidden');
    document.getElementById('arrive-btn').classList.remove('hidden');
    document.getElementById('tech-map-placeholder').classList.remove('hidden');
    document.getElementById('tech-sim-text').innerText = "Transmitiendo GPS...";
    
    // Notificar al cliente que vamos en camino
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ status: 'EN_CAMINO' }));
    }
    
    // Intentar usar el GPS real del teléfono
    if ("geolocation" in navigator) {
        document.getElementById('tech-sim-text').innerText = "Conectando al GPS real...";
        let lastGpsTime = Date.now();
        let hasInitialFix = false;

        watchId = navigator.geolocation.watchPosition(
            (position) => {
                const acc = position.coords.accuracy;
                // 1. Filtro de Precisión (Ignorar si el error es mayor a 25 metros)
                if (acc > 25) {
                    document.getElementById('tech-coords').innerText = `Señal GPS débil (${Math.round(acc)}m error). Buscando satélites...`;
                    return; 
                }

                const newLat = position.coords.latitude;
                const newLng = position.coords.longitude;
                
                // 2. Filtro de Salto Imposible (Dead Reckoning)
                const now = Date.now();
                const timeDiff = (now - lastGpsTime) / 1000; // Segundos transcurridos
                const distJump = calculateDistance(myLat, myLng, newLat, newLng);
                
                if (hasInitialFix && timeDiff > 0) {
                    const speed = distJump / timeDiff; // m/s
                    if (speed > 20) { // Si el salto implica más de 20 m/s (~72 km/h), es ruido de interiores
                        console.warn(`Salto ignorado: ${distJump}m en ${timeDiff.toFixed(1)}s`);
                        return;
                    }
                }

                hasInitialFix = true;
                lastGpsTime = now;
                myLat = newLat;
                myLng = newLng;
                
                const payload = { lat: myLat, lng: myLng, tecnico_id: 2, status: 'EN_CAMINO' };
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify(payload));
                }
                const distancia = targetLat ? calculateDistance(myLat, myLng, targetLat, targetLng) : "?";
                document.getElementById('tech-coords').innerText = `A ${distancia} metros del cliente. (GPS Real | Error: ${Math.round(acc)}m)`;
                
                if (targetLat) {
                    const bearing = calculateBearing(myLat, myLng, targetLat, targetLng);
                    updateTechRadar(distancia, bearing);
                }
            },
            (error) => {
                console.warn("No se pudo usar GPS real, usando simulación", error);
                startSimulatedTracking();
            },
            { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
        );
    } else {
        startSimulatedTracking();
    }

    function startSimulatedTracking() {
        document.getElementById('tech-sim-text').innerText = "Transmitiendo GPS (Simulado)...";
        // Si no tiene GPS real, alejamos al técnico artificialmente para la simulación
        if (myLat === 40.7128 && myLng === -74.0060) {
            myLat = 40.7300;
            myLng = -73.9900;
        }

        let lat = myLat;
        let lng = myLng;
        
        trackingInterval = setInterval(() => {
            // Acercar la simulación al cliente si sabemos dónde está
            if (targetLat && targetLng) {
                // Avance suave al objetivo (más rápido)
                lat += (targetLat - lat) * 0.25;
                lng += (targetLng - lng) * 0.25;
            } else {
                lat -= 0.0005;
                lng -= 0.0005;
            }
            
            const payload = { lat, lng, tecnico_id: 2, status: 'EN_CAMINO' };
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(payload));
            }
            
            myLat = lat;
            myLng = lng;
            const distancia = targetLat ? calculateDistance(myLat, myLng, targetLat, targetLng) : "?";
            document.getElementById('tech-coords').innerText = `A ${distancia} metros del cliente. (Simulado)`;
            
            if (targetLat) {
                const bearing = calculateBearing(myLat, myLng, targetLat, targetLng);
                updateTechRadar(distancia, bearing);
            }
        }, 1000);
    }
});

document.getElementById('arrive-btn').addEventListener('click', async () => {
    document.getElementById('arrive-btn').classList.add('hidden');
    document.getElementById('finish-btn').classList.remove('hidden');
    document.getElementById('tech-sim-text').innerText = "Trabajando en el lugar...";
    
    if (trackingInterval) clearInterval(trackingInterval);
    if (watchId) navigator.geolocation.clearWatch(watchId);
    document.getElementById('tech-coords').innerText = 'Transmisión GPS detenida.';
    
    // Notificar y actualizar BD
    await updateRequestStatus('EN_CURSO');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ status: 'EN_CURSO' }));
    }
});

document.getElementById('finish-btn').addEventListener('click', async () => {
    document.getElementById('finish-btn').classList.add('hidden');
    document.getElementById('tech-restart-btn').classList.remove('hidden');
    document.getElementById('tech-sim-text').innerText = "Trabajo finalizado con éxito.";
    
    // Notificar y actualizar BD
    await updateRequestStatus('COMPLETADO');
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ status: 'COMPLETADO' }));
        ws.close();
    }
});

document.getElementById('tech-restart-btn').addEventListener('click', () => {
    document.getElementById('tech-restart-btn').classList.add('hidden');
    document.getElementById('start-tracking-btn').classList.remove('hidden');
    document.getElementById('tech-tracking-controls').classList.add('hidden');
    document.getElementById('tech-map-placeholder').classList.add('hidden');
    document.getElementById('tech-pending-requests').classList.remove('hidden');
    document.getElementById('tech-sim-text').innerText = "Simular flujo de trabajo";
    document.getElementById('tech-coords').innerText = "";
    document.getElementById('refresh-requests-btn').click();
});

// Theme Toggle Logic
(function initTheme() {
    const themeToggleBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');
    
    if (themeToggleBtn && themeIcon) {
        // Check local storage for theme
        const currentTheme = localStorage.getItem('theme');
        if (currentTheme === 'dark') {
            document.body.classList.add('dark-mode');
            themeIcon.textContent = '☀️';
        }

        themeToggleBtn.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            if (document.body.classList.contains('dark-mode')) {
                localStorage.setItem('theme', 'dark');
                themeIcon.textContent = '☀️';
            } else {
                localStorage.setItem('theme', 'light');
                themeIcon.textContent = '🌙';
            }
        });
    }
})();
