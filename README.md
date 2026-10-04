# PBPE Exportador para Babele

<p align="center">
  <a href="https://github.com/ManuRomera/pbpe-exportador/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/ManuRomera/pbpe-exportador?include_prereleases&style=for-the-badge&color=4a7c59&label=release"></a>
  <a href="https://foundryvtt.com"><img alt="Foundry VTT V13" src="https://img.shields.io/badge/Foundry%20VTT-V13-57d8c8?style=for-the-badge"></a>
  <a href="https://github.com/ManuRomera/pbpe-exportador/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/ManuRomera/pbpe-exportador/total?style=for-the-badge&color=ff7a1f"></a>
  <img alt="System" src="https://img.shields.io/badge/system-agnostic-2b3245?style=for-the-badge">
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-2b3245?style=for-the-badge"></a>
</p>

Modulo para Foundry VTT que convierte contenido ya importado dentro de Foundry en archivos JSON compatibles con Babele.

Su caso de uso principal es este:

1. Importas contenido a Foundry, normalmente con Plutonium.
2. Revisas, corriges o traduces ese contenido dentro de tu mundo o compendio.
3. Exportas el resultado a JSON con el nombre de coleccion correcto para que Babele lo pueda cargar como traduccion.

Esto evita reconstruir a mano archivos de traduccion y respeta los `collectionId` que Babele necesita.

## Que exporta

- Colecciones del mundo:
  - `Actor`
  - `Item`
  - `JournalEntry`
  - `RollTable`
  - `Scene`
- Compendios individuales
- Campos utiles para traduccion en Babele, incluyendo mapeos comunes de `dnd5e`
- Traducciones de carpetas opcionales

## Para que sirve exactamente

Este modulo no traduce por si solo y no sustituye a Babele.

Sirve para generar los JSON que despues lee Babele, a partir de contenido que ya existe dentro de Foundry. Es especialmente util si trabajas asi:

- importas contenido con Plutonium
- editas nombres, descripciones o carpetas dentro de Foundry
- quieres convertir ese trabajo en un modulo de traduccion reutilizable

## Como nombra los archivos

Babele espera archivos con este patron:

`<collectionId>.json`

Ejemplos:

- `dnd5e.items.json`
- `world.plutonium-import-item.json`
- `mi-modulo.mi-pack.json`

El modulo genera esos nombres automaticamente:

- en modo `pack`, usa `pack.collection + ".json"`
- en modo `world`, intenta detectar la coleccion real desde `flags.core.sourceId` o `_stats.compendiumSource`
- si encuentra documentos procedentes de varias colecciones, genera un JSON por cada una

## Instalacion en Foundry

Instalacion por manifest:

`https://github.com/ManuRomera/pbpe-exportador/releases/latest/download/module.json`

## Uso desde la interfaz

1. Activa el modulo.
2. Ve a `Ajustes de modulo`.
3. Abre `PBPE Exportador para Babele`.
4. Elige si quieres exportar desde el mundo o desde un compendio.
5. Indica la carpeta de salida.
6. Exporta.

Ruta de salida recomendada:

`modules/mi-modulo-traduccion/compendium/es`

## API

Abrir el dialogo:

```js
await game.modules.get("pbpe-exportador").api.pOpenDialog();
```

Exportar un compendio:

```js
await game.modules.get("pbpe-exportador").api.pExportFromPack({
  packId: "world.mi-pack",
  outputDirectory: "modules/mi-modulo-traduccion/compendium/es"
});
```

## Compatibilidad

- Foundry VTT v13
- Integracion opcional con Babele

## Licencia

MIT
