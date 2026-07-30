import os
import json
from fastapi import FastAPI, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text
from redis.asyncio import Redis
from models import LoginRequest, TokenResponse, SolicitudCreate, TecnicoCercanoResponse, SolicitudEstadoUpdate, SolicitudResponse
from contextlib import asynccontextmanager

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql+asyncpg://pronto_user:pronto_password@localhost:5432/pronto_db")
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")

# Inicialización de BD
engine = create_async_engine(DATABASE_URL, echo=True)

redis_client = None

@asynccontextmanager
async def lifespan(app: FastAPI):
    global redis_client
    redis_client = Redis.from_url(REDIS_URL, decode_responses=True)
    yield
    await redis_client.close()
    await engine.dispose()

app = FastAPI(title="Pronto MVP", description="Plataforma de servicios a domicilio bajo demanda", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")


from fastapi.responses import RedirectResponse

# ----------------- ENDPOINTS REST ----------------- #

@app.get("/", include_in_schema=False)
async def root_redirect():
    return RedirectResponse(url="/static/index.html")

@app.post("/auth/login", response_model=TokenResponse)
async def login(request: LoginRequest):
    """
    Endpoint simulado de login para el MVP.
    En producción, validaría contra la base de datos y usaría JWT real.
    """
    if request.email == "cliente@pronto.com" and request.password == "12345":
        # Simula un token con ID de usuario 1
        return {"access_token": "fake-jwt-token-user-1", "token_type": "bearer"}
    elif request.email == "tecnico@pronto.com":
        return {"access_token": "fake-jwt-token-user-2", "token_type": "bearer"}
    
    raise HTTPException(status_code=401, detail="Credenciales incorrectas")

@app.post("/solicitudes", status_code=201)
async def crear_solicitud(solicitud: SolicitudCreate):
    """
    Crea una nueva solicitud de servicio en la BD.
    """
    cliente_id = 1 # Simulado, extraído del JWT en prod
    
    async with engine.begin() as conn:
        query = text("""
            INSERT INTO solicitudes_servicio 
            (cliente_id, oficio_requerido, descripcion, coordenadas, estado) 
            VALUES (:cliente_id, :oficio, :desc, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326), 'PENDIENTE')
            RETURNING id
        """)
        
        result = await conn.execute(query, {
            "cliente_id": cliente_id,
            "oficio": solicitud.oficio_requerido,
            "desc": solicitud.descripcion,
            "lng": solicitud.coordenadas.lng,
            "lat": solicitud.coordenadas.lat
        })
        new_id = result.scalar()
        
    return {"mensaje": "Solicitud creada exitosamente", "solicitud_id": str(new_id)}

@app.get("/tecnicos/cercanos", response_model=list[TecnicoCercanoResponse])
async def tecnicos_cercanos(oficio: str, lat: float, lng: float, radio_km: float = 5.0):
    """
    Busca técnicos disponibles en un radio específico usando ST_DWithin (PostGIS).
    """
    radio_metros = radio_km * 1000
    
    async with engine.connect() as conn:
        query = text("""
            SELECT 
                t.usuario_id, 
                u.nombre, 
                t.oficio,
                ST_Distance(
                    t.ubicacion_base::geography, 
                    ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography
                ) as distancia
            FROM tecnicos_perfil t
            JOIN usuarios u ON t.usuario_id = u.id
            WHERE t.oficio = :oficio 
              AND t.estado_actual = 'DISPONIBLE'
              AND ST_DWithin(
                  t.ubicacion_base::geography, 
                  ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, 
                  :radio
              )
            ORDER BY distancia ASC;
        """)
        
        result = await conn.execute(query, {
            "oficio": oficio,
            "lng": lng,
            "lat": lat,
            "radio": radio_metros
        })
        
        tecnicos = []
        for row in result.mappings():
            tecnicos.append({
                "tecnico_id": row["usuario_id"],
                "nombre": row["nombre"],
                "oficio": row["oficio"],
                "distancia_metros": round(row["distancia"], 2)
            })
            
    return tecnicos

@app.get("/solicitudes/pendientes", response_model=list[SolicitudResponse])
async def solicitudes_pendientes():
    """
    Obtiene todas las solicitudes en estado PENDIENTE, incluyendo ubicación del cliente.
    """
    async with engine.connect() as conn:
        query = text("""
            SELECT id, oficio_requerido, descripcion, estado,
                   ST_Y(coordenadas::geometry) as lat,
                   ST_X(coordenadas::geometry) as lng
            FROM solicitudes_servicio 
            WHERE estado = 'PENDIENTE'
            ORDER BY creado_en DESC
        """)
        result = await conn.execute(query)
        solicitudes = []
        for row in result.mappings():
            solicitudes.append(SolicitudResponse(
                id=row["id"],
                oficio_requerido=row["oficio_requerido"],
                descripcion=row["descripcion"],
                estado=row["estado"],
                coordenadas={"lat": row["lat"], "lng": row["lng"]}
            ))
    return solicitudes

@app.put("/solicitudes/{solicitud_id}/estado")
async def actualizar_estado_solicitud(solicitud_id: str, update_data: SolicitudEstadoUpdate):
    """
    Actualiza el estado de una solicitud.
    """
    async with engine.begin() as conn:
        query = text("""
            UPDATE solicitudes_servicio 
            SET estado = :estado
            WHERE id = :id
        """)
        await conn.execute(query, {"estado": update_data.estado, "id": solicitud_id})
    return {"mensaje": "Estado actualizado", "nuevo_estado": update_data.estado}

from models import PagoRequest

@app.get("/usuarios/saldo")
async def obtener_saldo():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT saldo FROM usuarios WHERE id = 1"))
        saldo = result.scalar()
    return {"saldo": float(saldo) if saldo else 0.0}

@app.post("/pagar")
async def pagar_servicio(pago: PagoRequest):
    async with engine.begin() as conn:
        await conn.execute(text("UPDATE usuarios SET saldo = saldo - :monto WHERE id = 1"), {"monto": pago.monto})
        await conn.execute(text("UPDATE usuarios SET saldo = saldo + :monto WHERE id = 2"), {"monto": pago.monto})
        result = await conn.execute(text("SELECT saldo FROM usuarios WHERE id = 1"))
        saldo = result.scalar()
    return {"mensaje": "Pago exitoso", "nuevo_saldo": float(saldo) if saldo else 0.0}

# ----------------- WEBSOCKETS (TIEMPO REAL) ----------------- #

class ConnectionManager:
    def __init__(self):
        # Mapea solicitud_id a una lista de WebSockets
        self.active_connections: dict[str, list[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, solicitud_id: str):
        await websocket.accept()
        if solicitud_id not in self.active_connections:
            self.active_connections[solicitud_id] = []
        self.active_connections[solicitud_id].append(websocket)

    def disconnect(self, websocket: WebSocket, solicitud_id: str):
        if solicitud_id in self.active_connections:
            self.active_connections[solicitud_id].remove(websocket)
            if not self.active_connections[solicitud_id]:
                del self.active_connections[solicitud_id]

    async def broadcast_to_solicitud(self, solicitud_id: str, message: dict):
        if solicitud_id in self.active_connections:
            for connection in self.active_connections[solicitud_id]:
                try:
                    await connection.send_json(message)
                except:
                    pass

manager = ConnectionManager()

@app.websocket("/ws/tracking/{solicitud_id}")
async def websocket_tracking(websocket: WebSocket, solicitud_id: str):
    """
    Endpoint WebSocket para rastreo en tiempo real.
    - El técnico envía: {"lat": 40.7128, "lng": -74.0060, "tecnico_id": 2}
    - Se guarda en Redis con TTL de 30s.
    - Se hace broadcast a los clientes suscritos.
    """
    await manager.connect(websocket, solicitud_id)
    try:
        while True:
            # Recibir datos del cliente o técnico
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            if "lat" in payload and "lng" in payload:
                # Guardar en Redis con TTL de 30 segundos
                redis_key = f"tracking:{solicitud_id}"
                if redis_client:
                    await redis_client.set(redis_key, json.dumps(payload), ex=30)
                
            # Broadcast a todos los conectados (ubicación o cambio de estado)
            await manager.broadcast_to_solicitud(solicitud_id, payload)
                
    except WebSocketDisconnect:
        manager.disconnect(websocket, solicitud_id)
    except json.JSONDecodeError:
        pass # Ignorar JSON inválido
