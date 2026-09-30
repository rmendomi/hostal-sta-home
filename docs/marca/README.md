# Marca Santa Elena de Maipo Home

Material de referencia de la identidad visual. **Esta carpeta no se sube al
servidor**: el sitio usa las copias optimizadas que están en `web/`.

| Archivo | Qué es |
|---|---|
| `guia-diseno-marca.md` | Guía de diseño: paleta, tipografías, logo, formas y usos. |
| `logo-original.jpeg` | Logo ilustrado original en alta resolución (1448 × 1086). Fuente para imprimir o generar otras versiones. |

## Dónde se usa la marca en el sitio

| En el sitio | Archivo | Origen |
|---|---|---|
| Portada (logo dentro del arco) y vista previa al compartir el enlace | `web/img/logo.jpg` | Logo original reducido a 960 px (148 KB). |
| Ícono de la pestaña del navegador | `web/favicon.svg` | Isotipo simplificado (techo + casa + arco) sobre verde bosque. |
| Ícono al guardar el sitio en el iPhone | `web/apple-touch-icon.png` | Recorte de la casa del logo original, 180 × 180. |
| Cabecera, pie y panel | isotipo dibujado en `web/art.js` (`logoMark`) | Araucaria, techo y arco de entrada, en ocre. |
| Colores y tipografías | variables al inicio de `web/styles.css` | Paleta y fuentes de la guía. |

Si cambia el logo, reemplaza `logo-original.jpeg` y vuelve a generar
`web/img/logo.jpg` (ancho 960 px, JPG calidad ~84) y `web/apple-touch-icon.png`.
