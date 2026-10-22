// =====================================================================
// CONFIGURACIÓN DEL SITIO — lo único que hay que tocar al instalarlo
// =====================================================================
// Todo lo demás (nombre del negocio, WhatsApp, mail, aviso, formas de pago,
// precios, stock) se cambia en la hoja "Configuración" de la planilla.

window.CONFIG_SITIO = {
  // URL del script publicado (Implementar → Administrar implementaciones → "URL de la aplicación web").
  // Termina en /exec. Si se crea una implementación NUEVA, la URL cambia y hay que pegarla acá.
  urlScript: 'https://script.google.com/macros/s/AKfycbx2AMNQW8640zx0crLPdiN3s6Rj1xIz_TEqX7xXw6RX3pGNxGSESn2xQqfo312pjUWyQw/exec',

  // WhatsApp de respaldo: se usa solo si el catálogo no carga, para que el cliente no se quede sin salida.
  // Con código de país, sin + ni espacios.
  whatsappRespaldo: '5491137555005',

  // Logo (opcional): poné el archivo dentro de la carpeta del sitio y escribí su nombre, ej. 'logo.svg'.
  // Vacío = se muestra el nombre del negocio escrito. Se ve sobre la franja azul: conviene una versión blanca.
  logo: 'logo.svg',

  // true = el logo se muestra en BLANCO, sea del color que sea el archivo (sirve para logos de un solo
  // color, como un SVG negro). false = se muestra con sus colores originales (logos a color).
  logoEnBlanco: true,

  // Carpeta de las fotos (dentro de la carpeta del sitio). Cada foto se llama como el código: P001.webp
  carpetaFotos: 'fotos/',

  // Franja de avisos: segundos que se ve cada mensaje antes de pasar al siguiente (si hay más de uno).
  // Los mensajes se escriben en la planilla, Configuración → texto_aviso, separados por |
  segundosPorAviso: 7,

  // Cuántos productos se muestran antes del botón "Ver más".
  productosPorPagina: 24,
};
