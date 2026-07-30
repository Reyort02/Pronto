-- Habilitar extensión PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- Tabla 1: usuarios
CREATE TABLE usuarios (
    id SERIAL PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    rol VARCHAR(50) CHECK (rol IN ('CLIENTE', 'TECNICO')) NOT NULL,
    saldo DECIMAL(10, 2) DEFAULT 1000.00
);

-- Tabla 2: tecnicos_perfil
CREATE TABLE tecnicos_perfil (
    usuario_id INT PRIMARY KEY REFERENCES usuarios(id) ON DELETE CASCADE,
    oficio VARCHAR(255) NOT NULL,
    estado_actual VARCHAR(50) CHECK (estado_actual IN ('OFFLINE', 'DISPONIBLE', 'OCUPADO')) NOT NULL,
    ubicacion_base GEOMETRY(Point, 4326) -- Coordenadas (longitud, latitud)
);

-- Crear índice espacial para búsquedas rápidas por ubicación
CREATE INDEX idx_tecnicos_ubicacion ON tecnicos_perfil USING GIST(ubicacion_base);

-- Tabla 3: solicitudes_servicio
CREATE TABLE solicitudes_servicio (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id INT NOT NULL REFERENCES usuarios(id),
    tecnico_id INT REFERENCES usuarios(id),
    oficio_requerido VARCHAR(255) NOT NULL,
    descripcion TEXT,
    coordenadas GEOMETRY(Point, 4326) NOT NULL,
    estado VARCHAR(50) CHECK (estado IN ('PENDIENTE', 'EN_CURSO', 'COMPLETADO')) NOT NULL DEFAULT 'PENDIENTE',
    creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insertar datos de prueba
INSERT INTO usuarios (nombre, email, password_hash, rol, saldo) VALUES 
('Juan Cliente', 'cliente@pronto.com', 'hashed_pass_123', 'CLIENTE', 1000.00),
('Técnico Experto', 'tecnico@pronto.com', 'hashed_pass_123', 'TECNICO', 0.00),
('Maria Electricista', 'maria@pronto.com', 'hashed_pass_123', 'TECNICO', 0.00),
('Pedro Albañil', 'pedro@pronto.com', 'hashed_pass_123', 'TECNICO', 0.00),
('Luis Mecánico', 'luis@pronto.com', 'hashed_pass_123', 'TECNICO', 0.00),
('Ana Limpieza', 'ana@pronto.com', 'hashed_pass_123', 'TECNICO', 0.00);

INSERT INTO tecnicos_perfil (usuario_id, oficio, estado_actual, ubicacion_base) VALUES
(2, 'Plomería', 'DISPONIBLE', ST_SetSRID(ST_MakePoint(-74.0060, 40.7128), 4326)), -- NY
(3, 'Electricidad', 'DISPONIBLE', ST_SetSRID(ST_MakePoint(-73.9900, 40.7300), 4326)),
(4, 'Albañilería', 'DISPONIBLE', ST_SetSRID(ST_MakePoint(-73.9800, 40.7200), 4326)),
(5, 'Mecánica', 'DISPONIBLE', ST_SetSRID(ST_MakePoint(-73.9700, 40.7400), 4326)),
(6, 'Limpieza', 'DISPONIBLE', ST_SetSRID(ST_MakePoint(-74.0100, 40.7100), 4326));
