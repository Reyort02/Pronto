# Instrucciones de Ejecución de Pronto

## Requisitos Previos
- Tener instalado [Docker](https://www.docker.com/) y Docker Compose.

## Pasos para ejecutar

1. **Abre tu terminal** en la carpeta `C:\Pronto` donde se encuentra el archivo `docker-compose.yml`.

2. **Levanta la infraestructura** ejecutando:
   ```bash
   docker-compose up -d --build
   ```
   Esto descargará las imágenes de PostGIS y Redis, construirá la imagen de FastAPI, e iniciará todos los servicios en segundo plano.

3. **Verifica los servicios**:
   - La API estará disponible en: [http://localhost:8000/docs](http://localhost:8000/docs) (Interfaz Swagger interactiva).
   - PostgreSQL estará en el puerto `5432`.
   - Redis estará en el puerto `6379`.

## Pruebas de los Endpoints (vía Swagger)

1. Ve a `http://localhost:8000/docs`.
2. Prueba el endpoint de `/auth/login` con:
   ```json
   { "email": "cliente@pronto.com", "password": "12345" }
   ```
3. Prueba la creación de solicitudes en `/solicitudes`.
4. Busca técnicos en `/tecnicos/cercanos` con latitud `40.7128` y longitud `-74.0060` (coordenadas de ejemplo de Nueva York, para Plomería o Electricidad).

## Colores del Sistema y Estilos (MVP)
Hemos anotado cuidadosamente los estilos visuales para cuando integres o construyamos el Frontend / Aplicación Móvil:
- **Azul (#1A5CFF):** Color principal (Tecnología y seguridad - Botones de acción, logo).
- **Púrpura (#7C3AED):** Color secundario (Creatividad y sabiduría - Destacar funciones).
- **Verde Menta (#10B981):** Color de acento (Éxito y resolución).
- **Gris Carbón (#0F172A):** Texto y fondo de la app en modo oscuro.
- **Blanco (#F8FAFC):** Fondo de la app en modo claro.
