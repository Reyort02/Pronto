from pydantic import BaseModel, EmailStr
from typing import Optional
from uuid import UUID

class LoginRequest(BaseModel):
    email: EmailStr
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str

class Coordenadas(BaseModel):
    lat: float
    lng: float

class SolicitudCreate(BaseModel):
    oficio_requerido: str
    descripcion: str
    coordenadas: Coordenadas

class TecnicoCercanoResponse(BaseModel):
    tecnico_id: int
    nombre: str
    oficio: str
    distancia_metros: float

class SolicitudEstadoUpdate(BaseModel):
    estado: str

class SolicitudResponse(BaseModel):
    id: UUID
    oficio_requerido: str
    descripcion: str
    estado: str
    coordenadas: Optional[Coordenadas] = None

class PagoRequest(BaseModel):
    monto: float
